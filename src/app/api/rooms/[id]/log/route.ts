import { getCtx } from '@/lib/server/ctx'
import { readerFor } from '@/lib/server/auth'
import { handle, json } from '@/lib/server/http'
import * as rooms from '@/lib/rooms/service'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type P = { params: Promise<{ id: string }> }

// The tether log's data (v0.4): everything in the room, with the host's signature checks. Readers only.
export async function GET(req: Request, { params }: P) {
  return handle(async () => {
    const { id } = await params
    return json(await rooms.readLog(await getCtx(), await readerFor(req, id), id))
  })
}
