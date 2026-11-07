// src/lib/rooms/tether-posts.test.ts
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
beforeEach(async () => {
  ctx = { store: new MemoryStore(), now: () => Date.parse('2026-11-07T12:00:00.000Z') }
  await rooms.addPerson(ctx, { key: 'ada', name: 'Ada', emails: [] })
  await rooms.addPerson(ctx, { key: 'ben', name: 'Ben', emails: [] })
  roomId = await rooms.createRoom(ctx, { person: 'ada', name: 'The launch' })
  ada = await join(ctx, roomId, "Ada's Pluma", 'ada')
  ben = await join(ctx, roomId, "Ben's Pluma", 'ben')
})
const last = async () => (await rooms.read(ctx, asAgent(ada), roomId, 0)).events.at(-1)!

describe('step', () => {
  it('records what a Pluma did, its proof, and whose move is next', async () => {
    const { seq } = await post(ctx, ada, 'step', { text: 'Built the page.', proof: [{ label: 'commit abc123', href: 'https://example.com/abc123' }], next: ben.memberId }) as { seq: number }
    expect(await last()).toMatchObject({ seq, type: 'step', by: ada.memberId, text: 'Built the page.', proof: [{ label: 'commit abc123' }], next: ben.memberId })
  })
  it('refuses a next that is not a member, and an empty text', async () => {
    await refused(post(ctx, ada, 'step', { text: 'x', next: 'a-nobody' }), 400)
    await refused(post(ctx, ada, 'step', { text: ' ' }), 400)
  })
  it('carries a person\'s words with when they said them', async () => {
    await post(ctx, ada, 'step', { text: 'Ada asked why.', said: { words: 'why split it', saidAt: '2026-11-07T11:00:00.000Z' } })
    expect((await last()).said).toEqual({ words: 'why split it', saidAt: '2026-11-07T11:00:00.000Z' })
    await refused(post(ctx, ada, 'step', { text: 'x', said: { words: 'y', saidAt: '2030-01-01T00:00:00.000Z' } }), 400)
  })
  it('names the entries it reverses, and refuses one that does not exist', async () => {
    const { seq } = await post(ctx, ada, 'step', { text: 'Plan A.' }) as { seq: number }
    await post(ctx, ben, 'step', { text: 'Dropped plan A.', reverses: [seq] })
    expect((await last()).reverses).toEqual([seq])
    await refused(post(ctx, ben, 'step', { text: 'x', reverses: [9999] }), 400)
  })
})

describe('objective.amend', () => {
  it('binds forward, keeps the old wording and the reason, and only the owner\'s Pluma may do it', async () => {
    const { objective } = await post(ctx, ada, 'objective', { title: 'Old', done: 'Old done', owner: 'ada' }) as { objective: string }
    await refused(post(ctx, ben, 'objective.amend', { objective, title: 'New', reason: 'r' }), 403)
    await refused(post(ctx, ada, 'objective.amend', { objective, title: 'New' }), 400)
    await post(ctx, ada, 'objective.amend', { objective, title: 'New', reason: 'Ada changed the aim.' })
    const v = await rooms.read(ctx, asAgent(ada), roomId, 0)
    expect(v.objectives[0]).toMatchObject({ title: 'New', done: 'Old done' })
    expect(v.objectives[0].amended?.[0]).toMatchObject({ title: 'Old', done: 'Old done', reason: 'Ada changed the aim.' })
    expect(v.events.at(-1)).toMatchObject({ type: 'objective.amended', objective, from: { title: 'Old', done: 'Old done' }, title: 'New', reason: 'Ada changed the aim.' })
  })
})

describe('decision', () => {
  it('carries what was rejected and why, and names its own record', async () => {
    const { draft } = await post(ctx, ada, 'draft', { title: 'T', text: 'words' }) as { draft: string }
    await post(ctx, ada, 'decision', { draft, version: 1, fingerprint: rooms.fingerprintText('words'), verdict: 'approve', words: 'Yes.', saidAt: '2026-11-07T11:00:00.000Z', rejected: 'The long version', reason: 'It cost too much.' })
    const e = await last()
    expect(e).toMatchObject({ rejected: 'The long version', reason: 'It cost too much.' })
    expect(typeof e.decisionId).toBe('string')
  })
})
