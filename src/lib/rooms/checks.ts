// Each event checked against its member's key, on the host, because a phone's browser cannot be proved
// here. The log says who checked: the host for its page, the Mac for the tile.
import { verifySigned } from './signing'
import type { Member, RoomEvent } from './types'

export type Check = 'signed' | 'failed' | 'unsigned' | 'host' | 'redacted'

export function checkEvents(events: RoomEvent[], members: Member[]): Record<number, Check> {
  const out: Record<number, Check> = {}
  for (const e of events) {
    if (e.redacted) { out[e.seq] = 'redacted'; continue }
    if (e.by === 'host') { out[e.seq] = 'host'; continue }
    if (!e.post || !e.sig) { out[e.seq] = 'unsigned'; continue }
    const m = members.find((x) => x.id === e.by)
    out[e.seq] = m?.publicKey && e.post.member === e.by && verifySigned(m.publicKey, e.post, e.sig) ? 'signed' : 'failed'
  }
  return out
}
