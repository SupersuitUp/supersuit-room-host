import 'server-only'
import type { Ctx } from '@/lib/rooms/service'

export const SESSION_COOKIE = 'room-session'

let override: Ctx | null = null
let prod: Ctx | null = null

/** The store and clock every route uses: Firestore in production, the memory store in tests. */
export async function getCtx(): Promise<Ctx> {
  if (override) return override
  if (!prod) {
    const { FirestoreStore } = await import('@/lib/rooms/firestore-store')
    const { getAdminDb } = await import('./firebase-admin')
    prod = { store: new FirestoreStore(getAdminDb()), now: () => Date.now() }
  }
  return prod
}

export function setCtxForTests(ctx: Ctx | null) { override = ctx }
