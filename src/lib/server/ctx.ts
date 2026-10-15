import 'server-only'
import type { Ctx } from '@/lib/rooms/service'

export const SESSION_COOKIE = 'room-session'

let override: Ctx | null = null
let prod: Ctx | null = null

/** The store and clock every route uses: Firestore in production, the memory store in tests. */
export async function getCtx(): Promise<Ctx> {
  if (override) return override
  if (!prod) {
    const { devFixtureEnabled, seedDevFixture } = await import('@/lib/rooms/dev-fixture')
    if (devFixtureEnabled(process.env)) {
      const { ctx, roomId } = await seedDevFixture()
      console.log(`dev fixture: open /r/${roomId} with the cookie room-session=dev-session`)
      return (prod = ctx)
    }
    const { FirestoreStore } = await import('@/lib/rooms/firestore-store')
    const { getAdminDb } = await import('./firebase-admin')
    prod = { store: new FirestoreStore(getAdminDb()), now: () => Date.now() }
  }
  return prod
}

export function setCtxForTests(ctx: Ctx | null) { override = ctx }
