import { getCtx } from '@/lib/server/ctx'
import { readerFor } from '@/lib/server/auth'
import { handle, json } from '@/lib/server/http'
import * as rooms from '@/lib/rooms/service'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type P = { params: Promise<{ id: string }> }

// Everything in the room since a cursor, each post with its signature. A member signs its read; a
// person reads through their own Pluma's membership. Anyone else gets the same 404.
export async function GET(req: Request, { params }: P) {
  return handle(async () => {
    const { id } = await params
    const after = Number(new URL(req.url).searchParams.get('after') ?? 0)
    return json(await rooms.read(await getCtx(), await readerFor(req, id), id, after))
  })
}
