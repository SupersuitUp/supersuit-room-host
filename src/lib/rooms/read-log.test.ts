// src/lib/rooms/read-log.test.ts
import { describe, it, expect, beforeEach } from 'vitest'
import { MemoryStore } from './memory-store'
import { Refusal } from './refusal'
import * as rooms from './service'
import { join, post, type P } from './test-members'
import { tetherLog } from '../tether-log/model.ts'

let ctx: rooms.Ctx, roomId: string, ada: P
beforeEach(async () => {
  ctx = { store: new MemoryStore(), now: () => Date.parse('2026-11-07T12:00:00.000Z') }
  await rooms.addPerson(ctx, { key: 'ada', name: 'Ada', emails: [] })
  await rooms.addPerson(ctx, { key: 'eve', name: 'Eve', emails: [] })
  roomId = await rooms.createRoom(ctx, { person: 'ada', name: 'R' })
  ada = await join(ctx, roomId, "Ada's Pluma", 'ada')
  await post(ctx, ada, 'objective', { title: 'Ship it.', done: 'It ships.', owner: 'ada' })
  await post(ctx, ada, 'step', { text: 'Built it.' })
})

describe('readLog', () => {
  it('gives a reader every event and the host\'s checks, ready for the model', async () => {
    const log = await rooms.readLog(ctx, { kind: 'person', person: 'ada' }, roomId)
    expect(log.checks[log.events.at(-1)!.seq]).toBe('signed')
    expect(tetherLog(log).intent).toBe('Ship it.')
  })
  it('tells a stranger nothing', async () => {
    const e = await rooms.readLog(ctx, { kind: 'person', person: 'eve' }, roomId).then(() => null, (x) => x)
    expect(e).toBeInstanceOf(Refusal)
    expect((e as Refusal).status).toBe(404)
  })
})
