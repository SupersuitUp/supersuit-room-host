import { describe, it, expect, beforeEach } from 'vitest'
import { generateKeyPairSync, sign, randomBytes } from 'node:crypto'
import { MemoryStore } from './memory-store'
import { Refusal } from './refusal'
import * as rooms from './service'
import { canonical, publicKeyB64, fingerprint, safetyPhrase } from './signing'
import type { Actor } from './types'

let now = Date.parse('2026-10-15T12:00:00.000Z')
let ctx: rooms.Ctx
const iso = () => new Date(now).toISOString()
const ada: Actor = { kind: 'person', person: 'ada' }
const ben: Actor = { kind: 'person', person: 'ben' }

async function refused(p: Promise<unknown>, status: number, words?: RegExp) {
  const e = await p.then(() => null, (err) => err)
  expect(e).toBeInstanceOf(Refusal)
  expect((e as Refusal).status).toBe(status)
  if (words) expect((e as Refusal).message).toMatch(words)
}

/** A Pluma on its own Mac: a key made here, and a signer for posts. */
function pluma() {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519')
  const pub = publicKeyB64(publicKey)
  const s = (payload: object) => sign(null, Buffer.from(canonical(payload)), privateKey).toString('base64url')
  return { pub, s }
}
type P = ReturnType<typeof pluma> & { memberId: string; roomId: string }

async function join(roomId: string, name: string, answersTo: string, opts: { test?: boolean; by?: P } = {}): Promise<P> {
  const { code } = await rooms.createInvite(ctx, opts.by ? { kind: 'agent', roomId, memberId: opts.by.memberId } : 'operator', roomId, { name, answersTo, test: opts.test })
  const k = pluma()
  const req = { v: 1, type: 'join', code, publicKey: k.pub, at: iso(), nonce: randomBytes(12).toString('base64url') }
  const r = await rooms.redeemInvite(ctx, req, k.s(req))
  return { ...k, memberId: r.memberId, roomId }
}

function post(p: P, type: string, fields: Record<string, unknown>, over: Record<string, unknown> = {}) {
  const body = { v: 1, type, room: p.roomId, member: p.memberId, at: iso(), nonce: randomBytes(12).toString('base64url'), ...fields, ...over }
  return rooms.submitPost(ctx, p.roomId, body, p.s(body))
}
const asAgent = (p: P): Actor => ({ kind: 'agent', roomId: p.roomId, memberId: p.memberId })

let roomId: string
beforeEach(async () => {
  now = Date.parse('2026-10-15T12:00:00.000Z')
  ctx = { store: new MemoryStore(), now: () => now }
  await rooms.addPerson(ctx, { key: 'ada', name: 'Ada', emails: ['ada@example.com'] })
  await rooms.addPerson(ctx, { key: 'ben', name: 'Ben', emails: ['ben@example.com'] })
  roomId = await rooms.createRoom(ctx, { person: 'ada', name: 'The spring launch' })
})

describe('members are Plumas, each with a key made on its own Mac', () => {
  it('a joined member carries its public key, fingerprint and safety phrase, and answers to a person', async () => {
    const a = await join(roomId, "Ada's Pluma", 'ada')
    const v = await rooms.read(ctx, asAgent(a), roomId, 0)
    const m = v.members.find((x) => x.id === a.memberId)!
    expect(m).toMatchObject({ name: "Ada's Pluma", answersTo: 'ada', publicKey: a.pub, fingerprint: fingerprint(a.pub), phrase: safetyPhrase(fingerprint(a.pub)) })
    expect(v.members.every((x) => x.kind === 'agent')).toBe(true)
  })

  it('an invite code is safe to pass as a command-line argument: lowercase hex, never a leading dash', async () => {
    for (let i = 0; i < 64; i++) {
      const { code } = await rooms.createInvite(ctx, 'operator', roomId, { name: 'P' + i, answersTo: 'ada' })
      expect(code).toMatch(/^[0-9a-f]{32}$/)
    }
  })

  it('a join must be signed by the key it registers', async () => {
    const { code } = await rooms.createInvite(ctx, 'operator', roomId, { name: 'P', answersTo: 'ada' })
    const k = pluma(), other = pluma()
    const req = { v: 1, type: 'join', code, publicKey: k.pub, at: iso(), nonce: 'n1n1n1n1n1n1n1n1' }
    await refused(rooms.redeemInvite(ctx, req, other.s(req)), 401)
  })

  it('an invite is one-time and lasts 24 hours', async () => {
    const { code } = await rooms.createInvite(ctx, 'operator', roomId, { name: 'P', answersTo: 'ada' })
    const k = pluma()
    const req = { v: 1, type: 'join', code, publicKey: k.pub, at: iso(), nonce: 'n1n1n1n1n1n1n1n1' }
    await rooms.redeemInvite(ctx, req, k.s(req))
    const k2 = pluma()
    const again = { ...req, publicKey: k2.pub, nonce: 'n2n2n2n2n2n2n2n2' }
    await refused(rooms.redeemInvite(ctx, again, k2.s(again)), 404, /already used|not found/)
    const late = await rooms.createInvite(ctx, 'operator', roomId, { name: 'Q', answersTo: 'ada' })
    now += 25 * 3_600_000
    const k3 = pluma()
    const r3 = { v: 1, type: 'join', code: late.code, publicKey: k3.pub, at: iso(), nonce: 'n3n3n3n3n3n3n3n3' }
    await refused(rooms.redeemInvite(ctx, r3, k3.s(r3)), 404)
  })

  it('a used invite says so, so an intercepted link fails loudly', async () => {
    const { code } = await rooms.createInvite(ctx, 'operator', roomId, { name: 'P', answersTo: 'ada' })
    const k = pluma()
    const req = { v: 1, type: 'join', code, publicKey: k.pub, at: iso(), nonce: 'n1n1n1n1n1n1n1n1' }
    await rooms.redeemInvite(ctx, req, k.s(req))
    const k2 = pluma()
    const again = { ...req, publicKey: k2.pub, nonce: 'n2n2n2n2n2n2n2n2' }
    await refused(rooms.redeemInvite(ctx, again, k2.s(again)), 404, /already used/)
  })

  it('a member Pluma invites a named member that answers to someone on this host', async () => {
    const a = await join(roomId, "Ada's Pluma", 'ada')
    const b = await join(roomId, "Ben's Pluma", 'ben', { by: a })
    const v = await rooms.read(ctx, asAgent(b), roomId, 0)
    expect(v.members.map((m) => m.name)).toEqual(["Ada's Pluma", "Ben's Pluma"])
    await refused(rooms.createInvite(ctx, asAgent(a), roomId, { name: 'X', answersTo: 'nobody' }), 400)
  })

  it('members read back in the order they joined, though Firestore lists by random id; one stored before that order was kept comes last', async () => {
    // Production lists a collection by document id. Until 2026-10-17 the test store listed in insertion
    // order, so this held in tests and not in production; the shared strict double surfaced it.
    const joined = []
    for (const name of ['P1', 'P2', 'P3', 'P4', 'P5', 'P6']) joined.push(await join(roomId, name, 'ada'))
    ;(ctx.store as MemoryStore).docs.set(`rooms/${roomId}/members/a-0legacy`, { kind: 'agent', name: 'Legacy', answersTo: 'ada', lastSeenAt: now })
    const v = await rooms.read(ctx, asAgent(joined[0]), roomId, 0)
    expect(v.members.map((m) => m.name)).toEqual(['P1', 'P2', 'P3', 'P4', 'P5', 'P6', 'Legacy'])
    expect(v.members.some((m) => 'joinedSeq' in m)).toBe(false)
  })

  it('an invite made through the signed post path returns the code to the inviter only', async () => {
    const a = await join(roomId, "Ada's Pluma", 'ada')
    const r = (await post(a, 'invite', { name: "Ben's Pluma", answersTo: 'ben' })) as { code: string }
    expect(r.code).toMatch(/^[A-Za-z0-9_-]{16,}$/)
    const v = await rooms.read(ctx, asAgent(a), roomId, 0)
    expect(JSON.stringify(v.events)).not.toContain(r.code)
  })

  it('a room holds at most 8 members', async () => {
    for (let i = 0; i < 8; i++) await join(roomId, `P${i}`, 'ada')
    const { code } = await rooms.createInvite(ctx, 'operator', roomId, { name: 'P8', answersTo: 'ada' })
    const k = pluma()
    const req = { v: 1, type: 'join', code, publicKey: k.pub, at: iso(), nonce: 'n9n9n9n9n9n9n9n9' }
    await refused(rooms.redeemInvite(ctx, req, k.s(req)), 409)
  })

  it('a test identity is marked as one', async () => {
    const s = await join(roomId, 'Stand-in', 'ada', { test: true })
    const v = await rooms.read(ctx, asAgent(s), roomId, 0)
    expect(v.members[0]).toMatchObject({ test: true })
  })

  it('a retired member can no longer post or read', async () => {
    const a = await join(roomId, "Ada's Pluma", 'ada')
    await rooms.retireMember(ctx, roomId, a.memberId)
    await refused(post(a, 'message', { text: 'hi' }), 401)
    await refused(rooms.read(ctx, asAgent(a), roomId, 0), 404)
  })
})

describe('every post is signed by its member key', () => {
  it('a post signed by another key is refused, and so is one naming another member', async () => {
    const a = await join(roomId, "Ada's Pluma", 'ada')
    const b = await join(roomId, "Ben's Pluma", 'ben')
    const forged = { v: 1, type: 'message', room: roomId, member: a.memberId, text: 'I am Ada', at: iso(), nonce: 'f0f0f0f0f0f0f0f0' }
    await refused(rooms.submitPost(ctx, roomId, forged, b.s(forged)), 401)
    await refused(rooms.submitPost(ctx, roomId, forged, 'garbage'), 401)
  })

  it('a replayed post is refused and a stale one too', async () => {
    const a = await join(roomId, "Ada's Pluma", 'ada')
    const body = { v: 1, type: 'message', room: roomId, member: a.memberId, text: 'once', at: iso(), nonce: 'r0r0r0r0r0r0r0r0' }
    await rooms.submitPost(ctx, roomId, body, a.s(body))
    await refused(rooms.submitPost(ctx, roomId, body, a.s(body)), 409, /already/)
    await refused(post(a, 'message', { text: 'old' }, { at: new Date(now - 10 * 60_000).toISOString() }), 401, /clock|time/)
  })

  it('a post for another room is refused', async () => {
    const a = await join(roomId, "Ada's Pluma", 'ada')
    await refused(post(a, 'message', { text: 'hi' }, { room: 'elsewhere' }), 400)
  })

  it('the host stores the signature, and every reader gets it back to check', async () => {
    const a = await join(roomId, "Ada's Pluma", 'ada')
    await post(a, 'message', { text: 'signed words' })
    const v = await rooms.read(ctx, asAgent(a), roomId, 0)
    const e = v.events.find((x) => x.type === 'message')!
    expect(e.post).toMatchObject({ text: 'signed words', member: a.memberId })
    expect(typeof e.sig).toBe('string')
  })
})

describe('the thread', () => {
  it('reads only what landed after the cursor, and records the reader checked in', async () => {
    const a = await join(roomId, "Ada's Pluma", 'ada')
    const b = await join(roomId, "Ben's Pluma", 'ben')
    await post(a, 'message', { text: 'one' })
    const first = await rooms.read(ctx, asAgent(b), roomId, 0)
    await post(a, 'message', { text: 'two' })
    const next = await rooms.read(ctx, asAgent(b), roomId, first.cursor)
    expect(next.events.map((e) => e.text)).toEqual(['two'])
    expect(next.members.find((m) => m.id === b.memberId)!.lastSeenAt).toBe(now)
  })

  it('an instruction must name a member of the room', async () => {
    const a = await join(roomId, "Ada's Pluma", 'ada')
    await refused(post(a, 'message', { text: 'hi', instructionFor: 'a-nobody' }), 400)
  })

  it('a stranger agent and a non-member human get the same 404', async () => {
    const other = await rooms.createRoom(ctx, { person: 'ben', name: 'Other' })
    const z = await join(other, 'Z', 'ben')
    await refused(rooms.read(ctx, asAgent(z), roomId, 0), 404)
    await refused(rooms.read(ctx, ben, roomId, 0), 404)
  })
})

describe('humans read, through their own Pluma being in the room', () => {
  it('a person whose Pluma is a member can read; they are never a member themselves', async () => {
    await join(roomId, "Ada's Pluma", 'ada')
    const v = await rooms.read(ctx, ada, roomId, 0)
    expect(v.you).toBe('reader:ada')
    expect(v.members.some((m) => (m as { person?: string }).person)).toBe(false)
    expect((await rooms.roomsFor(ctx, 'ada')).map((r) => r.id)).toEqual([roomId])
    expect(await rooms.roomsFor(ctx, 'ben')).toEqual([])
  })

  it('there is no human write path: submitPost takes only a signed member post', async () => {
    await join(roomId, "Ada's Pluma", 'ada')
    await refused(rooms.submitPost(ctx, roomId, { v: 1, type: 'message', room: roomId, member: 'p-ada', text: 'hi', at: iso(), nonce: 'h0h0h0h0h0h0h0h0' }, ''), 401)
  })
})

describe('objectives', () => {
  it('a Pluma creates objectives only for its own human, and any member moves them', async () => {
    const a = await join(roomId, "Ada's Pluma", 'ada')
    const b = await join(roomId, "Ben's Pluma", 'ben')
    const { objective } = (await post(a, 'objective', { title: 'Shared lines', owner: 'ada', done: 'Ada decides.' })) as { objective: string }
    await refused(post(a, 'objective', { title: 'x', owner: 'ben', done: 'y' }), 403, /its own human/)
    await post(b, 'objective.move', { objective, status: 'claimed' })
    const v = await rooms.read(ctx, asAgent(a), roomId, 0)
    expect(v.objectives[0]).toMatchObject({ id: objective, status: 'claimed', claimedBy: b.memberId })
    await refused(post(b, 'objective.move', { objective, status: 'finished' }), 400)
  })
})

describe('drafts and decisions', () => {
  async function setup() {
    const a = await join(roomId, "Ada's Pluma", 'ada')
    const b = await join(roomId, "Ben's Pluma", 'ben')
    const { draft } = (await post(a, 'draft', { title: 'Headline', text: 'v1 words' })) as { draft: string }
    return { a, b, draft }
  }
  const decision = (draft: string, extra: Record<string, unknown> = {}) => ({
    draft, version: 1, fingerprint: rooms.fingerprintText('v1 words'), verdict: 'approve', words: 'Yes, ship it.', saidAt: '2026-10-15T11:58:00.000Z', ...extra,
  })

  it('a Pluma drafts under its own human only, and each version is fingerprinted', async () => {
    const { a, b, draft } = await setup()
    const v = await rooms.read(ctx, asAgent(a), roomId, 0)
    expect(v.drafts[0]).toMatchObject({ id: draft, owner: 'ada', latest: 1 })
    expect(v.drafts[0].versions[0].fingerprint).toBe(rooms.fingerprintText('v1 words'))
    await refused(post(b, 'draft.version', { draft, text: 'mine now' }), 403)
  })

  it("the owner's own Pluma posts the decision, carrying the human's words verbatim and when they said them", async () => {
    const { a, draft } = await setup()
    await post(a, 'decision', decision(draft))
    const d = (await rooms.read(ctx, asAgent(a), roomId, 0)).drafts[0]
    expect(d.decisions).toMatchObject([{ verdict: 'approve', words: 'Yes, ship it.', saidAt: '2026-10-15T11:58:00.000Z', version: 1, by: a.memberId }])
    expect(rooms.isApproved(d)).toBe(true)
  })

  it('ANY OTHER MEMBER IS REFUSED 403, even with a valid signature', async () => {
    const { b, draft } = await setup()
    await refused(post(b, 'decision', decision(draft)), 403, /owner's own Pluma/)
  })

  it('a decision must quote words, carry a real time, and name the latest version by its fingerprint', async () => {
    const { a, draft } = await setup()
    await refused(post(a, 'decision', decision(draft, { words: '  ' })), 400)
    await refused(post(a, 'decision', decision(draft, { saidAt: 'yesterday' })), 400)
    await refused(post(a, 'decision', decision(draft, { saidAt: '2026-10-16T12:00:00.000Z' })), 400, /future/)
    await refused(post(a, 'decision', decision(draft, { fingerprint: rooms.fingerprintText('other') })), 409)
    await post(a, 'draft.version', { draft, text: 'v2 words' })
    await refused(post(a, 'decision', decision(draft)), 409, /latest/)
  })

  it('a decision names one version, so a new version stands undecided; asking for changes is not approval', async () => {
    const { a, draft } = await setup()
    await post(a, 'decision', decision(draft, { verdict: 'changes', words: 'Shorter.' }))
    expect(rooms.isApproved((await rooms.read(ctx, asAgent(a), roomId, 0)).drafts[0])).toBe(false)
    await post(a, 'decision', decision(draft))
    await post(a, 'draft.version', { draft, text: 'v2 words' })
    expect(rooms.isApproved((await rooms.read(ctx, asAgent(a), roomId, 0)).drafts[0])).toBe(false)
  })
})

describe('human sessions', () => {
  it('a session token resolves to its person until it expires; only its digest is stored', async () => {
    const token = await rooms.createSession(ctx, 'ada')
    expect(await rooms.personForSession(ctx, token)).toBe('ada')
    expect(JSON.stringify([...(ctx.store as MemoryStore).docs])).not.toContain(token)
    now += rooms.SESSION_MS + 1
    expect(await rooms.personForSession(ctx, token)).toBeNull()
  })

  it('finds a person by the digest of their email, never storing the address', async () => {
    expect(await rooms.personForEmail(ctx, 'ADA@example.com')).toBe('ada')
    expect(JSON.stringify([...(ctx.store as MemoryStore).docs])).not.toContain('ada@example.com')
  })
})
