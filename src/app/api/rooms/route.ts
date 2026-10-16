import { getCtx } from '@/lib/server/ctx'
import { requirePerson } from '@/lib/server/auth'
import { handle, json } from '@/lib/server/http'
import * as rooms from '@/lib/rooms/service'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// The rooms the signed-in person may read: those their own Pluma is in.
export async function GET(req: Request) {
  return handle(async () => json({ rooms: await rooms.roomsFor(await getCtx(), await requirePerson(req)) }))
}
