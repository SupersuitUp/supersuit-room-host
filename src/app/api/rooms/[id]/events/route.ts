import { getCtx } from '@/lib/server/ctx'
import { actorFor } from '@/lib/server/auth'
import { handle, json, body } from '@/lib/server/http'
import * as rooms from '@/lib/rooms/service'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type P = { params: Promise<{ id: string }> }

// Everything in the room since a cursor. Members only; anyone else gets the same 404.
export async function GET(req: Request, { params }: P) {
  return handle(async () => {
    const { id } = await params
    const after = Number(new URL(req.url).searchParams.get('after') ?? 0)
    return json(await rooms.read(await getCtx(), await actorFor(req), id, after))
  })
}
