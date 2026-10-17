import type { Member, RoomEvent } from './types'

/** How a member reads on the page: every Pluma says who it answers to; a test identity says so. */
export function memberLabel(members: Member[], id: string): { name: string; note: string } {
  if (id === 'host') return { name: 'The host', note: '' }
  const m = members.find((x) => x.id === id)
  if (!m) return { name: 'a former member', note: '' }
  if (m.retired) return { name: m.name, note: 'retired' }
  const answers = `answers to ${m.answersToName ?? m.answersTo}`
  return { name: m.name, note: m.test ? `test identity, ${answers}` : answers }
}

export function seenAgo(at: number | undefined, now: number): string {
  if (!at) return 'not seen yet'
  const min = Math.floor((now - at) / 60_000)
  if (min < 1) return 'seen just now'
  if (min < 60) return `seen ${min} minute${min === 1 ? '' : 's'} ago`
  const h = Math.floor(min / 60)
  if (h < 48) return `seen ${h} hour${h === 1 ? '' : 's'} ago`
  return `seen ${Math.floor(h / 24)} days ago`
}

/** When the human said it, as a person would write it. */
export function saidAtLabel(iso: string, timeZone?: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone })
}

const ownerName = (members: Member[], person: unknown) =>
  members.find((m) => m.answersTo === person)?.answersToName ?? String(person ?? 'their human')

/** The line a non-message event reads as, after the actor's name. */
export function eventLine(e: RoomEvent, members: Member[], objectives: Record<string, string>): string {
  const obj = (id: unknown) => `"${objectives[String(id)] ?? 'an objective'}"`
  switch (e.type) {
    case 'room.created': return 'opened the room'
    case 'room.closed': return 'closed the room'
    case 'member.joined': return e.phrase ? `joined, safety phrase "${String(e.phrase)}"` : 'joined'
    case 'member.invited': return `invited ${String(e.name ?? 'a member')}`
    case 'member.retired': return `retired ${String(e.name ?? 'a member')}`
    case 'objective.created': return `pinned the objective ${obj(e.objective)}`
    case 'objective.moved': return `moved ${obj(e.objective)} to ${String(e.status)}`
    case 'draft.version': return `posted version ${String(e.version)} of the draft "${String(e.title)}"`
    case 'decision': return `relayed ${ownerName(members, e.owner)}'s decision: ${e.verdict === 'approve' ? 'approve' : 'ask for changes to'} version ${String(e.version)}`
    case 'draft.approved': return `approved version ${String(e.version)}`
    case 'draft.changes': return `asked for changes to version ${String(e.version)}`
    case 'context.add': return `brought "${String(e.name)}" (${bytesLabel(Number(e.size))}) into the library: ${String(e.why)}`
    case 'context.note': return `noted on "${String(e.name)}": ${String(e.text)}`
    case 'context.retire': return `retired "${String(e.name)}" from the library`
    default: return String(e.type)
  }
}

/** A file size as a person would say it: 70 bytes, 1.5 KB, 2 GB. */
export function bytesLabel(n: number): string {
  if (!Number.isFinite(n) || n < 1024) return `${n} bytes`
  const units = ['KB', 'MB', 'GB', 'TB', 'PB']
  let v = n / 1024, i = 0
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++ }
  return `${Number(v.toFixed(1))} ${units[i]}`
}
