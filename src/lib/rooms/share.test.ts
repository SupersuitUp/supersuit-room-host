// src/lib/rooms/share.test.ts
import { describe, it, expect, beforeEach } from 'vitest'
import { MemoryStore } from './memory-store'
import { Refusal } from './refusal'
import * as rooms from './service'
import { asAgent, join, post, type P } from './test-members'

let ctx: rooms.Ctx, roomId: string, ada: P, ben: P
const refused = async (p: Promise<unknown>, status: number) => {
  const e = await p.then(() => null, (x) => x)
  expect(e).toBeInstanceOf(Refusal)
  expect((e as Refusal).status).toBe(status)
}
const seq = async () => (await ctx.store.get(`rooms/${roomId}`))!.seq as number
beforeEach(async () => {
  ctx = { store: new MemoryStore(), now: () => Date.parse('2026-11-07T12:00:00.000Z') }
  await rooms.addPerson(ctx, { key: 'ada', name: 'Ada', emails: [] })
  await rooms.addPerson(ctx, { key: 'ben', name: 'Ben', emails: [] })
  roomId = await rooms.createRoom(ctx, { person: 'ada', name: 'The launch' })
  ada = await join(ctx, roomId, "Ada's Pluma", 'ada')
  ben = await join(ctx, roomId, "Ben's Pluma", 'ben')
  await post(ctx, ada, 'step', { text: 'Built it.' })
  await post(ctx, ada, 'message', { text: 'a private chat line' })
})

describe('a share', () => {
  it('needs every operator: nothing is live on the first yes, and the page exists on the second', async () => {
    const r = await post(ctx, ada, 'share.request', { upTo: await seq() }) as { share: string; status: string; token?: string }
    expect(r).toMatchObject({ status: 'waiting' })
    expect(r.token).toBeUndefined()
    const done = await post(ctx, ben, 'share.approve', { share: r.share }) as { status: string; token: string }
    expect(done.status).toBe('live')
    expect(await rooms.readShare(ctx, done.token)).not.toBeNull()
    expect((await rooms.read(ctx, asAgent(ada), roomId, 0)).shares[0].token).toBe(done.token)
  })
  it('refuses a second yes from one person and a request past the log', async () => {
    const r = await post(ctx, ada, 'share.request', { upTo: await seq() }) as { share: string }
    await refused(post(ctx, ada, 'share.approve', { share: r.share }), 409)
    await refused(post(ctx, ada, 'share.request', { upTo: 99999 }), 400)
  })
  it('leaves out the conversation, the signatures and the library, and stops at upTo', async () => {
    const upTo = await seq()
    const { share } = await post(ctx, ada, 'share.request', { upTo }) as { share: string }
    const { token } = await post(ctx, ben, 'share.approve', { share }) as { token: string }
    await post(ctx, ada, 'step', { text: 'After the share.' })
    const s = (await rooms.readShare(ctx, token))!
    const all = JSON.stringify(s)
    expect(all).toContain('Built it.')
    expect(all).not.toContain('a private chat line')
    expect(all).not.toContain('After the share.')
    expect(s.events.every((e) => e.post === undefined && e.sig === undefined)).toBe(true)
    expect(s.members.every((m) => m.publicKey === undefined && m.phrase === undefined)).toBe(true)
  })
  it('a redaction reaches a live share, because the page reads the live record', async () => {
    const { seq: target } = await post(ctx, ada, 'step', { text: 'a slip' }) as { seq: number }
    const { share } = await post(ctx, ada, 'share.request', { upTo: await seq() }) as { share: string }
    const { token } = await post(ctx, ben, 'share.approve', { share }) as { token: string }
    await post(ctx, ada, 'redact', { target })
    expect(JSON.stringify(await rooms.readShare(ctx, token))).not.toContain('a slip')
  })
  it('a revoked link gives nothing away, and either operator can revoke', async () => {
    const { share } = await post(ctx, ada, 'share.request', { upTo: await seq() }) as { share: string }
    const { token } = await post(ctx, ben, 'share.approve', { share }) as { token: string }
    await post(ctx, ben, 'share.revoke', { share })
    expect(await rooms.readShare(ctx, token)).toBeNull()
    expect((await rooms.read(ctx, asAgent(ada), roomId, 0)).shares[0]).toMatchObject({ status: 'revoked' })
    expect((await rooms.read(ctx, asAgent(ada), roomId, 0)).shares[0].token).toBeUndefined()
  })
  it('works after the room closes', async () => {
    await post(ctx, ada, 'room.close', {})
    const { share } = await post(ctx, ada, 'share.request', { upTo: await seq() }) as { share: string }
    expect((await post(ctx, ben, 'share.approve', { share }) as { status: string }).status).toBe('live')
  })
})

describe('sittings on a share', () => {
  it('a shared page carries where each tethered supersession started and ended', async () => {
    await post(ctx, ada, 'session', { state: 'joined', name: 'Planning the plot' })
    await post(ctx, ada, 'session', { state: 'left' })
    const { share } = await post(ctx, ada, 'share.request', { upTo: await seq() }) as { share: string }
    const { token } = await post(ctx, ben, 'share.approve', { share }) as { token: string }
    const s = (await rooms.readShare(ctx, token))!
    expect(s.events.filter((e) => e.type === 'session').map((e) => e.state)).toEqual(['joined', 'left'])
  })
})
