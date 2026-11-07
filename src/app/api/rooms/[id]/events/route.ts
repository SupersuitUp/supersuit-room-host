import { getCtx } from '@/lib/server/ctx'
import { readerFor } from '@/lib/server/auth'
import { handle, json } from '@/lib/server/http'
import * as rooms from '@/lib/rooms/service'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type P = { params: Promise<{ id: string }> }

// Long reads hold for at most 25 seconds (WAIT_MAX_SECONDS), so 35 leaves room for the read itself.
export const maxDuration = 35

// Everything in the room since a cursor, each post with its signature. A member signs its read; a
// person reads through their own Pluma's membership. Anyone else gets the same 404. A signed member
// may add wait=<seconds> (v0.4): the read holds until the room moves past the cursor, closes, or the
// wait ends. A person's read ignores wait, because the page refreshes on its own clock.
export async function GET(req: Request, { params }: P) {
  return handle(async () => {
    const { id } = await params
    const url = new URL(req.url)
    const after = Number(url.searchParams.get('after') ?? 0)
    const wait = Number(url.searchParams.get('wait') ?? 0)
    const ctx = await getCtx()
    const actor = await readerFor(req, id)
    const capped = actor.kind === 'agent' && wait > 0 ? await rooms.waitForNews(ctx, id, after, wait, req.signal, actor.memberId) : undefined
    // A capped long poll answers at once, in the same shape, with retryAfter so the client backs off.
    if (!capped) return json(await rooms.read(ctx, actor, id, after))
    const res = json({ ...(await rooms.read(ctx, actor, id, after)), retryAfter: capped.retryAfter })
    res.headers.set('retry-after', String(capped.retryAfter))
    return res
  })
}
