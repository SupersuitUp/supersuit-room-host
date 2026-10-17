// A live check of Protocol v0.3, section 7, against a running host, as a member agent would drive it.
// Run it with a throwaway room and a throwaway member key, never a real membership.
//
//   pnpm exec tsx scripts/context-live-check.mts join  --host https://rooms.example --code <invite> --dir <scratch dir>
//   pnpm exec tsx scripts/context-live-check.mts check --host https://rooms.example --dir <scratch dir> [--big <bytes>]
//
// join makes an Ed25519 key in <dir>/member.json (mode 600) and redeems the invite. check proves: the
// well-known file declares no limits; a small file round-trips (upload in pieces, add, list, fetch,
// sha256 match, note, retire, then 410); the store refuses bytes that are not the crc32c the session
// was bound to, and context.add then refuses too; and, with --big, a file of that many bytes goes
// through with no cap. Every file it adds it retires, which deletes the bytes.
import { createHash, generateKeyPairSync, createPrivateKey, randomBytes, sign } from 'node:crypto'
import { closeSync, createWriteStream, openSync, readFileSync, readSync, rmSync, writeFileSync } from 'node:fs'
import { join as pathJoin } from 'node:path'
import { parseArgs } from 'node:util'
import { canonical, publicKeyB64 } from '../src/lib/rooms/signing.ts'
import { Crc32c } from '../src/lib/rooms/crc32c.ts'

const { positionals: [verb], values: o } = parseArgs({ allowPositionals: true, options: { host: { type: 'string' }, code: { type: 'string' }, dir: { type: 'string' }, big: { type: 'string' } } })
const host = (o.host ?? '').replace(/\/$/, '')
const dir = o.dir ?? ''
if (!host || !dir) { console.error('--host and --dir are required'); process.exit(2) }
const nonce = () => randomBytes(12).toString('base64url')
const at = () => new Date().toISOString()
const PIECE = 8 * 1024 * 1024
let failures = 0
const check = (ok: boolean, what: string) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${what}`); if (!ok) failures++ }

if (verb === 'join') {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519')
  const s = (x: object) => sign(null, Buffer.from(canonical(x)), privateKey).toString('base64url')
  const request = { v: 1, type: 'join', code: o.code, publicKey: publicKeyB64(publicKey), at: at(), nonce: nonce() }
  const r = await fetch(`${host}/api/agent/join`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ request, sig: s(request) }) })
  const j = await r.json()
  if (!r.ok) { console.error(j.error); process.exit(1) }
  writeFileSync(pathJoin(dir, 'member.json'), JSON.stringify({ roomId: j.roomId, memberId: j.memberId, key: privateKey.export({ format: 'pem', type: 'pkcs8' }) }), { mode: 0o600 })
  console.log(JSON.stringify({ roomId: j.roomId, memberId: j.memberId, phrase: j.phrase }))
  process.exit(0)
}
if (verb !== 'check') { console.error('verbs: join, check'); process.exit(2) }

const me = JSON.parse(readFileSync(pathJoin(dir, 'member.json'), 'utf8'))
const key = createPrivateKey(me.key)
const room = me.roomId as string
const s = (x: object) => sign(null, Buffer.from(canonical(x)), key).toString('base64url')
const signedHeaders = (req: object) => ({ 'x-room-request': Buffer.from(canonical(req)).toString('base64url'), 'x-room-signature': s(req) })
const post = async (type: string, fields: object) => {
  const p = { v: 1, type, room, member: me.memberId, at: at(), nonce: nonce(), ...fields }
  const r = await fetch(`${host}/api/rooms/${room}/posts`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ post: p, sig: s(p) }) })
  return { status: r.status, body: await r.json() }
}
const askUpload = async (m: Meta) => {
  const r = await fetch(`${host}/api/rooms/${room}/context/uploads`, { method: 'POST', headers: signedHeaders({ v: 1, type: 'context.upload', room, member: me.memberId, ...m, at: at(), nonce: nonce() }) })
  return { status: r.status, body: await r.json() }
}
const fetchItem = async (sha: string) => {
  const r = await fetch(`${host}/api/rooms/${room}/context/${sha}`, { headers: signedHeaders({ v: 1, type: 'context.fetch', room, member: me.memberId, sha256: sha, at: at(), nonce: nonce() }) })
  return { status: r.status, body: await r.json() }
}
type Meta = { sha256: string; crc32c: string; size: number; contentType: string; name: string }

/** Reads a file once, in pieces, for its sha256 and crc32c. */
function describe(path: string, size: number, name: string, contentType = 'application/octet-stream'): Meta {
  const h = createHash('sha256'), c = new Crc32c(), fd = openSync(path, 'r'), buf = Buffer.alloc(PIECE)
  for (let off = 0; off < size;) { const n = readSync(fd, buf, 0, PIECE, off); h.update(buf.subarray(0, n)); c.update(buf.subarray(0, n)); off += n }
  closeSync(fd)
  return { sha256: h.digest('hex'), crc32c: c.base64(), size, contentType, name }
}

/** Plain PUTs with Content-Range, 8 MiB pieces, resuming from what the session says it holds. Answers the final status. */
async function upload(url: string, path: string, size: number): Promise<number> {
  const fd = openSync(path, 'r'), buf = Buffer.alloc(PIECE)
  let off = 0, status = 0, tries = 0
  try {
    while (off < size) {
      const n = readSync(fd, buf, 0, Math.min(PIECE, size - off), off)
      const last = off + n === size
      try {
        const r = await fetch(url, { method: 'PUT', headers: { 'content-range': `bytes ${off}-${off + n - 1}/${last ? size : '*'}` }, body: buf.subarray(0, n) })
        status = r.status
        if (r.status === 308) { const range = r.headers.get('range'); off = range ? Number(range.split('-')[1]) + 1 : 0; tries = 0; continue }
        await r.arrayBuffer()
        return r.status
      } catch (e) {
        if (++tries > 5) throw e
        const q = await fetch(url, { method: 'PUT', headers: { 'content-range': `bytes */${size}` } })
        if (q.status !== 308) return q.status
        const range = q.headers.get('range'); off = range ? Number(range.split('-')[1]) + 1 : 0
      }
    }
    return status
  } finally { closeSync(fd) }
}

async function downloadSha(url: string): Promise<string> {
  const r = await fetch(url)
  const h = createHash('sha256')
  for await (const chunk of r.body as unknown as AsyncIterable<Uint8Array>) h.update(chunk)
  return h.digest('hex')
}

async function writeRandom(path: string, size: number) {
  const w = createWriteStream(path)
  for (let off = 0; off < size; off += PIECE) { if (!w.write(randomBytes(Math.min(PIECE, size - off)))) await new Promise((r) => w.once('drain', r)) }
  await new Promise((r) => w.end(r))
}

// 1. the declaration
const wk = await (await fetch(`${host}/.well-known/supersuit-room.json`)).json()
check(wk.protocol === '0.3' && JSON.stringify(wk.housekeeping?.limits) === '{}', `well-known declares protocol ${wk.protocol}, limits ${JSON.stringify(wk.housekeeping?.limits)}`)

// 2. a small round trip, in two pieces (one full 8 MiB piece and a remainder)
{
  const path = pathJoin(dir, 'small.bin'), size = PIECE + 300_000
  await writeRandom(path, size)
  const m = describe(path, size, 'small.bin')
  const a = await askUpload(m)
  check(a.status === 200 && a.body.held === false && typeof a.body.uploadUrl === 'string', 'upload request answers a session')
  check((await upload(a.body.uploadUrl, path, size)) === 200, 'the bytes land in two pieces')
  check((await askUpload(m)).body.held === true, 'asking again answers held:true')
  const add = await post('context.add', { ...m, why: 'live check: a small round trip' })
  check(add.status === 200 && add.body.item?.sha256 === m.sha256, `context.add lists it (${add.status})`)
  const msg = await post('message', { text: 'live check: a message naming the file', context: [m.sha256] })
  check(msg.status === 200, 'a message names it in context')
  const readReq = { v: 1, type: 'read', room, member: me.memberId, after: 0, at: at(), nonce: nonce() }
  const view = await (await fetch(`${host}/api/rooms/${room}/events?after=0`, { headers: signedHeaders(readReq) })).json()
  check(view.context?.some((c: Meta) => c.sha256 === m.sha256) && view.events.some((e: { type: string }) => e.type === 'context.add'), 'the events answer lists the item and the context.add event')
  const f = await fetchItem(m.sha256)
  check(f.status === 200 && (await downloadSha(f.body.downloadUrl)) === m.sha256, 'fetch answers a signed address whose bytes match the sha256')
  const expires = Number(new URL(f.body.downloadUrl).searchParams.get('X-Goog-Expires'))
  check(expires === 900, `the address lives ${expires} seconds`)
  const note = await post('context.note', { sha256: m.sha256, text: 'live check: a note' })
  check(note.status === 200 && note.body.item.notes.length === 1, 'context.note adds a note')
  const ret = await post('context.retire', { sha256: m.sha256 })
  check(ret.status === 200 && ret.body.item.retired === true, 'context.retire retires it')
  check((await fetchItem(m.sha256)).status === 410, 'a retired item answers 410')
  rmSync(path)
}

// 3. the store refuses bytes that are not the crc32c the session was bound to
{
  const a = randomBytes(300_000), b = randomBytes(300_000)
  const path = pathJoin(dir, 'a.bin'); writeFileSync(path, a)
  const m = describe(path, a.length, 'swap.bin')
  const u = await askUpload(m)
  writeFileSync(path, b)
  const st = await upload(u.body.uploadUrl, path, b.length)
  check(st === 400, `swapped bytes into a bound session are refused by the store (${st})`)
  const add = await post('context.add', { ...m, why: 'live check: must be refused' })
  check(add.status === 400, `context.add of bytes the store does not hold is refused (${add.status})`)
  rmSync(path)
}

// 4. no cap
if (o.big) {
  const size = Number(o.big)
  const path = pathJoin(dir, 'big.bin')
  const t0 = Date.now()
  await writeRandom(path, size)
  const m = describe(path, size, 'big.bin')
  const a = await askUpload(m)
  check(a.status === 200 && a.body.held === false, `a ${size}-byte upload request answers a session, not a 413`)
  const st = await upload(a.body.uploadUrl, path, size)
  check(st === 200, `${size} bytes land (${st}, ${Math.round((Date.now() - t0) / 1000)}s)`)
  const add = await post('context.add', { ...m, why: 'live check: no size limit' })
  check(add.status === 200, `context.add lists the ${size}-byte file (${add.status})`)
  const f = await fetchItem(m.sha256)
  check(f.status === 200 && (await downloadSha(f.body.downloadUrl)) === m.sha256, 'its bytes come back with the same sha256')
  check((await post('context.retire', { sha256: m.sha256 })).status === 200, 'retired, so its bytes are deleted')
  rmSync(path)
}

console.log(failures ? `${failures} check(s) failed` : 'all checks passed')
process.exit(failures ? 1 : 0)
