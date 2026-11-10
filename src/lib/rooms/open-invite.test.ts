// An open invite (2026-11-10): a tether invite that names no handle, so an operator can paste it to
// anyone who runs Supersuit. The joiner proves who they are with their OWN suit key and handle at the
// join, so the member is proven and bound to the joiner's own handle person, never to the inviter's.
import { describe, it, expect, beforeEach } from 'vitest'
import { newDeviceKey, signEntry } from '@supersuit/suit-identity'
import { MemoryStore } from './memory-store'
import { Refusal } from './refusal'
import * as rooms from './service'
import { asAgent, nonce, pluma, post, type P } from './test-members'

const AUD = 'https://rooms.supersuit.co'
const suitA = newDeviceKey(), suitB = newDeviceKey()
let ctx: rooms.Ctx
const refused = async (p: Promise<unknown>, status: number) => {
  const e = await p.then(() => null, (x) => x)
  expect(e).toBeInstanceOf(Refusal)
  expect((e as Refusal).status).toBe(status)
}
const iso = () => new Date(ctx.now()).toISOString()

async function start(): Promise<P> {
  const k = pluma()
  const r = await rooms.startTether(ctx, signEntry({ op: 'tether-start', aud: AUD, handle: 'ada-lovelace', personName: 'Ada', memberName: "Ada's Pluma", name: 'The launch', publicKey: k.pub, at: iso(), nonce: nonce() }, suitA.priv))
  return { ...k, memberId: r.memberId, roomId: r.roomId }
}
const openInvite = async (by: P) => (await post(ctx, by, 'invite', { name: 'A Pluma', open: true, ttlHours: 24 }) as { code: string }).code
/** Redeem an open invite, naming a handle and signing with a suit key (either may be left out). */
async function joinOpen(code: string, handle: string | null, suit: typeof suitA | null, roomId: string): Promise<P> {
  const k = pluma()
  const bare: Record<string, unknown> = { v: 1, type: 'join', code, publicKey: k.pub, at: iso(), nonce: nonce(), personName: 'Ben Franklin' }
  if (handle) bare.handle = handle
  const req = suit ? { ...bare, suitSig: signEntry(bare, suit.priv).sig } : bare
  const r = await rooms.redeemInvite(ctx, req, k.s(req))
  return { ...k, memberId: r.memberId, roomId }
}

beforeEach(() => {
  ctx = {
    store: new MemoryStore(), now: () => Date.parse('2026-11-10T12:00:00.000Z'),
    directory: async (h) => (h === 'ada-lovelace' ? { suit: 'sA', keys: [suitA.pub] } : h === 'ben-franklin' ? { suit: 'sB', keys: [suitB.pub] } : null),
  }
})

describe('an open invite', () => {
  it('lets anyone with a suit join, bound to their own handle and proven', async () => {
    const ada = await start()
    const ben = await joinOpen(await openInvite(ada), 'ben-franklin', suitB, ada.roomId)
    const v = await rooms.read(ctx, asAgent(ada), ada.roomId, 0)
    const m = v.members.find((x) => x.id === ben.memberId)!
    expect(m.answersTo).toBe('@ben-franklin')
    expect(m.proven).toBe(true)
    expect(await post(ctx, ben, 'reader.link', {})).toHaveProperty('path')
  })
  it('refuses a join with no suit signature or no handle', async () => {
    const ada = await start()
    await refused(joinOpen(await openInvite(ada), 'ben-franklin', null, ada.roomId), 401)
    await refused(joinOpen(await openInvite(ada), null, suitB, ada.roomId), 401)
  })
  it('refuses a join whose suit does not hold the handle it names', async () => {
    const ada = await start()
    await refused(joinOpen(await openInvite(ada), 'ben-franklin', suitA, ada.roomId), 401)
    await refused(joinOpen(await openInvite(ada), 'nobody-here', suitB, ada.roomId), 401)
  })
  it('works once', async () => {
    const ada = await start()
    const code = await openInvite(ada)
    await joinOpen(code, 'ben-franklin', suitB, ada.roomId)
    await refused(joinOpen(code, 'ben-franklin', suitB, ada.roomId), 404)
  })
  it('names nobody: it cannot also carry a handle or a person', async () => {
    const ada = await start()
    await refused(post(ctx, ada, 'invite', { name: 'A Pluma', open: true, handle: 'ben-franklin' }), 400)
    await refused(post(ctx, ada, 'invite', { name: 'A Pluma', open: true, answersTo: 'ben' }), 400)
  })
})
