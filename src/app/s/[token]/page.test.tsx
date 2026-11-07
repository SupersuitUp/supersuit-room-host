import { describe, it, expect, beforeEach } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryStore } from '@/lib/rooms/memory-store'
import * as rooms from '@/lib/rooms/service'
import { join, post, type P as Member } from '@/lib/rooms/test-members'
import { setCtxForTests } from '@/lib/server/ctx'
import Shared, { generateMetadata } from './page'

// The shared page, as a stranger opens it: live only on every operator's yes, and the same words for
// a token that never existed and one that was revoked.
let ctx: rooms.Ctx, roomId: string, ada: Member
const params = (token: string) => ({ params: Promise.resolve({ token }) })
const page = async (token: string) => renderToStaticMarkup(await Shared(params(token)))
beforeEach(async () => {
  ctx = { store: new MemoryStore(), now: () => Date.parse('2026-11-07T12:00:00.000Z') }
  setCtxForTests(ctx)
  await rooms.addPerson(ctx, { key: 'ada', name: 'Ada', emails: [] })
  roomId = await rooms.createRoom(ctx, { person: 'ada', name: 'The launch' })
  ada = await join(ctx, roomId, "Ada's Pluma", 'ada')
  await post(ctx, ada, 'step', { text: 'Built it.' })
})

describe('/s/:token', () => {
  it('says the page is not shared for an unknown token, and names nothing', async () => {
    const html = await page('not-a-token')
    expect(html).toContain('This page is not shared.')
    expect(html).not.toContain('The launch')
    expect((await generateMetadata(params('not-a-token'))).title).toBe('Not shared')
  })
  it('draws a live share under its title, and nothing once it is revoked', async () => {
    const seq = (await ctx.store.get(`rooms/${roomId}`))!.seq as number
    const { share, token } = await post(ctx, ada, 'share.request', { upTo: seq }) as { share: string; token: string }
    expect(await page(token)).toContain('The launch')
    expect((await generateMetadata(params(token))).title).toBe('The launch')
    await post(ctx, ada, 'share.revoke', { share })
    expect(await page(token)).toContain('This page is not shared.')
  })
})
