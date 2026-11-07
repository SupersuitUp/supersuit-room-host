// src/lib/tether-log/model.ts
// A room's events in, a tether log out. Pure: no clock, no network, no model call. The only judgment here
// is which event a person reads as an entry; "whose move" comes from `next` and never from a guess.
import type { Check, ConversationLine, Entry, EntryKind, Open, Proof, Settled, Side, Standing, TetherEvent, TetherInput, TetherLogModel, TetherMember } from './types.ts'

const ENTRY_TYPES = new Set(['step', 'decision', 'draft.version', 'objective.amended', 'room.closed'])
const NOT_POSTS = new Set(['host'])

const firstName = (m: TetherMember | undefined) => m?.answersToName ?? m?.answersTo ?? 'a person'

export function tetherLog(input: TetherInput): TetherLogModel {
  const { room, members, objectives, events } = input
  const drafts = input.drafts ?? []
  const checks = input.checks ?? {}
  const memberOf = (id: string) => members.find((m) => m.id === id)
  const nameOf = (id: string) => (id === 'host' ? 'The host' : memberOf(id)?.name ?? 'A former member')
  const sideOf = (id: string): Side => (members.findIndex((m) => m.id === id) % 2 === 1 ? 'right' : 'left')
  const checkOf = (e: TetherEvent): Check => checks[e.seq] ?? 'unsigned'

  const shown = events.filter((e) => ENTRY_TYPES.has(e.type))
  const noOf = new Map(shown.map((e, i) => [e.seq, i + 1]))
  const reversedBy = new Map<number, number>()
  for (const e of shown) for (const seq of (e.reverses as number[] | undefined) ?? []) reversedBy.set(seq, noOf.get(e.seq)!)

  const entry = (e: TetherEvent): Entry => {
    const base = { no: noOf.get(e.seq)!, seq: e.seq, side: sideOf(e.by), who: nameOf(e.by), at: e.at, check: checkOf(e), proof: [] as Proof[], reversedBy: reversedBy.get(e.seq),
      reverses: ((e.reverses as number[] | undefined) ?? []).flatMap((s) => (noOf.has(s) ? [noOf.get(s)!] : [])) }
    if (e.redacted) return { ...base, kind: 'redacted' }
    const person = firstName(memberOf(e.by))
    const said = e.said as { words: string } | undefined
    switch (e.type) {
      case 'decision': return { ...base, kind: 'decision', words: e.words as string, saidBy: firstName(members.find((m) => m.answersTo === e.owner)), carriedBy: base.who, verdict: e.verdict as string, rejected: e.rejected as string | undefined, reason: e.reason as string | undefined }
      case 'draft.version': return { ...base, kind: 'draft', text: `Posted version ${String(e.version)} of "${String(e.title)}".` }
      case 'objective.amended': return { ...base, kind: 'amended', text: `Changed the intent to "${String(e.title ?? e.done)}".`, reason: e.reason as string }
      case 'room.closed': return { ...base, kind: 'closed', text: 'Closed this log.' }
      default: return { ...base, kind: (said ? 'said' : 'step') satisfies EntryKind, text: e.text as string, words: said?.words, saidBy: said ? person : undefined, carriedBy: said ? base.who : undefined, proof: (e.proof as Proof[] | undefined) ?? [] }
    }
  }
  const entries = shown.map(entry).reverse()

  const posts = events.filter((e) => !NOT_POSTS.has(e.by))
  const signatures = {
    total: posts.length,
    signed: posts.filter((e) => checkOf(e) === 'signed').length,
    failed: posts.filter((e) => checkOf(e) === 'failed').length,
    redacted: posts.filter((e) => checkOf(e) === 'redacted').length,
  }

  const conversation: ConversationLine[] = events
    .filter((e) => (e.type === 'message' || e.type === 'step' || e.type === 'decision') && !e.redacted)
    .map((e) => ({ seq: e.seq, who: nameOf(e.by), at: e.at, text: String(e.text ?? e.words ?? ''), check: checkOf(e) }))
    .reverse()

  const steps = events.filter((e) => e.type === 'step' && !e.redacted)
  let handoffs = 0, holder: string | null = null
  for (const e of steps) if (e.next && e.next !== holder) { if (holder !== null || e.next !== e.by) handoffs++; holder = e.next as string }

  const lastAt = events.at(-1)?.at ?? room.createdAt
  const lastStep = steps.at(-1)
  const nextId = lastStep?.next as string | undefined
  const undecided = drafts.filter((d) => {
    const fp = d.versions.find((v) => v.n === d.latest)?.fingerprint
    return !d.decisions.some((x) => x.version === d.latest && x.fingerprint === fp)
  })
  const allDone = objectives.length > 0 && objectives.every((o) => o.status === 'done')
  const ownerName = (person: string) => firstName(members.find((m) => m.answersTo === person))
  const standing: Standing = room.state === 'closed' || allDone
    ? { state: 'Done', at: room.closedAt ?? lastAt, line: 'This work is finished.', waitingOn: null }
    : undecided.length ? { state: 'Waiting', at: lastAt, line: `Waiting on ${ownerName(undecided[0].owner)}`, waitingOn: ownerName(undecided[0].owner) }
    : nextId ? { state: 'Waiting', at: lastStep!.at, line: `Waiting on ${nameOf(nextId)}`, waitingOn: nameOf(nextId) }
    : { state: 'Working', at: lastAt, line: 'The work is moving.', waitingOn: null }

  const open: Open[] = []
  if (standing.state === 'Waiting') open.push({ text: standing.line, ref: 'Next' })
  for (const d of undecided) open.push({ text: `A decision on "${d.title}"`, ref: 'Draft' })
  for (const o of objectives) if (o.status !== 'done') open.push({ text: o.done, ref: 'Done means' })

  const live = entries.filter((e) => e.reversedBy === undefined)
  const settled: Settled[] = [
    ...live.filter((e) => e.kind === 'decision' && e.verdict === 'approve').map((e) => ({ text: e.words!, person: true, ref: `${e.saidBy}, No. ${e.no}` })),
    ...live.filter((e) => e.proof.length).map((e) => ({ text: e.text!, person: false, ref: `No. ${e.no}` })),
  ]

  const story = [...entries].reverse().flatMap((e) => {
    if (e.kind === 'decision') return [`${e.saidBy} decided: "${e.words}".`]
    if (e.proof.length) return [`${e.who}: ${e.text} Proof: ${e.proof.map((p) => p.label).join(', ')}.`]
    return []
  })

  const count = (s: Side) => entries.filter((e) => e.side === s).length
  const sideCount = (m: TetherMember, s: Side) => ({ name: m.name, answersTo: firstName(m), count: count(s), lastSeenAt: m.lastSeenAt })
  const active = members.filter((m) => !m.retired)
  return {
    name: room.name, intent: objectives[0]?.title ?? room.name, done: objectives[0]?.done ?? '',
    people: active.map(firstName), from: room.createdAt, to: lastAt,
    standing, settled, open, story,
    left: sideCount(members[0], 'left'), right: members[1] ? sideCount(members[1], 'right') : null, handoffs,
    entries, conversation, library: (input.context ?? []).filter((c) => !c.retired), signatures,
  }
}
