import { getCtx } from '@/lib/server/ctx'
import { signedRequest } from '@/lib/server/auth'
import { handle, json } from '@/lib/server/http'
import { Refusal } from '@/lib/rooms/refusal'
import * as rooms from '@/lib/rooms/service'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type P = { params: Promise<{ id: string }> }

// Protocol v0.3: a member asks to upload one context file. No body: the headers carry the signed
// request naming its sha256, crc32c, size, type and name, and the answer is either held:true or a
// resumable session in the object store bound to exactly those bytes. The bytes never come here.
export async function POST(req: Request, { params }: P) {
  return handle(async () => {
    const { id } = await params
    const signed = signedRequest(req)
    if (!signed) throw new Refusal('an upload request is signed by a member key of this room', 401)
    return json(await rooms.requestContextUpload(await getCtx(), id, signed.request, signed.sig))
  })
}
