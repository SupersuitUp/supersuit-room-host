import { getCtx } from '@/lib/server/ctx'
import { contextFetcherFor } from '@/lib/server/auth'
import { handle, json } from '@/lib/server/http'
import * as rooms from '@/lib/rooms/service'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type P = { params: Promise<{ id: string; sha256: string }> }

// Protocol v0.3: one context item and a 15-minute signed address for its bytes, to a member that
// signed the fetch or a signed-in person whose Pluma is in the room. ?inline=1 asks for an address the
// browser shows rather than saves (the room page's previews). Retired, or deleted after close: 410.
export async function GET(req: Request, { params }: P) {
  return handle(async () => {
    const { id, sha256 } = await params
    const inline = new URL(req.url).searchParams.get('inline') === '1'
    return json(await rooms.fetchContext(await getCtx(), await contextFetcherFor(req, id, sha256), id, sha256, { inline }))
  })
}
