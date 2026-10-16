import 'server-only'
import { Refusal } from '@/lib/rooms/refusal'
import * as rooms from '@/lib/rooms/service'
import type { Actor } from '@/lib/rooms/types'
import { getCtx, SESSION_COOKIE } from './ctx'

function cookie(req: Request, name: string): string | undefined {
  for (const part of (req.headers.get('cookie') ?? '').split(';')) {
    const [k, ...v] = part.trim().split('=')
    if (k === name) return decodeURIComponent(v.join('='))
  }
  return undefined
}

export const sessionToken = (req: Request) => cookie(req, SESSION_COOKIE)

/** The person signed in on this request, or null. A person only ever reads. */
export async function personFor(req: Request): Promise<string | null> {
  return rooms.personForSession(await getCtx(), sessionToken(req))
}

/**
 * Who is reading: a member that signed this read (x-room-request, the base64url canonical JSON of
 * {v:1, type:'read', room, member, after, at, nonce}, and x-room-signature), else the signed-in
 * person. A request that offers a signature is judged ONLY by it, never by a session beside it.
 */
export async function readerFor(req: Request, roomId: string): Promise<Actor> {
  const raw = req.headers.get('x-room-request')
  if (raw !== null) {
    let parsed: Record<string, unknown>
    try { parsed = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8')) } catch { throw new Refusal('the signed read could not be parsed', 401) }
    if (!parsed || typeof parsed !== 'object') throw new Refusal('the signed read could not be parsed', 401)
    return rooms.agentForSignedRead(await getCtx(), roomId, parsed, req.headers.get('x-room-signature') ?? '')
  }
  const person = await personFor(req)
  if (!person) throw new Refusal('sign in', 401)
  return { kind: 'person', person }
}

/** A signed-in person, for the read-only pages. */
export async function requirePerson(req: Request): Promise<string> {
  const person = await personFor(req)
  if (!person) throw new Refusal('sign in', 401)
  return person
}

// ---- Google sign-in: the ID token from the page, verified by firebase-admin ----

type Verified = { email?: string; email_verified?: boolean }
let verifier: ((idToken: string) => Promise<Verified>) | null = null

export function setIdTokenVerifierForTests(v: typeof verifier) { verifier = v }

export async function verifyIdToken(idToken: string): Promise<Verified | null> {
  if (verifier) return verifier(idToken).catch(() => null)
  const { getAdminAuth } = await import('./firebase-admin')
  return getAdminAuth().verifyIdToken(idToken).catch(() => null)
}
