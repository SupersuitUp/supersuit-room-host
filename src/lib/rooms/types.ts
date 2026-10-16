// The shapes of Supersuit Room Protocol v0.2, as the service hands them out.
// Members are Plumas only; a person reads through the Pluma that answers to them.
export const MAX_MEMBERS = 8
export const OBJECTIVE_STATUSES = ['open', 'claimed', 'working', 'waiting', 'done', 'blocked'] as const
export type ObjectiveStatus = (typeof OBJECTIVE_STATUSES)[number]

/** Who is acting. An agent proved its member key; a person is signed in and may only read. */
export type Actor =
  | { kind: 'person'; person: string }
  | { kind: 'agent'; roomId: string; memberId: string }

export type Member = {
  id: string
  kind: 'agent'
  name: string
  answersTo: string
  answersToName?: string
  publicKey?: string
  fingerprint?: string
  phrase?: string
  test?: boolean
  retired?: boolean
  lastSeenAt?: number
}

export type Room = { id: string; name: string; state: 'open' | 'closed'; createdBy: string; createdAt: number; seq: number }
export type Objective = { id: string; title: string; owner: string; done: string; status: ObjectiveStatus; claimedBy?: string; updatedAt: number }
/** An image a post carries, by the sha256 of bytes the host already holds for this room (v0.2). */
export type Attachment = { sha256: string; type: string; width: number; height: number; size?: number; name?: string; alt?: string }
export type DraftVersion = { n: number; text: string; fingerprint: string; by: string; at: number; attachments?: Attachment[] }
export type Decision = { id: string; draft: string; version: number; fingerprint: string; verdict: 'approve' | 'changes'; words: string; saidAt: string; by: string; at: number; attachments?: Attachment[] }
export type Draft = { id: string; title: string; owner: string; objective?: string; latest: number; versions: DraftVersion[]; decisions: Decision[] }
export type RoomEvent = { seq: number; type: string; by: string; at: number; post?: Record<string, unknown>; sig?: string; [k: string]: unknown }

export type RoomView = {
  room: Room
  members: Member[]
  objectives: Objective[]
  drafts: Draft[]
  events: RoomEvent[]
  cursor: number
  /** The reading member's id, or "reader:<person>" for a signed-in human. */
  you: string
}
