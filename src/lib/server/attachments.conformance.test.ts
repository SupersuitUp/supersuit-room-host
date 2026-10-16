// Conformance for Protocol v0.2 attachments, through the web API a member actually calls:
// an unsigned upload is refused, an oversize one is refused before its bytes are read, a hash
// mismatch is refused, and nobody outside the room fetches the bytes.
import { describe, it, expect, beforeEach } from 'vitest'
import { createHash, generateKeyPairSync, sign, randomBytes } from 'node:crypto'
import { MemoryStore } from '@/lib/rooms/memory-store'
import * as rooms from '@/lib/rooms/service'
import { canonical, publicKeyB64 } from '@/lib/rooms/signing'
import { PNG_1x1, png } from '@/lib/rooms/test-images'
import { setCtxForTests, SESSION_COOKIE } from './ctx'
import { POST as joinPOST } from '@/app/api/agent/join/route'
import { POST as uploadPOST } from '@/app/api/rooms/[id]/attachments/route'
import { GET as fetchGET } from '@/app/api/rooms/[id]/attachments/[sha256]/route'

let ctx: rooms.Ctx
let roomId: string
const H = 'https://host.test'
const iso = () => new Date(ctx.now()).toISOString()
const nonce = () => randomBytes(12).toString('base64url')
const hex = (b: Uint8Array) => createHash('sha256').update(b).digest('hex')
const b64 = (o: object) => Buffer.from(canonical(o)).toString('base64url')

type K = { s: (o: object) => string; memberId: string; room: string }
async function joinVia(room: string, name: string, answersTo: string): Promise<K> {
  const { code } = await rooms.createInvite(ctx, 'operator', room, { name, answersTo })
  const { publicKey, privateKey } = generateKeyPairSync('ed25519')
  const s = (o: object) => sign(null, Buffer.from(canonical(o)), privateKey).toString('base64url')
  const req = { v: 1, type: 'join', code, publicKey: publicKeyB64(publicKey), at: iso(), nonce: nonce() }
  const res = await joinPOST(new Request(H + '/api/agent/join', { method: 'POST', body: JSON.stringify({ request: req, sig: s(req) }) }))
  return { s, memberId: (await res.json()).memberId, room }
}
function uploadAs(k: K, bytes: Uint8Array, opts: { over?: Record<string, unknown>; sig?: string; headers?: Record<string, string> } = {}) {
  const req = { v: 1, type: 'attachment.upload', room: k.room, member: k.memberId, sha256: hex(bytes), size: bytes.length, contentType: 'image/png', at: iso(), nonce: nonce(), ...opts.over }
  const headers: Record<string, string> = { 'content-type': 'application/octet-stream', 'x-room-request': b64(req), 'x-room-signature': opts.sig ?? k.s(req), ...opts.headers }
  return uploadPOST(new Request(`${H}/api/rooms/${roomId}/attachments`, { method: 'POST', headers, body: bytes as unknown as BodyInit }), { params: Promise.resolve({ id: roomId }) })
}
function fetchAs(sha: string, auth: { k?: K; cookie?: string; over?: Record<string, unknown> } = {}) {
  const headers: Record<string, string> = {}
  if (auth.k) {
    const req = { v: 1, type: 'attachment.fetch', room: roomId, member: auth.k.memberId, sha256: sha, at: iso(), nonce: nonce(), ...auth.over }
    headers['x-room-request'] = b64(req)
    headers['x-room-signature'] = auth.k.s(req)
  }
  if (auth.cookie) headers.cookie = `${SESSION_COOKIE}=${auth.cookie}`
  return fetchGET(new Request(`${H}/api/rooms/${roomId}/attachments/${sha}`, { headers }), { params: Promise.resolve({ id: roomId, sha256: sha }) })
}

let ada: K, ben: K
beforeEach(async () => {
  let t = Date.parse('2026-10-15T12:00:00.000Z')
  ctx = { store: new MemoryStore(), now: () => (t += 1) }
  setCtxForTests(ctx)
  for (const p of ['ada', 'ben', 'eve']) await rooms.addPerson(ctx, { key: p, name: p, emails: [`${p}@example.com`] })
  roomId = await rooms.createRoom(ctx, { person: 'ada', name: 'Room' })
  ada = await joinVia(roomId, "Ada's Pluma", 'ada')
  ben = await joinVia(roomId, "Ben's Pluma", 'ben')
})

describe('conformance: attachments (Protocol v0.2, section 6)', () => {
  it('a signed member upload is 200 and answers with what the host read', async () => {
    const r = await uploadAs(ada, PNG_1x1)
    expect(r.status).toBe(200)
    expect(await r.json()).toEqual({ sha256: hex(PNG_1x1), size: PNG_1x1.length, type: 'image/png', width: 1, height: 1 })
  })

  it('an unsigned upload is 401, and so is one signed by another member', async () => {
    const none = await uploadPOST(new Request(`${H}/api/rooms/${roomId}/attachments`, { method: 'POST', body: PNG_1x1 as unknown as BodyInit }), { params: Promise.resolve({ id: roomId }) })
    expect(none.status).toBe(401)
    expect((await uploadAs(ada, PNG_1x1, { sig: 'AAAA' })).status).toBe(401)
    const req = { v: 1, type: 'attachment.upload', room: roomId, member: ada.memberId, sha256: hex(PNG_1x1), size: PNG_1x1.length, contentType: 'image/png', at: iso(), nonce: nonce() }
    expect((await uploadAs(ada, PNG_1x1, { over: req, sig: ben.s(req) })).status).toBe(401)
  })

  it('a hash mismatch is refused: the bytes are not the bytes that were signed', async () => {
    const r = await uploadAs(ada, PNG_1x1, { over: { sha256: hex(png(2, 2)) } })
    expect(r.status).toBe(400)
    expect((await r.json()).error).toMatch(/sha256/)
  })

  it('an oversize upload is 413, refused from its declared length before the body is read', async () => {
    const r = await uploadAs(ada, PNG_1x1, { headers: { 'content-length': String(rooms.MAX_ATTACHMENT_BYTES + 1) } })
    expect(r.status).toBe(413)
    const big = png(10, 10, rooms.MAX_ATTACHMENT_BYTES + 1)
    expect((await uploadAs(ada, big)).status).toBe(413)
  })

  it('a member fetches with a signed request and gets the exact bytes, private and never cached publicly', async () => {
    await uploadAs(ada, PNG_1x1)
    const r = await fetchAs(hex(PNG_1x1), { k: ben })
    expect(r.status).toBe(200)
    expect(r.headers.get('content-type')).toBe('image/png')
    expect(r.headers.get('cache-control')).toMatch(/private/)
    expect(hex(new Uint8Array(await r.arrayBuffer()))).toBe(hex(PNG_1x1))
  })

  it('a signed fetch must name the hash it is fetching', async () => {
    await uploadAs(ada, PNG_1x1)
    expect((await fetchAs(hex(PNG_1x1), { k: ben, over: { sha256: hex(png(2, 2)) } })).status).toBe(401)
  })

  it('the person whose Pluma is a member fetches with their session; anyone else gets 404, or 401 with nothing', async () => {
    await uploadAs(ada, PNG_1x1)
    const ok = await fetchAs(hex(PNG_1x1), { cookie: await rooms.createSession(ctx, 'ben') })
    expect(ok.status).toBe(200)
    expect((await fetchAs(hex(PNG_1x1), { cookie: await rooms.createSession(ctx, 'eve') })).status).toBe(404)
    expect((await fetchAs(hex(PNG_1x1))).status).toBe(401)
  })

  it('a non-member agent cannot fetch: a member of another room gets 401 here', async () => {
    await uploadAs(ada, PNG_1x1)
    const other = await rooms.createRoom(ctx, { person: 'eve', name: 'Elsewhere' })
    const eve = await joinVia(other, "Eve's Pluma", 'eve')
    expect((await fetchAs(hex(PNG_1x1), { k: eve })).status).toBe(401)
  })
})
