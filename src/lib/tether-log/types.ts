// src/lib/tether-log/types.ts
// The input is the host's room view, kept to the fields the log reads, so this folder needs nothing from
// the host. The Helm holds a pinned copy of this folder (helm2/scripts/vendor-tether-log.mjs).
export type Check = 'signed' | 'failed' | 'unsigned' | 'host' | 'redacted'
export type Proof = { label: string; href?: string }

export type TetherMember = { id: string; name: string; answersTo: string; answersToName?: string; retired?: boolean; lastSeenAt?: number }
export type TetherObjective = { id: string; title: string; owner: string; done: string; status: string }
/** redacted: taken back, so it decides nothing. */
export type TetherDecisionRef = { version: number; fingerprint: string; redacted?: unknown }
export type TetherDraft = { id: string; title: string; owner: string; latest: number; versions: { n: number; fingerprint: string }[]; decisions: TetherDecisionRef[] }
export type TetherEvent = { seq: number; type: string; by: string; at: number; [k: string]: unknown }
export type TetherContextItem = { name: string; why: string; retired?: boolean }

export type TetherInput = {
  room: { id: string; name: string; state: string; createdAt: number; closedAt?: number }
  members: TetherMember[]
  objectives: TetherObjective[]
  drafts?: TetherDraft[]
  events: TetherEvent[]
  context?: TetherContextItem[]
  checks?: Record<number, Check>
}

export type EntryKind = 'step' | 'said' | 'decision' | 'draft' | 'amended' | 'closed' | 'redacted'
export type Side = 'left' | 'right'

export type Entry = {
  no: number; seq: number; kind: EntryKind; side: Side; who: string; at: number; check: Check
  text?: string; words?: string; saidBy?: string; carriedBy?: string; verdict?: string
  rejected?: string; reason?: string; proof: Proof[]
  /** Entry numbers, never seqs: what a reader sees. */
  reversedBy?: number; reverses: number[]
}

export type ConversationLine = { seq: number; who: string; at: number; text: string; check: Check }
export type SideCount = { name: string; answersTo: string; count: number; lastSeenAt?: number }
export type Standing = { state: 'Waiting' | 'Working' | 'Done'; at: number; line: string; waitingOn: string | null }
export type Settled = { text: string; person: boolean; ref: string }
export type Open = { text: string; ref: string }
export type Signatures = { total: number; signed: number; failed: number; redacted: number }

export type TetherLogModel = {
  name: string; intent: string; done: string; people: string[]
  from: number; to: number
  standing: Standing; settled: Settled[]; open: Open[]; story: string[]
  left: SideCount; right: SideCount | null; handoffs: number
  entries: Entry[]; conversation: ConversationLine[]; library: TetherContextItem[]; signatures: Signatures
}
