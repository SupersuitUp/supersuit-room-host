import { getCtx } from '@/lib/server/ctx'
import { handle, json, body } from '@/lib/server/http'
import * as rooms from '@/lib/rooms/service'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// A Pluma opens a tether (v0.4), under an entry its operator's suit key signed. A person never writes here.
export async function POST(req: Request) {
  return handle(async () => json(await rooms.startTether(await getCtx(), await body(req))))
}
