// Conformance for Protocol v0.3, section 7, through the web API a member actually calls: the upload
// door opens a bound session and takes no body, the fetch door answers a short-lived signed address to
// readers only, the declaration is served at the well-known path, and the cron runs only with its secret.
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createHash, generateKeyPairSync, sign, randomBytes } from 'node:crypto'
import { MemoryStore } from '@/lib/rooms/memory-store'
import { MemoryObjectStore } from '@/lib/rooms/object-store'
import * as rooms from '@/lib/rooms/service'
import { canonical, publicKeyB64 } from '@/lib/rooms/signing'
import { crc32cBase64 } from '@/lib/rooms/crc32c'
import { setCtxForTests, SESSION_COOKIE } from './ctx'
import { POST as joinPOST } from '@/app/api/agent/join/route'
import { POST as postsPOST } from '@/app/api/rooms/[id]/posts/route'
import { POST as uploadsPOST } from '@/app/api/rooms/[id]/context/uploads/route'
import { GET as contextGET } from '@/app/api/rooms/[id]/context/[sha256]/route'
import { GET as wellKnownGET } from '@/app/.well-known/supersuit-room.json/route'
import { GET as cronGET } from '@/app/api/cron/housekeeping/route'

let ctx: rooms.Ctx
let objects: MemoryObjectStore
let roomId: string
const H = 'https://host.test'
const iso = () => new Date(ctx.now()).toISOString()
const nonce = () => randomBytes(12).toString('base64url')
const hex = (b: Uint8Array) => createHash('sha256').update(b).digest('hex')
const b64 = (o: object) => Buffer.from(canonical(o)).toString('base64url')
const FILE = randomBytes(5000)
const meta = { sha256: hex(FILE), crc32c: crc32cBase64(FILE), size: FILE.length, contentType: 'video/mp4', name: 'cut.mp4' }

type K = { s: (o: object) => string; memberId: string; room: string }
async function joinVia(room: string, name: string, answersTo: string): Promise<K> {
  const { code } = await rooms.createInvite(ctx, 'operator', room, { name, answersTo })
  const { publicKey, privateKey } = generateKeyPairSync('ed25519')
  const s = (o: object) => sign(null, Buffer.from(canonical(o)), privateKey).toString('base64url')
  const req = { v: 1, type: 'join', code, publicKey: publicKeyB64(publicKey), at: iso(), nonce: nonce() }
  const res = await joinPOST(new Request(H + '/api/agent/join', { method: 'POST', body: JSON.stringify({ request: req, sig: s(req) }) }))
  return { s, memberId: (await res.json()).memberId, room }
}
function askUpload(k: K, opts: { sig?: string; over?: Record<string, unknown> } = {}) {
  const req = { v: 1, type: 'context.upload', room: k.room, member: k.memberId, ...meta, at: iso(), nonce: nonce(), ...opts.over }
  return uploadsPOST(new Request(`${H}/api/rooms/${roomId}/context/uploads`, { method: 'POST', headers: { 'x-room-request': b64(req), 'x-room-signature': opts.sig ?? k.s(req) } }), { params: Promise.resolve({ id: roomId }) })
}
function postAs(k: K, type: string, fields: object) {
  const post = { v: 1, type, room: roomId, member: k.memberId, at: iso(), nonce: nonce(), ...fields }
  return postsPOST(new Request(`${H}/api/rooms/${roomId}/posts`, { method: 'POST', body: JSON.stringify({ post, sig: k.s(post) }) }), { params: Promise.resolve({ id: roomId }) })
}
function fetchAs(sha: string, auth: { k?: K; cookie?: string } = {}) {
  const headers: Record<string, string> = {}
  if (auth.k) {
    const req = { v: 1, type: 'context.fetch', room: roomId, member: auth.k.memberId, sha256: sha, at: iso(), nonce: nonce() }
    headers['x-room-request'] = b64(req)
    headers['x-room-signature'] = auth.k.s(req)
  }
  if (auth.cookie) headers.cookie = `${SESSION_COOKIE}=${auth.cookie}`
  return contextGET(new Request(`${H}/api/rooms/${roomId}/context/${sha}`, { headers }), { params: Promise.resolve({ id: roomId, sha256: sha }) })
}
async function bring(k: K) {
  const a = await (await askUpload(k)).json()
  await objects.finish(a.uploadUrl, FILE)
  return postAs(k, 'context.add', { ...meta, why: 'the first cut' })
}

let ada: K, ben: K
beforeEach(async () => {
  let t = Date.parse('2026-10-17T12:00:00.000Z')
  objects = new MemoryObjectStore()
  ctx = { store: new MemoryStore(), now: () => (t += 1), objects }
  objects.now = ctx.now
  setCtxForTests(ctx)
  for (const p of ['ada', 'ben', 'eve']) await rooms.addPerson(ctx, { key: p, name: p, emails: [`${p}@example.com`] })
  roomId = await rooms.createRoom(ctx, { person: 'ada', name: 'Room' })
  ada = await joinVia(roomId, "Ada's Pluma", 'ada')
  ben = await joinVia(roomId, "Ben's Pluma", 'ben')
})
afterEach(() => { delete process.env.CRON_SECRET })

describe('conformance: the context library (Protocol v0.3, section 7)', () => {
  it('the upload door takes no body: a signed request answers a bound session, then held once the bytes are in', async () => {
    const r = await askUpload(ada)
    expect(r.status).toBe(200)
    const a = await r.json()
    expect(a).toEqual({ held: false, uploadUrl: expect.stringMatching(/^memory:\/\/upload\//) })
    expect((await bring(ada)).status).toBe(200)
    expect(await (await askUpload(ben)).json()).toEqual({ held: true })
  })

  it('an unsigned upload request is 401, and one signed by another member', async () => {
    const none = await uploadsPOST(new Request(`${H}/api/rooms/${roomId}/context/uploads`, { method: 'POST' }), { params: Promise.resolve({ id: roomId }) })
    expect(none.status).toBe(401)
    const req = { v: 1, type: 'context.upload', room: roomId, member: ada.memberId, ...meta, at: iso(), nonce: nonce() }
    expect((await askUpload(ada, { over: req, sig: ben.s(req) })).status).toBe(401)
  })

  it('no size is refused: a 5 TB request is a session, never 413', async () => {
    const r = await askUpload(ada, { over: { size: 5 * 1024 ** 4 } })
    expect(r.status).toBe(200)
  })

  it('a reader fetches the item and a signed address, never cached; a stranger 404, no credential 401; retired 410', async () => {
    await bring(ada)
    const r = await fetchAs(meta.sha256, { k: ben })
    expect(r.status).toBe(200)
    expect(r.headers.get('cache-control')).toMatch(/no-store/)
    const body = await r.json()
    expect(body.item).toMatchObject({ sha256: meta.sha256, name: 'cut.mp4', why: 'the first cut' })
    expect(body.downloadUrl).toMatch(/^memory:\/\/read\//)
    expect((await fetchAs(meta.sha256, { cookie: await rooms.createSession(ctx, 'ada') })).status).toBe(200)
    expect((await fetchAs(meta.sha256, { cookie: await rooms.createSession(ctx, 'eve') })).status).toBe(404)
    expect((await fetchAs(meta.sha256)).status).toBe(401)
    await postAs(ada, 'context.retire', { sha256: meta.sha256 })
    expect((await fetchAs(meta.sha256, { k: ben })).status).toBe(410)
  })

  it('the well-known file declares protocol 0.3 and no limits', async () => {
    const r = await wellKnownGET()
    expect(r.status).toBe(200)
    expect(await r.json()).toEqual(rooms.HOUSEKEEPING_DECLARATION)
  })

  it('the housekeeping cron runs only with the cron secret', async () => {
    const call = (auth?: string) => cronGET(new Request(`${H}/api/cron/housekeeping`, { headers: auth ? { authorization: auth } : {} }))
    expect((await call()).status).toBe(401)
    process.env.CRON_SECRET = 'shh-a-test-secret'
    expect((await call()).status).toBe(401)
    expect((await call('Bearer wrong')).status).toBe(401)
    const ok = await call('Bearer shh-a-test-secret')
    expect(ok.status).toBe(200)
    expect(await ok.json()).toMatchObject({ closedRoomsPurged: 0, unclaimedDeleted: 0 })
  })
})
