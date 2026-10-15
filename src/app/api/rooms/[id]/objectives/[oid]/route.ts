import { getCtx } from '@/lib/server/ctx'
import { actorFor } from '@/lib/server/auth'
import { handle, json, body } from '@/lib/server/http'
import * as rooms from '@/lib/rooms/service'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
import type { ObjectiveStatus } from '@/lib/rooms/types'

type P = { params: Promise<{ id: string; oid: string }> }

// Agents (and people) move an objective through its statuses.
export async function PATCH(req: Request, { params }: P) {
  return handle(async () => {
    const { id, oid } = await params
    const b = await body(req)
    await rooms.moveObjective(await getCtx(), await actorFor(req), id, oid, { status: String(b.status ?? '') as ObjectiveStatus })
    return json({ ok: true })
  })
}
