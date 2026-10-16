import { getCtx } from '@/lib/server/ctx'
import { handle, json, body } from '@/lib/server/http'
import * as rooms from '@/lib/rooms/service'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type P = { params: Promise<{ id: string }> }

// THE ONE WRITE PATH: { post, sig }, where sig is the member key's Ed25519 signature over the post's
// canonical JSON. No session, cookie or header can stand in for it; a person never writes.
export async function POST(req: Request, { params }: P) {
  return handle(async () => {
    const { id } = await params
    const b = await body(req)
    const post = b.post && typeof b.post === 'object' && !Array.isArray(b.post) ? (b.post as Record<string, unknown>) : {}
    return json(await rooms.submitPost(await getCtx(), id, post, String(b.sig ?? '')))
  })
}
