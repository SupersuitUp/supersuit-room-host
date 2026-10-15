import { getCtx } from '@/lib/server/ctx'
import { requireHuman } from '@/lib/server/auth'
import { handle, json, body } from '@/lib/server/http'
import * as rooms from '@/lib/rooms/service'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type P = { params: Promise<{ id: string; did: string }> }

// THE APPROVAL DOOR. Human only: requireHuman refuses any request carrying an agent key before
// the body is read, and the service then requires the draft's owner and the latest fingerprint.
export async function POST(req: Request, { params }: P) {
  return handle(async () => {
    const actor = await requireHuman(req)
    const { id, did } = await params
    const b = await body(req)
    await rooms.approve(await getCtx(), actor, id, did, {
      version: Number(b.version), fingerprint: String(b.fingerprint ?? ''), verdict: b.verdict as 'approve' | 'changes',
    })
    return json({ ok: true })
  })
}
