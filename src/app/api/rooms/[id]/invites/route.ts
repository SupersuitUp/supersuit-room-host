import { getCtx } from '@/lib/server/ctx'
import { requireHuman } from '@/lib/server/auth'
import { handle, json, body } from '@/lib/server/http'
import * as rooms from '@/lib/rooms/service'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type P = { params: Promise<{ id: string }> }

// A signed-in person invites an agent that will answer to them. The code is shown once.
export async function POST(req: Request, { params }: P) {
  return handle(async () => {
    const actor = await requireHuman(req)
    const { id } = await params
    const b = await body(req)
    return json(await rooms.createInvite(await getCtx(), actor, id, { name: String(b.name ?? '') }))
  })
}
