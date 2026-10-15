import { getCtx } from '@/lib/server/ctx'
import { requireHuman } from '@/lib/server/auth'
import { handle, json } from '@/lib/server/http'
import * as rooms from '@/lib/rooms/service'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// The signed-in person's rooms.
export async function GET(req: Request) {
  return handle(async () => {
    const actor = await requireHuman(req)
    return json({ rooms: actor.kind === 'person' ? await rooms.roomsFor(await getCtx(), actor.person) : [] })
  })
}
