import { getCtx } from '@/lib/server/ctx'
import { signedRequest } from '@/lib/server/auth'
import { handle, json } from '@/lib/server/http'
import { Refusal } from '@/lib/rooms/refusal'
import * as rooms from '@/lib/rooms/service'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type P = { params: Promise<{ id: string }> }

// Protocol v0.2: a member uploads one image. The body is the raw bytes; the headers carry the signed
// request naming their sha256, size and type. An oversize upload is refused from its declared length
// before a byte of it is read.
export async function POST(req: Request, { params }: P) {
  return handle(async () => {
    const { id } = await params
    const signed = signedRequest(req)
    if (!signed) throw new Refusal('an upload is signed by a member key of this room', 401)
    const declared = Number(req.headers.get('content-length') ?? NaN)
    if (Number.isFinite(declared) && declared > rooms.MAX_ATTACHMENT_BYTES) throw new Refusal(`an attachment is at most ${rooms.MAX_ATTACHMENT_BYTES} bytes on this host`, 413)
    const bytes = new Uint8Array(await req.arrayBuffer())
    return json(await rooms.uploadAttachment(await getCtx(), id, signed.request, signed.sig, bytes))
  })
}
