import 'server-only'
import { verifyLog } from '@supersuit/suit-identity'
import type { Directory } from '@/lib/rooms/service'

const PORTAL = process.env.SUIT_DIRECTORY || 'https://freedom.continentalworks.ai'

/** A suit's keys from the public directory, checked by replaying its key log here (v0.4). */
export const suitDirectory: Directory = async (handle) => {
  const r = await fetch(`${PORTAL}/api/suit/${encodeURIComponent(handle)}`, { signal: AbortSignal.timeout(10_000) })
  const d = await r.json().catch(() => null) as { suit?: string; log?: unknown } | null
  if (!r.ok || !d?.log) return null
  const v = verifyLog(d.log)
  return v.ok && v.suit === d.suit ? { suit: v.suit, keys: v.keys } : null
}
