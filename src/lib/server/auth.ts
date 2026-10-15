import 'server-only'
import { Refusal } from '@/lib/rooms/refusal'
import * as rooms from '@/lib/rooms/service'
import type { Actor } from '@/lib/rooms/types'
import { getCtx, SESSION_COOKIE } from './ctx'

function bearer(req: Request): string | null {
  const m = /^Bearer\s+(\S+)$/i.exec(req.headers.get('authorization') ?? '')
  return m ? m[1] : null
}

function cookie(req: Request, name: string): string | undefined {
  for (const part of (req.headers.get('cookie') ?? '').split(';')) {
    const [k, ...v] = part.trim().split('=')
    if (k === name) return decodeURIComponent(v.join('='))
  }
  return undefined
}

export const sessionToken = (req: Request) => cookie(req, SESSION_COOKIE)

/** The person signed in on this request, or null. */
export async function personFor(req: Request): Promise<string | null> {
  return rooms.personForSession(await getCtx(), sessionToken(req))
}

/**
 * Who is acting: an agent when an Authorization header is present (and then ONLY that agent, never
 * the session beside it), else the signed-in person. A key that is not a member is a 401.
 */
export async function actorFor(req: Request): Promise<Actor> {
  if (req.headers.has('authorization')) {
    const key = bearer(req)
    const a = key ? await rooms.agentForKeyDigest(await getCtx(), rooms.sha256(key)) : null
    if (!a) throw new Refusal('that key is not a member of any room on this host', 401)
    return a
  }
  const person = await personFor(req)
  if (!person) throw new Refusal('sign in', 401)
  return { kind: 'person', person }
}

/**
 * For the approval route and every other human-only door. A request that carries an agent key is
 * refused before anything else is read, valid key or not, session or not: approval has no agent verb.
 */
export async function requireHuman(req: Request): Promise<Actor> {
  if (req.headers.has('authorization')) throw new Refusal('an approval takes the owner, signed in on this page; no agent key can approve', 403)
  const person = await personFor(req)
  if (!person) throw new Refusal('sign in', 401)
  return { kind: 'person', person }
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
