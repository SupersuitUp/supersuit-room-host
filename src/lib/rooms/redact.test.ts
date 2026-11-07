// src/lib/rooms/redact.test.ts
import { describe, it, expect, beforeEach } from 'vitest'
import { MemoryStore } from './memory-store'
import { Refusal } from './refusal'
import * as rooms from './service'
import { asAgent, join, nonce, post, type P } from './test-members'
import { PNG_1x1 } from './test-images'
import { createHash } from 'node:crypto'

let ctx: rooms.Ctx, roomId: string, ada: P, ben: P
const refused = async (p: Promise<unknown>, status: number) => {
  const e = await p.then(() => null, (x) => x)
  expect(e).toBeInstanceOf(Refusal)
  expect((e as Refusal).status).toBe(status)
}
const events = async () => (await rooms.read(ctx, asAgent(ada), roomId, 0)).events
beforeEach(async () => {
  ctx = { store: new MemoryStore(), now: () => Date.parse('2026-11-07T12:00:00.000Z') }
  await rooms.addPerson(ctx, { key: 'ada', name: 'Ada', emails: [] })
  await rooms.addPerson(ctx, { key: 'ben', name: 'Ben', emails: [] })
  roomId = await rooms.createRoom(ctx, { person: 'ada', name: 'R' })
  ada = await join(ctx, roomId, "Ada's Pluma", 'ada')
  ben = await join(ctx, roomId, "Ben's Pluma", 'ben')
})

describe('room.close', () => {
  it('any member closes it; it refuses new work and keeps the text readable', async () => {
    await post(ctx, ada, 'step', { text: 'stays' })
    await post(ctx, ben, 'room.close', {})
    await refused(post(ctx, ada, 'step', { text: 'late' }), 409)
    await refused(post(ctx, ada, 'room.close', {}), 409)
    expect((await events()).some((e) => e.text === 'stays')).toBe(true)
  })
})

describe('redact', () => {
  it('only the author, and the text leaves the event, the post and the signature', async () => {
    const { seq } = await post(ctx, ada, 'step', { text: 'a slip', proof: [{ label: 'x' }] }) as { seq: number }
    await refused(post(ctx, ben, 'redact', { target: seq }), 403)
    await post(ctx, ada, 'redact', { target: seq })
    const e = (await events()).find((x) => x.seq === seq)!
    expect(JSON.stringify(e)).not.toContain('a slip')
    expect(e.post).toBeUndefined()
    expect(e.sig).toBeUndefined()
    expect(e.redacted).toMatchObject({ by: ada.memberId })
    expect((await events()).at(-1)).toMatchObject({ type: 'redact', by: ada.memberId, target: seq })
  })
  it('refuses twice, and refuses bookkeeping events', async () => {
    const { seq } = await post(ctx, ada, 'message', { text: 'x' }) as { seq: number }
    await post(ctx, ada, 'redact', { target: seq })
    await refused(post(ctx, ada, 'redact', { target: seq }), 409)
    await refused(post(ctx, ada, 'redact', { target: 1 }), 403)
    await refused(post(ctx, ada, 'redact', { target: 9999 }), 404)
    const { objective } = await post(ctx, ada, 'objective', { title: 'T', done: 'D', owner: 'ada' }) as { objective: string }
    const created = (await events()).find((e) => e.type === 'objective.created' && e.objective === objective)!
    await refused(post(ctx, ada, 'redact', { target: created.seq }), 400)
  })
  it('works after the room closes', async () => {
    const { seq } = await post(ctx, ada, 'message', { text: 'a slip' }) as { seq: number }
    await post(ctx, ada, 'room.close', {})
    await post(ctx, ada, 'redact', { target: seq })
    expect(JSON.stringify(await events())).not.toContain('a slip')
  })
  it('clears a draft version and a decision, and the bytes of an image nothing else names', async () => {
    const png = PNG_1x1
    const sha = createHash('sha256').update(png).digest('hex')
    const req = { v: 1, type: 'attachment.upload', room: roomId, member: ada.memberId, sha256: sha, size: png.length, contentType: 'image/png', at: new Date(ctx.now()).toISOString(), nonce: nonce() }
    await rooms.uploadAttachment(ctx, roomId, req, ada.s(req), png)
    const { seq } = await post(ctx, ada, 'message', { text: 'pic', attachments: [{ sha256: sha, type: 'image/png', width: 1, height: 1 }] }) as { seq: number }
    await post(ctx, ada, 'redact', { target: seq })
    await refused(rooms.readAttachment(ctx, asAgent(ada), roomId, sha), 404)

    const { draft } = await post(ctx, ada, 'draft', { title: 'T', text: 'draft words' }) as { draft: string }
    await post(ctx, ada, 'decision', { draft, version: 1, fingerprint: rooms.fingerprintText('draft words'), verdict: 'approve', words: 'Ada said yes', saidAt: '2026-11-07T11:00:00.000Z' })
    const all = await events()
    await post(ctx, ada, 'redact', { target: all.find((e) => e.type === 'draft.version')!.seq })
    await post(ctx, ada, 'redact', { target: all.find((e) => e.type === 'decision')!.seq })
    const view = await rooms.read(ctx, asAgent(ada), roomId, 0)
    expect(JSON.stringify(view)).not.toContain('draft words')
    expect(JSON.stringify(view)).not.toContain('Ada said yes')
  })
})
