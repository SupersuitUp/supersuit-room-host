import 'server-only'
import { DEFAULT_AUDIENCE, type Ctx } from '@/lib/rooms/service'

export const SESSION_COOKIE = 'room-session'

/**
 * The audience a tether-start must name on this deployment: ROOMS_AUDIENCE, its own origin, which a
 * preview or a second host sets; the production origin when unset (second review, finding 6).
 */
export const audienceFrom = (env: Record<string, string | undefined>) => env.ROOMS_AUDIENCE || DEFAULT_AUDIENCE

let override: Ctx | null = null
let prod: Ctx | null = null

/** The store, object store, suit directory and clock every route uses: Firestore and Cloud Storage in production, memory in tests. */
export async function getCtx(): Promise<Ctx> {
  if (override) return override
  if (!prod) {
    const { devFixtureEnabled, seedDevFixture } = await import('@/lib/rooms/dev-fixture')
    if (devFixtureEnabled(process.env)) {
      // next dev loads this module once for each bundle (route handlers, server pages), so one fixture
      // is kept on globalThis. Without it, /s/<token> and the API would each seed a different room.
      const g = globalThis as { __roomsDevFixture?: ReturnType<typeof seedDevFixture> }
      const first = !g.__roomsDevFixture
      g.__roomsDevFixture ??= seedDevFixture()
      const { ctx, roomId, shareToken } = await g.__roomsDevFixture
      if (first) console.log(`dev fixture: open /r/${roomId} with the cookie room-session=dev-session, and the shared page at /s/${shareToken}`)
      return (prod = ctx)
    }
    const { FirestoreStore } = await import('@/lib/rooms/firestore-store')
    const { GcsObjectStore } = await import('@/lib/rooms/gcs-object-store')
    const { getAdminDb, getContextBucket } = await import('./firebase-admin')
    const { suitDirectory } = await import('./directory')
    const bucket = getContextBucket()
    prod = { store: new FirestoreStore(getAdminDb()), now: () => Date.now(), objects: bucket ? new GcsObjectStore(bucket) : undefined, directory: suitDirectory, audience: audienceFrom(process.env) }
  }
  return prod
}

export function setCtxForTests(ctx: Ctx | null) { override = ctx }
