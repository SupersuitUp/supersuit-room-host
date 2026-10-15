import { getCtx } from '@/lib/server/ctx'
import { actorFor } from '@/lib/server/auth'
import { handle, json, body } from '@/lib/server/http'
import * as rooms from '@/lib/rooms/service'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type P = { params: Promise<{ id: string }> }
const opt = (v: unknown) => (typeof v === 'string' && v ? v : undefined)

export async function POST(req: Request, { params }: P) {
  return handle(async () => {
    const { id } = await params
    const b = await body(req)
    return json(await rooms.postMessage(await getCtx(), await actorFor(req), id, {
      text: String(b.text ?? ''), mention: opt(b.mention), objective: opt(b.objective), instructionFor: opt(b.instructionFor),
    }))
  })
}
