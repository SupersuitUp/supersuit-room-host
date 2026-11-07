// The second independent review of v0.4 (2026-11-07). Each test is the exploit or the defect it named,
// written first, so it failed before its fix.
import { describe, it, expect, beforeEach } from 'vitest'
import { newDeviceKey, signEntry } from '@supersuit/suit-identity'
import { MemoryStore } from './memory-store'
import { Refusal } from './refusal'
import * as rooms from './service'
import { asAgent, join, nonce, pluma, post, type P } from './test-members'
import { tetherLog } from '../tether-log/model.ts'

const AUD = 'https://rooms.supersuit.co'
const suitA = newDeviceKey(), suitB = newDeviceKey()
let ctx: rooms.Ctx
const iso = () => new Date(ctx.now()).toISOString()
const refused = async (p: Promise<unknown>, status: number) => {
  const e = await p.then(() => null, (x) => x)
  expect(e).toBeInstanceOf(Refusal)
  expect((e as Refusal).status).toBe(status)
  return e as Refusal
}
async function start(handle = 'ada-lovelace', suit = suitA, personName = 'Ada'): Promise<P> {
  const k = pluma()
  const r = await rooms.startTether(ctx, signEntry({ op: 'tether-start', aud: AUD, handle, personName, memberName: 'Pluma', name: 'T', publicKey: k.pub, at: iso(), nonce: nonce() }, suit.priv))
  return { ...k, memberId: r.memberId, roomId: r.roomId }
}
/** A handle join. The person's name rides inside the suit-signed join, never in the invite. */
async function joinHandle(by: P, handle: string, suit: typeof suitA, inviteName: string, joinName?: string): Promise<P> {
  const { code } = await post(ctx, by, 'invite', { name: 'Pl', handle, personName: inviteName }) as { code: string }
  const k = pluma()
  const bare = { v: 1, type: 'join', code, publicKey: k.pub, at: iso(), nonce: nonce(), ...(joinName ? { personName: joinName } : {}) }
  const req = { ...bare, suitSig: signEntry(bare, suit.priv).sig }
  return { ...k, memberId: (await rooms.redeemInvite(ctx, req, k.s(req))).memberId, roomId: by.roomId }
}
/** A member whose person is not proven: the operator's test stand-in. */
async function standIn(roomId: string, answersTo: string): Promise<P> {
  const { code } = await rooms.createInvite(ctx, 'operator', roomId, { name: 'Stand-in', answersTo, test: true })
  const k = pluma()
  const req = { v: 1, type: 'join', code, publicKey: k.pub, at: iso(), nonce: nonce() }
  return { ...k, memberId: (await rooms.redeemInvite(ctx, req, k.s(req))).memberId, roomId }
}
const unprove = (p: P) => ctx.store.transaction(async (tx) => { tx.update(`rooms/${p.roomId}/members/${p.memberId}`, { proven: null }) })

let roomId: string, mal: P, ben: P
beforeEach(async () => {
  ctx = { store: new MemoryStore(), now: () => Date.parse('2026-11-07T12:00:00.000Z'),
    directory: async (h) => (h === 'ada-lovelace' ? { suit: 'sA', keys: [suitA.pub] } : h === 'ben-franklin' ? { suit: 'sB', keys: [suitB.pub] } : null) }
  await rooms.addPerson(ctx, { key: 'mal', name: 'Mal', emails: [] })
  await rooms.addPerson(ctx, { key: 'ben', name: 'Ben', emails: [] })
  roomId = await rooms.createRoom(ctx, { person: 'mal', name: 'R' })
  mal = await join(ctx, roomId, "Mal's Pluma", 'mal')
  ben = await join(ctx, roomId, "Ben's Pluma", 'ben')
})

describe('1. only a proven member speaks for a person', () => {
  it('a member invites a Pluma only for its own person', async () => {
    await refused(post(ctx, mal, 'invite', { name: 'Fake', answersTo: 'ben' }), 403)
  })
  it('a proven member\'s second Pluma for its own person is proven too', async () => {
    const { code } = await post(ctx, ben, 'invite', { name: "Ben's laptop", answersTo: 'ben' }) as { code: string }
    const k = pluma()
    const req = { v: 1, type: 'join', code, publicKey: k.pub, at: iso(), nonce: nonce() }
    const laptop = { ...k, memberId: (await rooms.redeemInvite(ctx, req, k.s(req))).memberId, roomId }
    const { draft } = await post(ctx, laptop, 'draft', { title: 'T', text: 'w' }) as { draft: string }
    expect(draft).toBeTruthy()
  })
  it('an unproven member cannot decide, set or change an objective, draft, or carry a person\'s words', async () => {
    const fake = await standIn(roomId, 'ben')
    const { draft } = await post(ctx, ben, 'draft', { title: 'Wire', text: 'send' }) as { draft: string }
    const { objective } = await post(ctx, ben, 'objective', { title: 'O', done: 'D', owner: 'ben' }) as { objective: string }
    await refused(post(ctx, fake, 'decision', { draft, version: 1, fingerprint: rooms.fingerprintText('send'), verdict: 'approve', words: 'Yes', saidAt: iso() }), 403)
    await refused(post(ctx, fake, 'objective', { title: 'X', done: 'x', owner: 'ben' }), 403)
    await refused(post(ctx, fake, 'objective.amend', { objective, title: 'X', reason: 'r' }), 403)
    await refused(post(ctx, fake, 'draft', { title: 'X', text: 'x' }), 403)
    await refused(post(ctx, fake, 'draft.version', { draft, text: 'x' }), 403)
    await refused(post(ctx, fake, 'step', { text: 'relayed', said: { words: 'I approve', saidAt: iso() } }), 403)
    expect(await post(ctx, fake, 'step', { text: 'A plain step is fine.' })).toMatchObject({ seq: expect.any(Number) })
  })
  it('a decision on record from a member that is not proven approves nothing', async () => {
    const { draft } = await post(ctx, ben, 'draft', { title: 'T', text: 'w' }) as { draft: string }
    await post(ctx, ben, 'decision', { draft, version: 1, fingerprint: rooms.fingerprintText('w'), verdict: 'approve', words: 'Yes', saidAt: iso() })
    await unprove(ben)
    const log = await rooms.readLog(ctx, asAgent(mal), roomId)
    expect(rooms.isApproved(log.drafts[0], log.members)).toBe(false)
  })
  it('the backfill marks members the host operator invited, and only those', async () => {
    const own = await (async () => {
      const { code } = await post(ctx, mal, 'invite', { name: "Mal's laptop", answersTo: 'mal' }) as { code: string }
      const k = pluma()
      const req = { v: 1, type: 'join', code, publicKey: k.pub, at: iso(), nonce: nonce() }
      return { ...k, memberId: (await rooms.redeemInvite(ctx, req, k.s(req))).memberId, roomId }
    })()
    const stand = await standIn(roomId, 'ben')
    // Live rooms predate the field: strip it from everyone, as a v0.3 room has it.
    for (const p of [mal, ben, own, stand]) await unprove(p)
    expect(await rooms.markOperatorMembersProven(ctx)).toBe(2)
    const v = await rooms.read(ctx, asAgent(mal), roomId, 0)
    const proven = (p: P) => v.members.find((m) => m.id === p.memberId)!.proven === true
    expect([proven(mal), proven(ben), proven(own), proven(stand)]).toEqual([true, true, false, false])
    expect(await rooms.markOperatorMembersProven(ctx)).toBe(0)
  })
})

describe('2. a handle person\'s name comes from that person', () => {
  it('the inviter\'s name for them is ignored; the suit-signed join names them; a start renames them', async () => {
    const ada = await start()
    await joinHandle(ada, 'ben-franklin', suitB, 'Ada Lovelace (owner)', 'Ben Franklin')
    expect(await ctx.store.get('people/@ben-franklin')).toMatchObject({ name: 'Ben Franklin' })
    const benOwn = await start('ben-franklin', suitB, 'Ben F.')
    expect(await ctx.store.get('people/@ben-franklin')).toMatchObject({ name: 'Ben F.' })
    expect((await rooms.read(ctx, asAgent(benOwn), benOwn.roomId, 0)).members[0].answersToName).toBe('Ben F.')
  })
  it('a join with no name uses the handle', async () => {
    const ada = await start()
    await joinHandle(ada, 'ben-franklin', suitB, 'Anything')
    expect(await ctx.store.get('people/@ben-franklin')).toMatchObject({ name: 'ben-franklin' })
  })
})

describe('3. taking back the approved version takes back the approval', () => {
  it('isApproved and the model stop counting it', async () => {
    const { draft } = await post(ctx, ben, 'draft', { title: 'T', text: 'w' }) as { draft: string }
    await post(ctx, ben, 'decision', { draft, version: 1, fingerprint: rooms.fingerprintText('w'), verdict: 'approve', words: 'Yes, ship it', saidAt: iso() })
    const ev = (await rooms.read(ctx, asAgent(ben), roomId, 0)).events.find((e) => e.type === 'draft.version')!
    await post(ctx, ben, 'redact', { target: ev.seq })
    const log = await rooms.readLog(ctx, asAgent(ben), roomId)
    expect(rooms.isApproved(log.drafts[0], log.members)).toBe(false)
    expect(tetherLog(log).settled.map((s) => s.text)).not.toContain('Yes, ship it')
  })
})

describe('4. waits and starts are capped per suit, and a capped answer says when to retry', () => {
  it('one suit holds at most 4 waits across its rooms; the next is capped with retryAfter', async () => {
    ctx.sleep = () => new Promise(() => {})
    const rs = [await start(), await start(), await start()]
    for (const r of rs.slice(0, 2)) for (let j = 0; j < 2; j++) void rooms.waitForNews(ctx, r.roomId, 99, 25, undefined, r.memberId)
    await new Promise((r) => setTimeout(r, 5))
    expect(await rooms.waitForNews(ctx, rs[2].roomId, 99, 25, undefined, rs[2].memberId)).toMatchObject({ capped: true, retryAfter: expect.any(Number) })
  })
  it('one suit opens at most 20 tethers an hour', async () => {
    for (let i = 0; i < 20; i++) await start()
    const e = await refused(start(), 429)
    expect(e.retryAfter).toBeGreaterThan(0)
    const later = ctx.now() + 3_601_000
    ctx.now = () => later
    expect((await start()).roomId).toBeTruthy()
  })
})

describe('7. a share shows only words whose person said yes', () => {
  it('leaves out entries by a test stand-in, and by a retired member whose person was not asked', async () => {
    await rooms.addPerson(ctx, { key: 'cara', name: 'Cara', emails: [] })
    const cara = await join(ctx, roomId, "Cara's Pluma", 'cara')
    const stand = await standIn(roomId, 'ben')
    await post(ctx, stand, 'step', { text: 'Stand-in line.' })
    await post(ctx, cara, 'step', { text: 'Cara line.' })
    await post(ctx, ben, 'step', { text: 'Ben line.', said: { words: 'Ben words', saidAt: iso() } })
    await rooms.retireMember(ctx, roomId, cara.memberId)
    const upTo = (await ctx.store.get(`rooms/${roomId}`))!.seq as number
    const { share } = await post(ctx, mal, 'share.request', { upTo }) as { share: string }
    const { token } = await post(ctx, ben, 'share.approve', { share }) as { token: string }
    const all = JSON.stringify(await rooms.readShare(ctx, token))
    expect(all).toContain('Ben words')
    expect(all).not.toContain('Stand-in line.')
    expect(all).not.toContain('Cara line.')
  })
})
