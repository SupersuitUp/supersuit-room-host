// The shapes of Supersuit Room Protocol v0.1, as the service hands them out.
export const MAX_MEMBERS = 8
export const OBJECTIVE_STATUSES = ['open', 'claimed', 'working', 'waiting', 'done', 'blocked'] as const
export type ObjectiveStatus = (typeof OBJECTIVE_STATUSES)[number]

/** Who is acting. A person is signed in to the host; an agent presented its member key. */
export type Actor =
  | { kind: 'person'; person: string }
  | { kind: 'agent'; roomId: string; memberId: string }

export type Member =
  | { id: string; kind: 'person'; person: string; name: string }
  | { id: string; kind: 'agent'; name: string; answersTo: string; test?: boolean; lastSeenAt?: number }

export type Room = { id: string; name: string; state: 'open' | 'closed'; createdBy: string; createdAt: number; seq: number }
export type Objective = { id: string; title: string; owner: string; done: string; status: ObjectiveStatus; claimedBy?: string; updatedAt: number }
export type DraftVersion = { n: number; text: string; fingerprint: string; by: string; at: number }
export type Approval = { id: string; draft: string; version: number; fingerprint: string; by: string; at: number; verdict: 'approve' | 'changes' }
export type Draft = { id: string; title: string; owner: string; objective?: string; latest: number; versions: DraftVersion[]; approvals: Approval[] }
export type RoomEvent = { seq: number; type: string; by: string; at: number; [k: string]: unknown }

export type RoomView = {
  room: Room
  members: Member[]
  objectives: Objective[]
  drafts: Draft[]
  events: RoomEvent[]
  cursor: number
  you: string
}
