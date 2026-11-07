// src/lib/rooms/checks.test.ts
import { describe, it, expect, beforeEach } from 'vitest'
import { MemoryStore } from './memory-store'
import * as rooms from './service'
import { checkEvents } from './checks'
import { asAgent, join, post, type P } from './test-members'

let ctx: rooms.Ctx, roomId: string, ada: P
beforeEach(async () => {
  ctx = { store: new MemoryStore(), now: () => Date.parse('2026-11-07T12:00:00.000Z') }
  await rooms.addPerson(ctx, { key: 'ada', name: 'Ada', emails: [] })
  roomId = await rooms.createRoom(ctx, { person: 'ada', name: 'R' })
  ada = await join(ctx, roomId, "Ada's Pluma", 'ada')
})

describe('checkEvents', () => {
  it('names a good post, a host event, a changed post and a redaction', async () => {
    const { seq: good } = await post(ctx, ada, 'step', { text: 'x' }) as { seq: number }
    const { seq: gone } = await post(ctx, ada, 'step', { text: 'y' }) as { seq: number }
    await post(ctx, ada, 'redact', { target: gone })
    const v = await rooms.read(ctx, asAgent(ada), roomId, 0)
    const c = checkEvents(v.events, v.members)
    expect(c[1]).toBe('host')
    expect(c[good]).toBe('signed')
    expect(c[gone]).toBe('redacted')
    const changed = v.events.map((e) => (e.seq === good ? { ...e, post: { ...e.post, text: 'forged' } } : e))
    expect(checkEvents(changed, v.members)[good]).toBe('failed')
  })
})
