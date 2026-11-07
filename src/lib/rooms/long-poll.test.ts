// src/lib/rooms/long-poll.test.ts
import { describe, it, expect, beforeEach } from 'vitest'
import { MemoryStore } from './memory-store'
import * as rooms from './service'
import { join, post, type P } from './test-members'

let ctx: rooms.Ctx, roomId: string, ada: P, slept: number
beforeEach(async () => {
  slept = 0
  ctx = { store: new MemoryStore(), now: () => Date.parse('2026-11-07T12:00:00.000Z'), sleep: async (ms) => { slept += ms } }
  await rooms.addPerson(ctx, { key: 'ada', name: 'Ada', emails: [] })
  roomId = await rooms.createRoom(ctx, { person: 'ada', name: 'R' })
  ada = await join(ctx, roomId, "Ada's Pluma", 'ada')
})
const seqNow = async () => (await ctx.store.get(`rooms/${roomId}`))!.seq as number

describe('waitForNews', () => {
  it('answers at once when the room already moved past the cursor', async () => {
    await post(ctx, ada, 'step', { text: 'x' })
    await rooms.waitForNews(ctx, roomId, 1, 25)
    expect(slept).toBe(0)
  })
  it('answers as soon as a new event lands', async () => {
    const seq = await seqNow()
    let calls = 0
    ctx.sleep = async () => { calls++; if (calls === 3) await post(ctx, ada, 'step', { text: 'x' }) }
    await rooms.waitForNews(ctx, roomId, seq, 25)
    expect(calls).toBe(3)
  })
  it('gives up after the wait, and never past 25 seconds', async () => {
    await rooms.waitForNews(ctx, roomId, await seqNow(), 600)
    expect(slept).toBe(25_500)
  })
  it('answers at once for a closed room', async () => {
    await rooms.closeRoom(ctx, roomId)
    await rooms.waitForNews(ctx, roomId, await seqNow(), 25)
    expect(slept).toBe(0)
  })
})
