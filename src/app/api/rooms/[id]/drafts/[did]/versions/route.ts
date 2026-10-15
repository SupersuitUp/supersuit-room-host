import { getCtx } from '@/lib/server/ctx'
import { actorFor } from '@/lib/server/auth'
import { handle, json, body } from '@/lib/server/http'
import * as rooms from '@/lib/rooms/service'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type P = { params: Promise<{ id: string; did: string }> }

export async function POST(req: Request, { params }: P) {
  return handle(async () => {
    const { id, did } = await params
    const b = await body(req)
    return json({ version: await rooms.addDraftVersion(await getCtx(), await actorFor(req), id, did, { text: String(b.text ?? '') }) })
  })
}
