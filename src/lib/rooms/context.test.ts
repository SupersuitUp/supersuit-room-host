// Protocol v0.3, section 7: the context library. Bytes go straight to the object store through a
// session the host binds to size, type and crc32c; the item is listed only once the store holds
// exactly those bytes; readers get 15-minute signed addresses; the host declares its house rules.
import { describe, it, expect, beforeEach } from 'vitest'
import { createHash, generateKeyPairSync, randomBytes, sign } from 'node:crypto'
import { MemoryStore } from './memory-store'
import { MemoryObjectStore, contextPath } from './object-store'
import { Refusal } from './refusal'
import * as rooms from './service'
import { canonical, publicKeyB64 } from './signing'
import { crc32cBase64 } from './crc32c'
import { PNG_1x1 } from './test-images'
import type { Actor } from './types'

let now = Date.parse('2026-10-17T12:00:00.000Z')
let ctx: rooms.Ctx
let objects: MemoryObjectStore
let roomId: string
const DAY = 86_400_000
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
const asAgent = (p: P): Actor => ({ kind: 'agent', roomId: p.roomId, memberId: p.memberId })
const meta = (bytes: Uint8Array, over: Record<string, unknown> = {}) =>
  ({ sha256: hex(bytes), crc32c: crc32cBase64(bytes), size: bytes.length, contentType: 'application/pdf', name: 'brief.pdf', ...over })
const uploadReq = (p: P, bytes: Uint8Array, over: Record<string, unknown> = {}) =>
  ({ v: 1, type: 'context.upload', room: p.roomId, member: p.memberId, ...meta(bytes), at: iso(), nonce: nonce(), ...over })
const askUpload = (p: P, bytes: Uint8Array, over: Record<string, unknown> = {}) => {
  const req = uploadReq(p, bytes, over)
  return rooms.requestContextUpload(ctx, p.roomId, req, p.s(req))
}
function post(p: P, type: string, fields: Record<string, unknown>) {
  const body = { v: 1, type, room: p.roomId, member: p.memberId, at: iso(), nonce: nonce(), ...fields }
  return rooms.submitPost(ctx, p.roomId, body, p.s(body))
}
/** The whole member side: ask, upload to the session, add with a why. */
async function bring(p: P, bytes: Uint8Array, why = 'the brief we are working from', over: Record<string, unknown> = {}) {
  const r = await askUpload(p, bytes, over)
  if (!r.held) await objects.finish(r.uploadUrl, bytes)
  const { sha256, crc32c, size, contentType, name } = meta(bytes, over)
  return (await post(p, 'context.add', { sha256, crc32c, size, contentType, name, why })) as { item: rooms.ContextItem }
}
const fetchAs = (actor: Actor, sha: string) => rooms.fetchContext(ctx, actor, roomId, sha)

let ada: P, ben: P
const FILE = randomBytes(3000)
beforeEach(async () => {
  now = Date.parse('2026-10-17T12:00:00.000Z')
  objects = new MemoryObjectStore()
  objects.now = () => now
  ctx = { store: new MemoryStore(), now: () => now, objects }
  for (const k of ['ada', 'ben', 'eve']) await rooms.addPerson(ctx, { key: k, name: k.toUpperCase(), emails: [`${k}@example.com`] })
  roomId = await rooms.createRoom(ctx, { person: 'ada', name: 'Room' })
  ada = await join(roomId, "Ada's Pluma", 'ada')
  ben = await join(roomId, "Ben's Pluma", 'ben')
})

describe('uploading: the host opens a session bound to the signed bytes, and never takes the bytes itself', () => {
  it('answers held:false with an upload address bound to exactly that size, content type and crc32c', async () => {
    const r = await askUpload(ada, FILE)
    expect(r.held).toBe(false)
    if (r.held) return
    expect(objects.sessions.get(r.uploadUrl)).toEqual({ path: contextPath(roomId, hex(FILE)), size: FILE.length, contentType: 'application/pdf', crc32c: crc32cBase64(FILE) })
  })

  it('the store refuses bytes of another crc32c or size than the session was bound to', async () => {
    const r = await askUpload(ada, FILE)
    if (r.held) throw new Error('expected a session')
    const swapped = randomBytes(FILE.length)
    await expect(objects.finish(r.uploadUrl, swapped)).rejects.toThrow(/crc32c/)
    await expect(objects.finish(r.uploadUrl, FILE.subarray(1))).rejects.toThrow(/size/)
  })

  it('answers held:true when this room already holds those bytes, and bytes held by another room do not count', async () => {
    await bring(ada, FILE)
    expect(await askUpload(ben, FILE)).toEqual({ held: true })
    const other = await rooms.createRoom(ctx, { person: 'ada', name: 'Other' })
    const adaThere = await join(other, "Ada's Pluma", 'ada')
    expect((await askUpload(adaThere, FILE)).held).toBe(false)
  })

  it('sets no size limit: a terabyte is a session like any other, never a 413', async () => {
    const r = await askUpload(ada, FILE, { size: 2 ** 40 })
    expect(r.held).toBe(false)
  })

  it('allow-lists no content type: whatever the member says is what the session is bound to', async () => {
    const r = await askUpload(ada, FILE, { contentType: 'application/x-remotion-project' })
    if (r.held) throw new Error('expected a session')
    expect(objects.sessions.get(r.uploadUrl)!.contentType).toBe('application/x-remotion-project')
  })

  it('an unsigned, wrongly signed or stale request is 401, a used nonce 409, a closed room 409', async () => {
    const req = uploadReq(ada, FILE)
    await refused(rooms.requestContextUpload(ctx, roomId, req, ''), 401)
    await refused(rooms.requestContextUpload(ctx, roomId, req, ben.s(req)), 401)
    const stale = uploadReq(ada, FILE, { at: new Date(now - 10 * 60_000).toISOString() })
    await refused(rooms.requestContextUpload(ctx, roomId, stale, ada.s(stale)), 401)
    await rooms.requestContextUpload(ctx, roomId, req, ada.s(req))
    await refused(rooms.requestContextUpload(ctx, roomId, req, ada.s(req)), 409)
    await rooms.closeRoom(ctx, roomId)
    await refused(askUpload(ada, FILE), 409, /closed/)
  })

  it('a malformed request is 400: a bad sha256, crc32c, size or name', async () => {
    await refused(askUpload(ada, FILE, { sha256: 'abc' }), 400)
    await refused(askUpload(ada, FILE, { crc32c: 'nope' }), 400)
    await refused(askUpload(ada, FILE, { size: -1 }), 400)
    await refused(askUpload(ada, FILE, { size: 1.5 }), 400)
    await refused(askUpload(ada, FILE, { name: '' }), 400)
    await refused(askUpload(ada, FILE, { name: 'x'.repeat(201) }), 400)
    await refused(askUpload(ada, FILE, { contentType: '' }), 400)
  })

  it('a sha256 the room lists as retired is 409: it can never be listed again', async () => {
    await bring(ada, FILE)
    await post(ada, 'context.retire', { sha256: hex(FILE) })
    await refused(askUpload(ada, FILE), 409, /retired/)
  })
})

describe('context.add: the item is listed only after the store holds exactly the bytes signed', () => {
  it('records the item with who brought it, the person they answer to, and why; it is an event in the thread', async () => {
    const { item } = await bring(ada, FILE, 'the brief Wilson wrote')
    expect(item).toEqual({ sha256: hex(FILE), crc32c: crc32cBase64(FILE), size: FILE.length, name: 'brief.pdf', contentType: 'application/pdf', why: 'the brief Wilson wrote', from: ada.memberId, answersTo: 'ada', at: now, notes: [] })
    const v = await rooms.read(ctx, asAgent(ben), roomId, 0)
    const e = v.events.find((x) => x.type === 'context.add')!
    expect(e).toMatchObject({ by: ada.memberId, sha256: hex(FILE), name: 'brief.pdf', why: 'the brief Wilson wrote' })
    expect(e.sig).toBeTruthy()
  })

  it('is 400 when the store holds no such bytes, or bytes of another size or crc32c', async () => {
    const m = meta(FILE)
    await refused(post(ada, 'context.add', { ...m, why: 'w' }), 400, /store/)
    const other = randomBytes(FILE.length)
    objects.put(contextPath(roomId, hex(FILE)), other)
    await refused(post(ada, 'context.add', { ...m, why: 'w' }), 400, /store/)
    objects.put(contextPath(roomId, hex(FILE)), FILE.subarray(0, 100))
    await refused(post(ada, 'context.add', { ...m, why: 'w' }), 400, /store/)
  })

  it('requires a why of 1 to 2,000 characters', async () => {
    const r = await askUpload(ada, FILE)
    if (!r.held) await objects.finish(r.uploadUrl, FILE)
    await refused(post(ada, 'context.add', { ...meta(FILE) }), 400, /why/)
    await refused(post(ada, 'context.add', { ...meta(FILE), why: '  ' }), 400, /why/)
    await refused(post(ada, 'context.add', { ...meta(FILE), why: 'x'.repeat(2001) }), 400, /why/)
    await post(ada, 'context.add', { ...meta(FILE), why: 'x'.repeat(2000) })
  })

  it('a sha256 the room already lists is 409; an unknown objective is 400; a known one is kept', async () => {
    await bring(ada, FILE)
    await refused(post(ben, 'context.add', { ...meta(FILE), why: 'again' }), 409)
    const two = randomBytes(10)
    const r = await askUpload(ada, two)
    if (!r.held) await objects.finish(r.uploadUrl, two)
    await refused(post(ada, 'context.add', { ...meta(two), why: 'w', objective: 'o-nope' }), 400, /objective/)
    const { objective } = (await post(ada, 'objective', { title: 'Ship', owner: 'ada', done: 'shipped' })) as { objective: string }
    const { item } = (await post(ada, 'context.add', { ...meta(two), why: 'w', objective })) as { item: rooms.ContextItem }
    expect(item.objective).toBe(objective)
  })
})

describe('context.note and context.retire', () => {
  it('any member notes a listed item; notes come back on the item in the events answer', async () => {
    await bring(ada, FILE)
    const { item } = (await post(ben, 'context.note', { sha256: hex(FILE), text: 'page 3 is the one' })) as { item: rooms.ContextItem }
    expect(item.notes).toEqual([{ member: ben.memberId, text: 'page 3 is the one', at: now }])
    const v = await rooms.read(ctx, { kind: 'person', person: 'ben' }, roomId, 0)
    expect(v.context.map((c) => c.notes.length)).toEqual([1])
    expect(v.events.at(-1)).toMatchObject({ type: 'context.note', sha256: hex(FILE), text: 'page 3 is the one' })
  })

  it('a note is 1 to 2,000 characters, on an item the room lists and has not retired', async () => {
    await bring(ada, FILE)
    await refused(post(ben, 'context.note', { sha256: hex(FILE), text: '' }), 400)
    await refused(post(ben, 'context.note', { sha256: hex(FILE), text: 'x'.repeat(2001) }), 400)
    await refused(post(ben, 'context.note', { sha256: hex(randomBytes(5)), text: 'x' }), 404)
    await post(ada, 'context.retire', { sha256: hex(FILE) })
    await refused(post(ben, 'context.note', { sha256: hex(FILE), text: 'x' }), 409, /retired/)
  })

  it('only the member that added an item retires it; retiring deletes the bytes and keeps the record', async () => {
    await bring(ada, FILE)
    await refused(post(ben, 'context.retire', { sha256: hex(FILE) }), 403)
    const { item } = (await post(ada, 'context.retire', { sha256: hex(FILE) })) as { item: rooms.ContextItem }
    expect(item.retired).toBe(true)
    expect(await objects.stat(contextPath(roomId, hex(FILE)))).toBeNull()
    const v = await rooms.read(ctx, asAgent(ben), roomId, 0)
    expect(v.context).toHaveLength(1)
    expect(v.context[0]).toMatchObject({ sha256: hex(FILE), retired: true, why: 'the brief we are working from' })
    await refused(post(ada, 'context.retire', { sha256: hex(FILE) }), 409)
  })
})

describe('posts name context items, and the signature and fingerprint cover the list', () => {
  it('a message, draft, revision and decision may carry context; the list comes back on the event', async () => {
    await bring(ada, FILE)
    const sha = hex(FILE)
    await post(ben, 'message', { text: 'see the brief', context: [sha] })
    expect((await rooms.read(ctx, asAgent(ada), roomId, 0)).events.at(-1)).toMatchObject({ type: 'message', context: [sha] })
    const { draft } = (await post(ada, 'draft', { title: 'Cut', text: 'v1', context: [sha] })) as { draft: string }
    await post(ada, 'draft.version', { draft, text: 'v2', context: [sha] })
    const d = (await rooms.read(ctx, asAgent(ada), roomId, 0)).drafts[0]
    expect(d.versions.map((x) => x.context)).toEqual([[sha], [sha]])
    await post(ada, 'decision', { draft, version: 2, fingerprint: d.versions[1].fingerprint, verdict: 'approve', words: 'Yes.', saidAt: iso(), context: [sha] })
    expect((await rooms.read(ctx, asAgent(ada), roomId, 0)).drafts[0].decisions[0].context).toEqual([sha])
  })

  it('names only items the room lists and has not retired, 1 to 32 of them, on those four post types', async () => {
    await bring(ada, FILE)
    const sha = hex(FILE)
    await refused(post(ada, 'message', { text: 'x', context: [hex(randomBytes(4))] }), 400, /library/)
    await refused(post(ada, 'message', { text: 'x', context: [] }), 400)
    await refused(post(ada, 'message', { text: 'x', context: 'nope' }), 400)
    await refused(post(ada, 'message', { text: 'x', context: Array(33).fill(sha) }), 400, /32/)
    await refused(post(ada, 'objective', { title: 't', owner: 'ada', done: 'd', context: [sha] }), 400, /cannot carry/)
    await post(ada, 'context.retire', { sha256: sha })
    await refused(post(ada, 'message', { text: 'x', context: [sha] }), 400, /retired/)
  })

  it('swapping the list after signing breaks the signature', async () => {
    await bring(ada, FILE)
    const two = randomBytes(9)
    await bring(ada, two, 'another')
    const body = { v: 1, type: 'message', room: roomId, member: ada.memberId, at: iso(), nonce: nonce(), text: 'x', context: [hex(FILE)] }
    const sig = ada.s(body)
    await refused(rooms.submitPost(ctx, roomId, { ...body, context: [hex(two)] }, sig), 401)
  })

  it('a version with context is fingerprinted over {attachments, context, text}; one without keeps v0.2 byte for byte', async () => {
    const sha = hex(FILE)
    expect(rooms.fingerprintVersion('words', [{ sha256: hex(PNG_1x1) }])).toBe('e37fee379292325d45a23068dc0febdd1b88c6564f450d537718db02b0aa2d12')
    expect(rooms.fingerprintVersion('words', [], [])).toBe(rooms.fingerprintText('words'))
    expect(rooms.fingerprintVersion('words', [{ sha256: hex(PNG_1x1) }], [])).toBe('e37fee379292325d45a23068dc0febdd1b88c6564f450d537718db02b0aa2d12')
    const h = (o: object) => createHash('sha256').update(canonical(o)).digest('hex')
    expect(rooms.fingerprintVersion('words', [], [sha])).toBe(h({ attachments: [], context: [sha], text: 'words' }))
    expect(rooms.fingerprintVersion('words', [{ sha256: hex(PNG_1x1) }], [sha])).toBe(h({ attachments: [hex(PNG_1x1)], context: [sha], text: 'words' }))
    await bring(ada, FILE)
    await post(ada, 'draft', { title: 'T', text: 'words', context: [sha] })
    expect((await rooms.read(ctx, asAgent(ada), roomId, 0)).drafts[0].versions[0].fingerprint).toBe(h({ attachments: [], context: [sha], text: 'words' }))
  })
})

describe('fetching: a 15-minute signed address, to the room\'s readers only', () => {
  it('a member and a person whose Pluma is a member get the item and a signed address valid 15 minutes', async () => {
    await bring(ada, FILE)
    const r = await fetchAs(asAgent(ben), hex(FILE))
    expect(r.item.sha256).toBe(hex(FILE))
    expect(new URL(r.downloadUrl).searchParams.get('expires')).toBe(String(now + 15 * 60_000))
    expect((await fetchAs({ kind: 'person', person: 'ada' }, hex(FILE))).item.name).toBe('brief.pdf')
  })

  it('a stranger, a member of another room and a retired member get 404; an unlisted hash 404', async () => {
    await bring(ada, FILE)
    await refused(fetchAs({ kind: 'person', person: 'eve' }, hex(FILE)), 404)
    const other = await rooms.createRoom(ctx, { person: 'ben', name: 'Other' })
    const benThere = await join(other, "Ben's other Pluma", 'ben')
    await refused(fetchAs({ kind: 'agent', roomId, memberId: benThere.memberId }, hex(FILE)), 404)
    await rooms.retireMember(ctx, roomId, ben.memberId)
    await refused(fetchAs(asAgent(ben), hex(FILE)), 404)
    await refused(fetchAs(asAgent(ada), hex(randomBytes(3))), 404)
  })

  it('a retired item answers 410', async () => {
    await bring(ada, FILE)
    await post(ada, 'context.retire', { sha256: hex(FILE) })
    await refused(fetchAs(asAgent(ada), hex(FILE)), 410)
  })

  it('a signed fetch must name the hash it fetches', async () => {
    await bring(ada, FILE)
    const req = { v: 1, type: 'context.fetch', room: roomId, member: ada.memberId, sha256: hex(randomBytes(2)), at: iso(), nonce: nonce() }
    await refused(rooms.agentForSignedContextFetch(ctx, roomId, hex(FILE), req, ada.s(req)), 401)
    const ok = { ...req, sha256: hex(FILE) }
    expect(await rooms.agentForSignedContextFetch(ctx, roomId, hex(FILE), ok, ada.s(ok))).toEqual(asAgent(ada))
  })
})

describe('housekeeping: the host deletes what its declaration says, and enforces only the limits it declares', () => {
  it('declares protocol 0.3, no limits, and the retention it keeps', () => {
    expect(rooms.HOUSEKEEPING_DECLARATION).toEqual({ protocol: '0.3', housekeeping: { limits: {}, whileOpen: 'keep', afterCloseDays: 30, unclaimedUploadDays: 7, memberMayDelete: true, ownerMayDeleteRoom: true } })
  })

  it('deletes uploads no context.add claimed within 7 days, keeps younger ones and listed ones', async () => {
    await bring(ada, FILE)
    const stale = randomBytes(7), fresh = randomBytes(8)
    objects.put(contextPath(roomId, hex(stale)), stale, 'x', now - 8 * DAY)
    objects.put(contextPath(roomId, hex(fresh)), fresh, 'x', now - 6 * DAY)
    now += 30 * DAY
    objects.put(contextPath(roomId, hex(fresh)), fresh, 'x', now - 6 * DAY)
    const r = await rooms.housekeep(ctx)
    expect(r.unclaimedDeleted).toBe(1)
    expect(await objects.stat(contextPath(roomId, hex(stale)))).toBeNull()
    expect(await objects.stat(contextPath(roomId, hex(fresh)))).not.toBeNull()
    expect(await objects.stat(contextPath(roomId, hex(FILE)))).not.toBeNull()
  })

  it('deletes a closed room\'s context bytes after 30 days, keeps the records, and the fetch then answers 410', async () => {
    await bring(ada, FILE)
    await rooms.closeRoom(ctx, roomId)
    now += 29 * DAY
    await rooms.housekeep(ctx)
    expect(await objects.stat(contextPath(roomId, hex(FILE)))).not.toBeNull()
    now += 2 * DAY
    const r = await rooms.housekeep(ctx)
    expect(r.closedRoomsPurged).toBe(1)
    expect(await objects.stat(contextPath(roomId, hex(FILE)))).toBeNull()
    expect((await rooms.read(ctx, asAgent(ada), roomId, 0)).context).toHaveLength(1)
    await refused(fetchAs(asAgent(ada), hex(FILE)), 410, /closed/)
  })

  it('removes the bytes of a retired item if they are still there', async () => {
    await bring(ada, FILE)
    await post(ada, 'context.retire', { sha256: hex(FILE) })
    objects.put(contextPath(roomId, hex(FILE)), FILE)
    await rooms.housekeep(ctx)
    expect(await objects.stat(contextPath(roomId, hex(FILE)))).toBeNull()
  })

  it('closing a room is an event, and a closed room refuses context posts', async () => {
    await bring(ada, FILE)
    await rooms.closeRoom(ctx, roomId)
    const v = await rooms.read(ctx, asAgent(ada), roomId, 0)
    expect(v.room.state).toBe('closed')
    expect(v.events.at(-1)).toMatchObject({ type: 'room.closed', by: 'host' })
    await refused(post(ben, 'context.note', { sha256: hex(FILE), text: 'x' }), 409, /closed/)
  })

  it('deleting a room\'s context removes every byte under it', async () => {
    await bring(ada, FILE)
    objects.put(contextPath(roomId, hex(PNG_1x1)), PNG_1x1)
    expect(await rooms.deleteRoomContext(ctx, roomId)).toBe(2)
    expect(await objects.list(`rooms/${roomId}/`)).toEqual([])
  })
})

describe('appendix A3: the context vector every implementation must reproduce', () => {
  it('pins the file "123456789", its crc32c, and the fingerprint of a version naming it, with and without an attachment', () => {
    const file = Buffer.from('123456789')
    expect(hex(file)).toBe('15e2b0d3c33891ebb0f1ef609ec419420c20e320ce94c65fbc8c3312448eb225')
    expect(crc32cBase64(file)).toBe('4waSgw==')
    expect(rooms.fingerprintVersion('words', [], [hex(file)])).toBe('91e3f9fc82acbd8128577991d4c7db14ccedeb0ff6474acf6dab48c6e459621d')
    expect(rooms.fingerprintVersion('words', [{ sha256: hex(PNG_1x1) }], [hex(file)])).toBe('2016752530e98a3c747dca0436f7d4939555684a3af25d173749180d093f39f5')
  })
})
