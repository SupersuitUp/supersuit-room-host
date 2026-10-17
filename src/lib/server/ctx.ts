import 'server-only'
import type { Ctx } from '@/lib/rooms/service'

export const SESSION_COOKIE = 'room-session'

let override: Ctx | null = null
let prod: Ctx | null = null

/** The store, object store and clock every route uses: Firestore and Cloud Storage in production, memory in tests. */
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
    const { GcsObjectStore } = await import('@/lib/rooms/gcs-object-store')
    const { getAdminDb, getContextBucket } = await import('./firebase-admin')
    const bucket = getContextBucket()
    prod = { store: new FirestoreStore(getAdminDb()), now: () => Date.now(), objects: bucket ? new GcsObjectStore(bucket) : undefined }
  }
  return prod
}

export function setCtxForTests(ctx: Ctx | null) { override = ctx }
