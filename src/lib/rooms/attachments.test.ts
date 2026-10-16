// Protocol v0.2, section 6: attachments. Bytes are uploaded first by a signed request; a post names
// them by sha256; the signature over the post covers that list; only readers of the room fetch them.
import { describe, it, expect, beforeEach } from 'vitest'
import { createHash, generateKeyPairSync, randomBytes, sign } from 'node:crypto'
import { MemoryStore } from './memory-store'
import { Refusal } from './refusal'
import * as rooms from './service'
import { canonical, publicKeyB64 } from './signing'
import { PNG_1x1, jpeg, png } from './test-images'
import type { Actor } from './types'

let now = Date.parse('2026-10-15T12:00:00.000Z')
let ctx: rooms.Ctx
let roomId: string
const iso = () => new Date(now).toISOString()
const nonce = () => randomBytes(12).toString('base64url')
const hex = (b: Uint8Array) => createHash('sha256').update(b).digest('hex')

async function refused(p: Promise<unknown>, status: number, words?: RegExp) {
  const e = await p.then(() => null, (err) => err)
  expect(e).toBeInstanceOf(Refusal)
  expect((e as Refusal).status).toBe(status)
  if (words) expect((e as Refusal).message).toMatch(words)
}

type P = { memberId: string; roomId: string; s: (o: object) => string }
async function join(room: string, name: string, answersTo: string): Promise<P> {
  const { code } = await rooms.createInvite(ctx, 'operator', room, { name, answersTo })
  const { publicKey, privateKey } = generateKeyPairSync('ed25519')
  const s = (o: object) => sign(null, Buffer.from(canonical(o)), privateKey).toString('base64url')
  const req = { v: 1, type: 'join', code, publicKey: publicKeyB64(publicKey), at: iso(), nonce: nonce() }
  return { memberId: (await rooms.redeemInvite(ctx, req, s(req))).memberId, roomId: room, s }
}
const uploadReq = (p: P, bytes: Uint8Array, over: Record<string, unknown> = {}) =>
  ({ v: 1, type: 'attachment.upload', room: p.roomId, member: p.memberId, sha256: hex(bytes), size: bytes.length, contentType: 'image/png', at: iso(), nonce: nonce(), ...over })
const upload = (p: P, bytes: Uint8Array, over: Record<string, unknown> = {}) => {
  const req = uploadReq(p, bytes, over)
  return rooms.uploadAttachment(ctx, p.roomId, req, p.s(req), bytes)
}
function post(p: P, type: string, fields: Record<string, unknown>) {
  const body = { v: 1, type, room: p.roomId, member: p.memberId, at: iso(), nonce: nonce(), ...fields }
  return rooms.submitPost(ctx, p.roomId, body, p.s(body))
}
const asAgent = (p: P): Actor => ({ kind: 'agent', roomId: p.roomId, memberId: p.memberId })
const ref = (bytes: Uint8Array, w = 1, h = 1, extra: Record<string, unknown> = {}) => ({ sha256: hex(bytes), type: 'image/png', width: w, height: h, ...extra })

let ada: P, ben: P
beforeEach(async () => {
  now = Date.parse('2026-10-15T12:00:00.000Z')
  ctx = { store: new MemoryStore(), now: () => now }
  for (const k of ['ada', 'ben', 'eve']) await rooms.addPerson(ctx, { key: k, name: k.toUpperCase(), emails: [`${k}@example.com`] })
  roomId = await rooms.createRoom(ctx, { person: 'ada', name: 'Room' })
  ada = await join(roomId, "Ada's Pluma", 'ada')
  ben = await join(roomId, "Ben's Pluma", 'ben')
})

describe('uploading: a member sends bytes under a signed request, and the host answers with what it read', () => {
  it('returns the sha256, size, type and the dimensions the host read from the bytes', async () => {
    expect(await upload(ada, PNG_1x1)).toEqual({ sha256: hex(PNG_1x1), size: PNG_1x1.length, type: 'image/png', width: 1, height: 1 })
    const j = jpeg(640, 480)
    expect(await upload(ada, j, { contentType: 'image/jpeg' })).toMatchObject({ type: 'image/jpeg', width: 640, height: 480 })
  })

  it('an unsigned or wrongly signed upload is 401, and a stranger key too', async () => {
    const req = uploadReq(ada, PNG_1x1)
    await refused(rooms.uploadAttachment(ctx, roomId, req, '', PNG_1x1), 401)
    await refused(rooms.uploadAttachment(ctx, roomId, req, ben.s(req), PNG_1x1), 401)
  })

  it('bytes that do not match the signed sha256 or size are refused, so nothing can be swapped in transit', async () => {
    const req = uploadReq(ada, PNG_1x1)
    const other = png(2, 2)
    await refused(rooms.uploadAttachment(ctx, roomId, req, ada.s(req), other), 400, /sha256|size/)
    const req2 = uploadReq(ada, PNG_1x1, { sha256: hex(other), size: other.length })
    await refused(rooms.uploadAttachment(ctx, roomId, req2, ada.s(req2), PNG_1x1), 400, /sha256|size/)
  })

  it(`an upload over the cap (${rooms.MAX_ATTACHMENT_BYTES} bytes) is 413`, async () => {
    const big = png(100, 100, rooms.MAX_ATTACHMENT_BYTES + 1)
    await refused(upload(ada, big), 413, /at most/)
  })

  it('only png, jpeg, webp and gif, and only bytes that ARE the type they claim', async () => {
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>')
    await refused(upload(ada, svg, { contentType: 'image/svg+xml' }), 400, /png, jpeg, webp or gif/)
    await refused(upload(ada, svg, { contentType: 'image/png' }), 400, /not a image\/png|not an? image/)
    await refused(upload(ada, PNG_1x1, { contentType: 'image/jpeg' }), 400)
  })

  it('a replayed upload request is refused, and an upload to a closed room too', async () => {
    const req = uploadReq(ada, PNG_1x1)
    await rooms.uploadAttachment(ctx, roomId, req, ada.s(req), PNG_1x1)
    await refused(rooms.uploadAttachment(ctx, roomId, req, ada.s(req), PNG_1x1), 409)
    await ctx.store.transaction(async (tx) => { tx.update(`rooms/${roomId}`, { state: 'closed' }) })
    await refused(upload(ada, png(3, 3)), 409, /closed/)
  })

  it('the same bytes uploaded twice are held once', async () => {
    await upload(ada, PNG_1x1)
    await upload(ben, PNG_1x1)
    expect((await ctx.store.list(`rooms/${roomId}/attachments`)).length).toBe(1)
  })
})

describe('a post names its attachments, and the signature covers the list', () => {
  it('a message, a draft, a revision and a decision may each carry attachments, read back in the thread', async () => {
    await upload(ada, PNG_1x1)
    await post(ada, 'message', { text: 'see this', attachments: [ref(PNG_1x1, 1, 1, { name: 'dot.png', alt: 'a single pixel' })] })
    const v = await rooms.read(ctx, asAgent(ben), roomId, 0)
    const e = v.events.find((x) => x.type === 'message')!
    expect(e.attachments).toEqual([{ sha256: hex(PNG_1x1), type: 'image/png', width: 1, height: 1, size: PNG_1x1.length, name: 'dot.png', alt: 'a single pixel' }])
    expect((e.post as { attachments: unknown[] }).attachments).toHaveLength(1)

    const { draft } = (await post(ada, 'draft', { title: 'Cover', text: 'the cover', attachments: [ref(PNG_1x1)] })) as { draft: string }
    const big = png(1200, 630)
    await upload(ada, big)
    await post(ada, 'draft.version', { draft, text: 'the cover', attachments: [ref(big, 1200, 630)] })
    const d = (await rooms.read(ctx, asAgent(ada), roomId, 0)).drafts[0]
    expect(d.versions.map((x) => x.attachments?.[0].sha256)).toEqual([hex(PNG_1x1), hex(big)])
    await post(ada, 'decision', { draft, version: 2, fingerprint: d.versions[1].fingerprint, verdict: 'approve', words: 'Yes, that one.', saidAt: iso(), attachments: [ref(big, 1200, 630)] })
    expect((await rooms.read(ctx, asAgent(ada), roomId, 0)).drafts[0].decisions[0].attachments).toHaveLength(1)
  })

  it('a message may be only an image, with no text', async () => {
    await upload(ada, PNG_1x1)
    await post(ada, 'message', { attachments: [ref(PNG_1x1)] })
    await refused(post(ada, 'message', {}), 400, /empty/)
  })

  it('a post naming a hash this room does not hold is refused, even one held by another room', async () => {
    await refused(post(ada, 'message', { text: 'x', attachments: [ref(PNG_1x1)] }), 400, /upload it first/)
    const other = await rooms.createRoom(ctx, { person: 'ada', name: 'Other' })
    const adaThere = await join(other, "Ada's Pluma", 'ada')
    await upload(adaThere, PNG_1x1)
    await refused(post(ada, 'message', { text: 'x', attachments: [ref(PNG_1x1)] }), 400, /upload it first/)
  })

  it('a reference whose type or dimensions disagree with what the host read is refused', async () => {
    await upload(ada, PNG_1x1)
    await refused(post(ada, 'message', { text: 'x', attachments: [ref(PNG_1x1, 2, 1)] }), 400, /does not match/)
    await refused(post(ada, 'message', { text: 'x', attachments: [{ ...ref(PNG_1x1), type: 'image/gif' }] }), 400, /does not match/)
  })

  it('a malformed list is 400: not an array, too many, a bad hash, unknown post type', async () => {
    await upload(ada, PNG_1x1)
    await refused(post(ada, 'message', { text: 'x', attachments: 'nope' }), 400)
    await refused(post(ada, 'message', { text: 'x', attachments: Array(rooms.MAX_ATTACHMENTS_PER_POST + 1).fill(ref(PNG_1x1)) }), 400, /at most/)
    await refused(post(ada, 'message', { text: 'x', attachments: [{ ...ref(PNG_1x1), sha256: 'abc' }] }), 400)
    await refused(post(ada, 'objective', { title: 't', owner: 'ada', done: 'd', attachments: [ref(PNG_1x1)] }), 400, /cannot carry/)
  })

  it('swapping an attachment after signing breaks the signature', async () => {
    await upload(ada, PNG_1x1)
    const other = png(1, 1, 200)
    await upload(ada, other)
    const body = { v: 1, type: 'message', room: roomId, member: ada.memberId, at: iso(), nonce: nonce(), text: 'x', attachments: [ref(PNG_1x1)] }
    const sig = ada.s(body)
    await refused(rooms.submitPost(ctx, roomId, { ...body, attachments: [ref(other)] }, sig), 401)
  })

  it("a version with attachments is fingerprinted over its text AND its attachments' hashes; one without keeps v0.1's", async () => {
    await upload(ada, PNG_1x1)
    expect(rooms.fingerprintVersion('words', [])).toBe(rooms.fingerprintText('words'))
    const fp = rooms.fingerprintVersion('words', [{ sha256: hex(PNG_1x1) }])
    expect(fp).toBe(createHash('sha256').update(canonical({ attachments: [hex(PNG_1x1)], text: 'words' })).digest('hex'))
    await post(ada, 'draft', { title: 'T', text: 'words', attachments: [ref(PNG_1x1)] })
    expect((await rooms.read(ctx, asAgent(ada), roomId, 0)).drafts[0].versions[0].fingerprint).toBe(fp)
  })
})

describe('fetching: only the room\'s readers get the bytes', () => {
  it('a member and a person whose Pluma is a member get the exact bytes and type', async () => {
    await upload(ada, PNG_1x1)
    const a = await rooms.readAttachment(ctx, asAgent(ben), roomId, hex(PNG_1x1))
    expect(Buffer.from(a.bytes).equals(PNG_1x1)).toBe(true)
    expect(a.type).toBe('image/png')
    const p = await rooms.readAttachment(ctx, { kind: 'person', person: 'ben' }, roomId, hex(PNG_1x1))
    expect(hex(p.bytes)).toBe(hex(PNG_1x1))
  })

  it('a stranger person, a member of another room, and a retired member get the same 404', async () => {
    await upload(ada, PNG_1x1)
    await refused(rooms.readAttachment(ctx, { kind: 'person', person: 'eve' }, roomId, hex(PNG_1x1)), 404)
    const other = await rooms.createRoom(ctx, { person: 'ben', name: 'Other' })
    const benThere = await join(other, "Ben's other Pluma", 'ben')
    await refused(rooms.readAttachment(ctx, asAgent(benThere), roomId, hex(PNG_1x1)), 404)
    await refused(rooms.readAttachment(ctx, { kind: 'agent', roomId, memberId: benThere.memberId }, roomId, hex(PNG_1x1)), 404)
    await rooms.retireMember(ctx, roomId, ben.memberId)
    await refused(rooms.readAttachment(ctx, asAgent(ben), roomId, hex(PNG_1x1)), 404)
  })

  it('a hash the room does not hold is 404', async () => {
    await refused(rooms.readAttachment(ctx, asAgent(ada), roomId, hex(PNG_1x1)), 404)
  })

  it('bytes larger than one stored piece come back whole', async () => {
    const big = png(2000, 2000, rooms.ATTACHMENT_CHUNK_BYTES * 2 + 17)
    randomBytes(big.length - 40).copy(big, 40)
    await upload(ada, big)
    const a = await rooms.readAttachment(ctx, asAgent(ada), roomId, hex(big))
    expect(hex(a.bytes)).toBe(hex(big))
  })
})

describe('appendix A2: the attachment vector every implementation must reproduce', () => {
  it('pins the 1x1 PNG hash, what the host reads from it, and the fingerprint of a version carrying it', async () => {
    expect(PNG_1x1.length).toBe(70)
    expect(hex(PNG_1x1)).toBe('497790947d4666760ce38f3c00e852c71fdb66cae849bae8e9ede352719e1581')
    expect(await upload(ada, PNG_1x1)).toEqual({ sha256: hex(PNG_1x1), size: 70, type: 'image/png', width: 1, height: 1 })
    expect(rooms.fingerprintVersion('words', [{ sha256: hex(PNG_1x1) }])).toBe('e37fee379292325d45a23068dc0febdd1b88c6564f450d537718db02b0aa2d12')
  })
})
