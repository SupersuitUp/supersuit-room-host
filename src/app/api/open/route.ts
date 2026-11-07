import { getCtx, SESSION_COOKIE } from '@/lib/server/ctx'
import { handle, json, body } from '@/lib/server/http'
import * as rooms from '@/lib/rooms/service'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Spends a reader link (v0.4). POST only: a messaging app fetches a link to draw its preview, and a GET
// here would spend the link before the person taps it.
export async function POST(req: Request) {
  return handle(async () => {
    const b = await body(req)
    const opened = typeof b.token === 'string' ? await rooms.redeemReaderLink(await getCtx(), b.token) : null
    if (!opened) return json({ error: 'This link was already used, or it expired. Ask your Pluma for a new one.' }, 404)
    const res = json({ room: opened.roomId })
    res.headers.append('set-cookie', `${SESSION_COOKIE}=${opened.session}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${rooms.SESSION_MS / 1000}`)
    return res
  })
}
