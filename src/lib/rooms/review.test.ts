// The independent review of v0.4 (2026-11-07). Each test is the exploit or the defect the review named,
// written first, so it failed before its fix.
import { describe, it, expect, beforeEach } from 'vitest'
import { canonical } from './signing'
import { createPublicKey, verify } from 'node:crypto'
import { newDeviceKey, signEntry } from '@supersuit/suit-identity'
import { MemoryStore } from './memory-store'
import { Refusal } from './refusal'
import * as rooms from './service'
import { asAgent, join, nonce, pluma, post, type P } from './test-members'
import { tetherLog } from '../tether-log/model.ts'
import type { RoomEvent } from './types'

const AUD = 'https://rooms.supersuit.co'
const suitA = newDeviceKey(), suitB = newDeviceKey()
let ctx: rooms.Ctx
const refused = async (p: Promise<unknown>, status: number) => {
  const e = await p.then(() => null, (x) => x)
  expect(e).toBeInstanceOf(Refusal)
  expect((e as Refusal).status).toBe(status)
}
const iso = () => new Date(ctx.now()).toISOString()

/** A tether opened under a suit key. */
async function start(handle = 'ada-lovelace', suit = suitA, over: Record<string, unknown> = {}): Promise<P> {
  const k = pluma()
  const r = await rooms.startTether(ctx, signEntry({ op: 'tether-start', aud: AUD, handle, personName: 'Ada', memberName: "Ada's Pluma", name: 'The launch', publicKey: k.pub, at: iso(), nonce: nonce(), ...over }, suit.priv))
  return { ...k, memberId: r.memberId, roomId: r.roomId }
}
/** A handle invite, redeemed with the invited suit's signature over the join (or with none). */
async function joinHandle(by: P, handle: string, suit: typeof suitA | null, personName = 'Ben'): Promise<P> {
  const { code } = await post(ctx, by, 'invite', { name: `${personName}'s Pluma`, handle, personName }) as { code: string }
  const k = pluma()
  const bare = { v: 1, type: 'join', code, publicKey: k.pub, at: iso(), nonce: nonce() }
  const req = suit ? { ...bare, suitSig: signEntry(bare, suit.priv).sig } : bare
  const r = await rooms.redeemInvite(ctx, req, k.s(req))
  return { ...k, memberId: r.memberId, roomId: by.roomId }
}
const readerSession = async (p: P) => {
  const { path } = await post(ctx, p, 'reader.link', {}) as { path: string }
  return (await rooms.redeemReaderLink(ctx, path.replace('/open/', '')))!.session
}
const personActor = async (session: string) => {
  const s = (await rooms.sessionFor(ctx, session))!
  return { kind: 'person', person: s.person, room: s.room } as const
}

beforeEach(() => {
  ctx = {
    store: new MemoryStore(), now: () => Date.parse('2026-11-07T12:00:00.000Z'),
    directory: async (h) => (h === 'ada-lovelace' ? { suit: 'sA', keys: [suitA.pub] } : h === 'ben-franklin' ? { suit: 'sB', keys: [suitB.pub] } : null),
  }
})

describe('1. a person is proven before a reader link', () => {
  it('a member cannot invite a Pluma that answers to someone else and sign in as them', async () => {
    await rooms.addPerson(ctx, { key: 'ben', name: 'Ben', emails: ['ben@example.com'] })
    const ada = await start()
    const { code } = await post(ctx, ada, 'invite', { name: 'Fake', answersTo: 'ben' }) as { code: string }
    const k = pluma()
    const req = { v: 1, type: 'join', code, publicKey: k.pub, at: iso(), nonce: nonce() }
    const r = await rooms.redeemInvite(ctx, req, k.s(req))
    await refused(post(ctx, { ...k, memberId: r.memberId, roomId: ada.roomId }, 'reader.link', {}), 403)
  })
  it('a plain invite may not name a handle person, even one this host already holds', async () => {
    const ada = await start()
    await joinHandle(ada, 'ben-franklin', suitB)
    await refused(post(ctx, ada, 'invite', { name: 'Fake', answersTo: '@ben-franklin' }), 400)
  })
  it('a handle invite needs the invited suit to sign the join', async () => {
    const ada = await start()
    await refused(joinHandle(ada, 'ben-franklin', null), 401)
    await refused(joinHandle(ada, 'ben-franklin', suitA), 401)
    const ben = await joinHandle(ada, 'ben-franklin', suitB)
    expect(await readerSession(ben)).toBeTruthy()
  })
  it('a reader-link session reads only the room it came from', async () => {
    const one = await start()
    const two = await start()
    const who = await personActor(await readerSession(one))
    expect((await rooms.read(ctx, who, one.roomId, 0)).room.id).toBe(one.roomId)
    await refused(rooms.read(ctx, who, two.roomId, 0), 404)
    await refused(rooms.readLog(ctx, who, two.roomId), 404)
    await refused(rooms.readAttachment(ctx, who, two.roomId, 'a'.repeat(64)), 404)
    expect((await rooms.roomsFor(ctx, who.person, who.room)).map((r) => r.id)).toEqual([one.roomId])
  })
})

describe('2. handles and email people never share a key', () => {
  it('a handle equal to an email person\'s key does not take that person over', async () => {
    await rooms.addPerson(ctx, { key: 'ada-lovelace', name: 'Someone else', emails: ['x@example.com'] })
    const theirs = await rooms.createRoom(ctx, { person: 'ada-lovelace', name: 'Private' })
    await join(ctx, theirs, 'Their Pluma', 'ada-lovelace')
    const ada = await start()
    expect(await ctx.store.get('people/ada-lovelace')).toMatchObject({ name: 'Someone else' })
    const v = await rooms.read(ctx, asAgent(ada), ada.roomId, 0)
    expect(v.members[0].answersTo).toBe('@ada-lovelace')
    const who = await personActor(await readerSession(ada))
    expect(who.person).toBe('@ada-lovelace')
    await refused(rooms.read(ctx, { kind: 'person', person: who.person }, theirs, 0), 404)
  })
})

describe('3. a share needs real yeses', () => {
  it('a yes from an unproven member does not count', async () => {
    await rooms.addPerson(ctx, { key: 'ben', name: 'Ben', emails: [] })
    const ada = await start()
    const { code } = await post(ctx, ada, 'invite', { name: 'Not Ben', answersTo: 'ben' }) as { code: string }
    const k = pluma()
    const req = { v: 1, type: 'join', code, publicKey: k.pub, at: iso(), nonce: nonce() }
    const fake = { ...k, memberId: (await rooms.redeemInvite(ctx, req, k.s(req))).memberId, roomId: ada.roomId }
    const seq = (await ctx.store.get(`rooms/${ada.roomId}`))!.seq as number
    const { share } = await post(ctx, ada, 'share.request', { upTo: seq }) as { share: string }
    await refused(post(ctx, fake, 'share.approve', { share }), 403)
  })
  it('a yes from a member that joined after the request does not count', async () => {
    const ada = await start()
    const ben = await joinHandle(ada, 'ben-franklin', suitB)
    const seq = (await ctx.store.get(`rooms/${ada.roomId}`))!.seq as number
    const { share } = await post(ctx, ada, 'share.request', { upTo: seq }) as { share: string }
    const late = await joinHandle(ada, 'ben-franklin', suitB)
    await refused(post(ctx, late, 'share.approve', { share }), 403)
    expect((await post(ctx, ben, 'share.approve', { share }) as { status: string }).status).toBe('live')
  })
})

describe('4. a taken-back decision is not an approval', () => {
  it('isApproved and the model both stop counting it', async () => {
    await rooms.addPerson(ctx, { key: 'ada', name: 'Ada', emails: [] })
    const roomId = await rooms.createRoom(ctx, { person: 'ada', name: 'R' })
    const ada = await join(ctx, roomId, "Ada's Pluma", 'ada')
    const { draft } = await post(ctx, ada, 'draft', { title: 'T', text: 'w' }) as { draft: string }
    const { seq } = await post(ctx, ada, 'decision', { draft, version: 1, fingerprint: rooms.fingerprintText('w'), verdict: 'approve', words: 'Yes.', saidAt: iso() }) as { seq?: number }
    void seq
    const decided = (await rooms.read(ctx, asAgent(ada), roomId, 0)).events.find((e) => e.type === 'decision')!
    await post(ctx, ada, 'redact', { target: decided.seq })
    const log = await rooms.readLog(ctx, asAgent(ada), roomId)
    expect(rooms.isApproved(log.drafts[0], log.members)).toBe(false)
    expect(tetherLog(log).open.map((o) => o.ref)).toContain('Draft')
  })
})

describe('5. a share shows the log as it stood at upTo', () => {
  it('leaves out later objectives, later wordings and later members', async () => {
    const ada = await start()
    const { objective } = await post(ctx, ada, 'objective', { title: 'First aim', done: 'First done', owner: '@ada-lovelace' }) as { objective: string }
    const upTo = (await ctx.store.get(`rooms/${ada.roomId}`))!.seq as number
    const { share } = await post(ctx, ada, 'share.request', { upTo }) as { share: string, token: string }
    const token = (await rooms.read(ctx, asAgent(ada), ada.roomId, 0)).shares.find((s) => s.id === share)!.token!
    await post(ctx, ada, 'objective.amend', { objective, title: 'Secret new aim', reason: 'private reason' })
    await post(ctx, ada, 'objective', { title: 'Second secret aim', done: 'x', owner: '@ada-lovelace' })
    await joinHandle(ada, 'ben-franklin', suitB)
    const s = (await rooms.readShare(ctx, token))!
    const all = JSON.stringify(s)
    expect(all).not.toContain('Secret new aim')
    expect(all).not.toContain('private reason')
    expect(all).not.toContain('Second secret aim')
    expect(s.objectives).toEqual([expect.objectContaining({ id: objective, title: 'First aim', done: 'First done' })])
    expect(s.members.map((m) => m.id)).toEqual([ada.memberId])
  })
})

describe('6. an invite post is refused when replayed', () => {
  it('mints one code for one post', async () => {
    const ada = await start()
    const body = { v: 1, type: 'invite', room: ada.roomId, member: ada.memberId, at: iso(), nonce: nonce(), name: 'B', handle: 'ben-franklin', personName: 'Ben' }
    await rooms.submitPost(ctx, ada.roomId, body, ada.s(body))
    await refused(rooms.submitPost(ctx, ada.roomId, body, ada.s(body)), 409)
  })
})

describe('7. only startTether names a handle person', () => {
  it('an invite names nobody until the join, and never renames a person', async () => {
    const ada = await start()
    await post(ctx, ada, 'invite', { name: 'X', handle: 'ben-franklin', personName: 'Mallory' })
    expect(await ctx.store.get('people/@ben-franklin')).toBeNull()
    await joinHandle(ada, 'ben-franklin', suitB, 'Ben')
    expect(await ctx.store.get('people/@ben-franklin')).toMatchObject({ name: 'Ben' })
    await joinHandle(ada, 'ben-franklin', suitB, 'Mallory')
    expect(await ctx.store.get('people/@ben-franklin')).toMatchObject({ name: 'Ben' })
  })
  it('a closed room makes no person', async () => {
    const ada = await start()
    await post(ctx, ada, 'room.close', {})
    await refused(post(ctx, ada, 'invite', { name: 'X', handle: 'ben-franklin', personName: 'Ben' }), 409)
    expect(await ctx.store.get('people/@ben-franklin')).toBeNull()
  })
})

describe('8. taking back the first version takes back the title', () => {
  it('clears the title on the draft and on every later version entry', async () => {
    const ada = await start()
    const { draft } = await post(ctx, ada, 'draft', { title: 'A secret title', text: 'v1' }) as { draft: string }
    await post(ctx, ada, 'draft.version', { draft, text: 'v2' })
    const first = (await rooms.read(ctx, asAgent(ada), ada.roomId, 0)).events.find((e) => e.type === 'draft.version' && e.version === 1)!
    await post(ctx, ada, 'redact', { target: first.seq })
    expect(JSON.stringify(await rooms.readLog(ctx, asAgent(ada), ada.roomId))).not.toContain('A secret title')
  })
})

describe('9. long polls per member are capped', () => {
  it('a third wait at once from one member answers at once', async () => {
    const ada = await start()
    let release: () => void = () => {}
    const gate = new Promise<void>((r) => { release = r })
    let slept = 0
    ctx.sleep = async () => { slept++; await gate }
    const seq = (await ctx.store.get(`rooms/${ada.roomId}`))!.seq as number
    const a = rooms.waitForNews(ctx, ada.roomId, seq, 25, undefined, ada.memberId)
    const b = rooms.waitForNews(ctx, ada.roomId, seq, 25, undefined, ada.memberId)
    await new Promise((r) => setTimeout(r, 0))
    const before = slept
    await rooms.waitForNews(ctx, ada.roomId, seq, 25, undefined, ada.memberId)
    expect(slept).toBe(before)
    ctx.sleep = async () => {}
    release()
    await Promise.all([a, b])
  })
})

describe('10. smaller points', () => {
  it('a tether start names this host, so it cannot be replayed on another', async () => {
    await refused(start('ada-lovelace', suitA, { aud: 'https://other.example' }), 401)
    await refused(start('ada-lovelace', suitA, { aud: undefined }), 401)
  })
  it('a v0.3 reader marks a taken-back post and a member\'s close as unsigned or signed, never FAILED', async () => {
    // The v0.3 reader's check, as supersuit-dev's room-lib verifyEvent wrote it.
    const v03 = (e: RoomEvent, members: { id: string; publicKey?: string }[]) => {
      if (e.by === 'host') return 'host'
      if (!e.post || !e.sig) return 'unsigned'
      const m = members.find((x) => x.id === e.by)
      if (!m?.publicKey || e.post.member !== e.by) return 'FAILED'
      try {
        const key = createPublicKey({ key: { kty: 'OKP', crv: 'Ed25519', x: m.publicKey }, format: 'jwk' })
        return verify(null, Buffer.from(canonical(e.post)), key, Buffer.from(e.sig, 'base64url')) ? 'signed' : 'FAILED'
      } catch { return 'FAILED' }
    }
    const ada = await start()
    const { seq } = await post(ctx, ada, 'message', { text: 'a slip' }) as { seq: number }
    await post(ctx, ada, 'redact', { target: seq })
    await post(ctx, ada, 'room.close', {})
    const v = await rooms.read(ctx, asAgent(ada), ada.roomId, 0)
    expect(v.events.map((e) => v03(e, v.members))).not.toContain('FAILED')
  })
})
