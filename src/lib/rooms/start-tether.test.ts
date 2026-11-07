// src/lib/rooms/start-tether.test.ts
import { describe, it, expect, beforeEach } from 'vitest'
import { newDeviceKey, signEntry } from '@supersuit/suit-identity'
import { MemoryStore } from './memory-store'
import { Refusal } from './refusal'
import * as rooms from './service'
import { nonce, pluma } from './test-members'

let ctx: rooms.Ctx
const suit = newDeviceKey()
const refused = async (p: Promise<unknown>, status: number) => {
  const e = await p.then(() => null, (x) => x)
  expect(e).toBeInstanceOf(Refusal)
  expect((e as Refusal).status).toBe(status)
}
const start = (over: Record<string, unknown> = {}, priv = suit.priv) => {
  const k = pluma()
  const entry = signEntry({ op: 'tether-start', aud: 'https://rooms.supersuit.co', handle: 'ada-lovelace', personName: 'Ada', memberName: "Ada's Pluma", name: 'The launch', publicKey: k.pub, at: new Date(ctx.now()).toISOString(), nonce: nonce(), ...over }, priv)
  return { k, p: rooms.startTether(ctx, entry) }
}
beforeEach(() => {
  ctx = { store: new MemoryStore(), now: () => Date.parse('2026-11-07T12:00:00.000Z'), directory: async (h) => (h === 'ada-lovelace' || h === 'ben-franklin' ? { suit: 's1', keys: [suit.pub] } : null) }
})

describe('startTether', () => {
  it('opens a room with the first member, under the handle as the person', async () => {
    const r = await start().p
    const room = await ctx.store.get(`rooms/${r.roomId}`)
    // Contract changed by review finding 2 (2026-11-07): a handle person's key is "@" and the handle.
    expect(room).toMatchObject({ state: 'open', tether: true, createdBy: '@ada-lovelace', seq: 2 })
    expect(await ctx.store.get('people/@ada-lovelace')).toMatchObject({ name: 'Ada', emailDigests: [] })
    const v = await rooms.read(ctx, { kind: 'agent', roomId: r.roomId, memberId: r.memberId }, r.roomId, 0)
    expect(v.members[0]).toMatchObject({ id: r.memberId, answersTo: '@ada-lovelace', answersToName: 'Ada' })
  })
  it('refuses a key the directory does not list, an unknown handle, a stale clock and a replay', async () => {
    await refused(start({}, newDeviceKey().priv).p, 401)
    await refused(start({ handle: 'nobody-here' }).p, 401)
    await refused(start({ at: '2020-01-01T00:00:00.000Z' }).p, 401)
    const n = nonce()
    await start({ nonce: n }).p
    await refused(start({ nonce: n }).p, 409)
  })
})

describe('an invite to a handle', () => {
  it('checks the directory, and lasts as long as it asked, up to 14 days; the join makes the person', async () => {
    const { k, p } = start()
    const r = await p
    const post = (fields: Record<string, unknown>) => {
      const b = { v: 1, type: 'invite', room: r.roomId, member: r.memberId, at: new Date(ctx.now()).toISOString(), nonce: nonce(), ...fields }
      return rooms.submitPost(ctx, r.roomId, b, k.s(b))
    }
    const { code } = await post({ name: "Ben's Pluma", handle: 'ben-franklin', personName: 'Ben', ttlHours: 9999 }) as { code: string }
    // Contract changed by review finding 7: the invite names nobody; a join signed by the suit makes the person.
    expect(await ctx.store.get('people/@ben-franklin')).toBeNull()
    const inv = await ctx.store.get(`invites/${rooms.sha256(code)}`)
    expect((inv!.expiresAt as number) - ctx.now()).toBe(336 * 3_600_000)
    await refused(post({ name: 'X', handle: 'nobody-here', personName: 'X' }), 400)
  })
  it('an invite with no ttlHours still lasts 24 hours, as in v0.3', async () => {
    const { k, p } = start()
    const r = await p
    const b = { v: 1, type: 'invite', room: r.roomId, member: r.memberId, at: new Date(ctx.now()).toISOString(), nonce: nonce(), name: "Ben's Pluma", handle: 'ben-franklin', personName: 'Ben' }
    const { code } = await rooms.submitPost(ctx, r.roomId, b, k.s(b)) as { code: string }
    expect(((await ctx.store.get(`invites/${rooms.sha256(code)}`))!.expiresAt as number) - ctx.now()).toBe(24 * 3_600_000)
  })
})

describe('a reader link', () => {
  it('gives the member\'s own person a session once, and only once', async () => {
    const { k, p } = start()
    const r = await p
    const b = { v: 1, type: 'reader.link', room: r.roomId, member: r.memberId, at: new Date(ctx.now()).toISOString(), nonce: nonce() }
    const { path } = await rooms.submitPost(ctx, r.roomId, b, k.s(b)) as { path: string }
    const token = path.replace('/open/', '')
    const opened = await rooms.redeemReaderLink(ctx, token)
    expect(opened?.roomId).toBe(r.roomId)
    expect(await rooms.personForSession(ctx, opened!.session)).toBe('@ada-lovelace')
    expect(await rooms.redeemReaderLink(ctx, token)).toBeNull()
  })
  it('refuses the same reader.link post twice, as every other post', async () => {
    const { k, p } = start()
    const r = await p
    const b = { v: 1, type: 'reader.link', room: r.roomId, member: r.memberId, at: new Date(ctx.now()).toISOString(), nonce: nonce() }
    await rooms.submitPost(ctx, r.roomId, b, k.s(b))
    await refused(rooms.submitPost(ctx, r.roomId, b, k.s(b)), 409)
  })
  it('an expired reader link opens nothing', async () => {
    const { k, p } = start()
    const r = await p
    const b = { v: 1, type: 'reader.link', room: r.roomId, member: r.memberId, at: new Date(ctx.now()).toISOString(), nonce: nonce() }
    const { path } = await rooms.submitPost(ctx, r.roomId, b, k.s(b)) as { path: string }
    const t0 = ctx.now()
    ctx.now = () => t0 + 8 * 86_400_000
    expect(await rooms.redeemReaderLink(ctx, path.replace('/open/', ''))).toBeNull()
  })
})

describe('allEvents', () => {
  it('reads past one page, and stops at upTo', async () => {
    const roomId = (await start().p).roomId
    await ctx.store.transaction(async (tx) => { for (let s = 3; s <= 620; s++) tx.set(`rooms/${roomId}/events/${String(s).padStart(12, '0')}`, { seq: s, type: 'step', by: 'x', at: 1 }) })
    expect((await rooms.allEvents(ctx, roomId)).length).toBe(620)
    expect((await rooms.allEvents(ctx, roomId, 510)).length).toBe(510)
  })
})
