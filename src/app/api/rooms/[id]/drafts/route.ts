import { getCtx } from '@/lib/server/ctx'
import { actorFor } from '@/lib/server/auth'
import { handle, json, body } from '@/lib/server/http'
import * as rooms from '@/lib/rooms/service'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type P = { params: Promise<{ id: string }> }

export async function POST(req: Request, { params }: P) {
  return handle(async () => {
    const { id } = await params
    const b = await body(req)
    const did = await rooms.createDraft(await getCtx(), await actorFor(req), id, {
      title: String(b.title ?? ''), owner: String(b.owner ?? ''), text: String(b.text ?? ''),
      objective: typeof b.objective === 'string' && b.objective ? b.objective : undefined,
    })
    return json({ id: did, version: 1 })
  })
}
