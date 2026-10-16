import { getCtx } from '@/lib/server/ctx'
import { fetcherFor } from '@/lib/server/auth'
import { handle } from '@/lib/server/http'
import * as rooms from '@/lib/rooms/service'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type P = { params: Promise<{ id: string; sha256: string }> }

const EXT: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif' }

// Protocol v0.2: the bytes of one attachment, exactly as uploaded, to a member that signed the fetch
// or to a signed-in person whose Pluma is in the room. Never a public URL, never a shared cache.
export async function GET(req: Request, { params }: P) {
  return handle(async () => {
    const { id, sha256 } = await params
    const a = await rooms.readAttachment(await getCtx(), await fetcherFor(req, id, sha256), id, sha256)
    return new Response(new Uint8Array(a.bytes), {
      headers: {
        'content-type': a.type,
        'content-length': String(a.size),
        'content-disposition': `inline; filename="${a.sha256.slice(0, 12)}.${EXT[a.type] ?? 'bin'}"`,
        'cache-control': 'private, max-age=3600',
        etag: `"${a.sha256}"`,
        'content-security-policy': "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox",
      },
    })
  })
}
