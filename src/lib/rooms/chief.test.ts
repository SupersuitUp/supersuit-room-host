// src/lib/rooms/chief.test.ts
// The chief of a room (supersuit-dev#2756): the Pluma that stewards a room of three or more. One per room,
// shown on every read, handed on only by the chief itself, and taken over by the earliest member left when
// the chief's key is retired.
import { describe, it, expect, beforeEach } from 'vitest'
import { MemoryStore } from './memory-store'
import { Refusal } from './refusal'
import * as rooms from './service'
import { asAgent, join, post, type P } from './test-members'

let ctx: rooms.Ctx, roomId: string, ada: P, ben: P, cara: P
const refused = async (p: Promise<unknown>, status: number) => {
  const e = await p.then(() => null, (x) => x)
  expect(e).toBeInstanceOf(Refusal)
  expect((e as Refusal).status).toBe(status)
}
const view = (p: P) => rooms.read(ctx, asAgent(p), roomId, 0)

beforeEach(async () => {
  ctx = { store: new MemoryStore(), now: () => Date.parse('2026-11-17T12:00:00.000Z') }
  for (const k of ['ada', 'ben', 'cara']) await rooms.addPerson(ctx, { key: k, name: k[0].toUpperCase() + k.slice(1), emails: [] })
  roomId = await rooms.createRoom(ctx, { person: 'ada', name: 'Three of us' })
  ada = await join(ctx, roomId, "Ada's Pluma", 'ada')
  ben = await join(ctx, roomId, "Ben's Pluma", 'ben')
  cara = await join(ctx, roomId, "Cara's Pluma", 'cara')
})

describe('the chief', () => {
  it('is the first member to join until someone hands it on, and every reader sees it', async () => {
    expect((await view(ben)).room.chief).toBe(ada.memberId)
    expect((await rooms.read(ctx, { kind: 'person', person: 'cara' }, roomId, 0)).room.chief).toBe(ada.memberId)
  })

  it('is handed on only by the chief, to an active member, and the log records it', async () => {
    await refused(post(ctx, ben, 'chief', { to: cara.memberId }), 403)
    await refused(post(ctx, ada, 'chief', { to: 'a-nobody' }), 400)
    await refused(post(ctx, ada, 'chief', { to: ada.memberId }), 400)
    const { seq } = await post(ctx, ada, 'chief', { to: cara.memberId }) as { seq: number }
    const v = await view(ben)
    expect(v.room.chief).toBe(cara.memberId)
    expect(v.events.at(-1)).toMatchObject({ seq, type: 'chief.changed', by: ada.memberId, from: ada.memberId, to: cara.memberId })
    await refused(post(ctx, ada, 'chief', { to: ben.memberId }), 403)
  })

  it('passes to the earliest member left when the chief is retired', async () => {
    await rooms.retireMember(ctx, roomId, ada.memberId)
    expect((await view(cara)).room.chief).toBe(ben.memberId)
    await post(ctx, ben, 'chief', { to: cara.memberId })
    expect((await view(cara)).room.chief).toBe(cara.memberId)
  })

  it('cannot be handed on in a closed room', async () => {
    await post(ctx, ada, 'room.close', {})
    await refused(post(ctx, ada, 'chief', { to: ben.memberId }), 409)
  })
})

describe('a step in a room of three', () => {
  it('refuses a next that names a retired member', async () => {
    await rooms.retireMember(ctx, roomId, cara.memberId)
    await refused(post(ctx, ada, 'step', { text: 'Done my part.', next: cara.memberId }), 400)
  })
})
