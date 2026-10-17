import { timingSafeEqual } from 'node:crypto'
import { getCtx } from '@/lib/server/ctx'
import { handle, json } from '@/lib/server/http'
import { Refusal } from '@/lib/rooms/refusal'
import * as rooms from '@/lib/rooms/service'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 300

const matches = (got: string, want: string) => got.length === want.length && timingSafeEqual(Buffer.from(got), Buffer.from(want))

// The daily housekeeping the well-known file declares (vercel.json schedules it). Vercel sends
// Authorization: Bearer <CRON_SECRET>; with no secret configured, nothing may run it.
export async function GET(req: Request) {
  return handle(async () => {
    const secret = process.env.CRON_SECRET
    if (!secret || !matches(req.headers.get('authorization') ?? '', `Bearer ${secret}`)) throw new Refusal('not the cron', 401)
    return json(await rooms.housekeep(await getCtx()))
  })
}
