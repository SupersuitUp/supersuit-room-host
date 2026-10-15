import { getCtx, SESSION_COOKIE } from '@/lib/server/ctx'
import { sessionToken, verifyIdToken } from '@/lib/server/auth'
import { handle, json, body } from '@/lib/server/http'
import * as rooms from '@/lib/rooms/service'

export const runtime = 'nodejs'

// The page signs in with Google and hands over the ID token. A verified email that belongs to a
// person on this host gets a session; everyone else gets the same 403, so nothing about the host leaks.
export async function POST(req: Request) {
  return handle(async () => {
    const b = await body(req)
    const ctx = await getCtx()
    const v = typeof b.idToken === 'string' ? await verifyIdToken(b.idToken) : null
    const person = v?.email_verified && v.email ? await rooms.personForEmail(ctx, v.email) : null
    if (!person) return json({ ok: false }, 403)
    const token = await rooms.createSession(ctx, person)
    const res = json({ ok: true })
    res.headers.append('set-cookie', `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${rooms.SESSION_MS / 1000}`)
    return res
  })
}

export async function DELETE(req: Request) {
  return handle(async () => {
    await rooms.endSession(await getCtx(), sessionToken(req))
    const res = json({ ok: true })
    res.headers.append('set-cookie', `${SESSION_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`)
    return res
  })
}
