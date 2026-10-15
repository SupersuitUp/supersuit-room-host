import { getCtx } from '@/lib/server/ctx'
import { requireHuman } from '@/lib/server/auth'
import { handle, json, body } from '@/lib/server/http'
import * as rooms from '@/lib/rooms/service'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type P = { params: Promise<{ id: string }> }

// Humans create objectives; an agent key is refused at the door.
export async function POST(req: Request, { params }: P) {
  return handle(async () => {
    const actor = await requireHuman(req)
    const { id } = await params
    const b = await body(req)
    const oid = await rooms.createObjective(await getCtx(), actor, id, { title: String(b.title ?? ''), owner: String(b.owner ?? ''), done: String(b.done ?? '') })
    return json({ id: oid })
  })
}
