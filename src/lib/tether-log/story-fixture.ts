// src/lib/tether-log/story-fixture.ts
// The shape of one real tether, with sample people. A split was proposed, reading the code showed it was
// not needed, a person questioned it, it was reversed, a person decided, and the work waits on the other side.
import type { TetherInput } from './types.ts'

const T = Date.parse('2026-11-05T15:00:00.000Z')
const min = 60_000
const signed = (seq: number) => seq

export const storyFixture: TetherInput = {
  room: { id: 'r1', name: 'One card for one answer', state: 'open', createdAt: T },
  members: [
    { id: 'a-ada', name: "Ada's Pluma", answersTo: 'ada', answersToName: 'Ada', lastSeenAt: T + 600 * min },
    { id: 'a-ben', name: "Ben's Pluma", answersTo: 'ben', answersToName: 'Ben', lastSeenAt: T + 610 * min },
  ],
  objectives: [{ id: 'o1', title: "When one agent needs a person's answer, it lands as one card, and nobody pastes anything.", owner: 'ada', done: 'A request reaches the other side as a card, and the tap comes back.', status: 'working' }],
  drafts: [{ id: 'd1', title: 'Who may send a request', owner: 'ada', latest: 1, versions: [{ n: 1, fingerprint: 'f1' }], decisions: [{ version: 1, fingerprint: 'f1' }] }],
  events: [
    { seq: 1, type: 'room.created', by: 'host', at: T },
    { seq: 2, type: 'member.joined', by: 'a-ada', at: T },
    { seq: 3, type: 'member.joined', by: 'a-ben', at: T + min },
    { seq: 4, type: 'objective.created', by: 'a-ada', at: T + 2 * min, objective: 'o1', title: 'x', owner: 'ada' },
    { seq: 5, type: 'step', by: 'a-ben', at: T + 3 * min, text: 'Proposed a split: Ada builds the server half, Ben builds the card.' },
    { seq: 6, type: 'step', by: 'a-ada', at: T + 20 * min, text: 'Read the card code. The card already exists.' },
    { seq: 7, type: 'step', by: 'a-ben', at: T + 30 * min, text: 'Ben questioned the split.', said: { words: 'what does the split buy us', saidAt: '2026-11-05T15:29:00.000Z' } },
    { seq: 8, type: 'step', by: 'a-ada', at: T + 40 * min, text: 'Dropped the split. One device builds, and the other tests.', reverses: [5] },
    { seq: 9, type: 'draft.version', by: 'a-ada', at: T + 50 * min, draft: 'd1', version: 1, title: 'Who may send a request', owner: 'ada', fingerprint: 'f1' },
    { seq: 10, type: 'decision', by: 'a-ada', at: T + 60 * min, draft: 'd1', version: 1, verdict: 'approve', words: 'Invite tree only', saidAt: '2026-11-05T15:59:00.000Z', owner: 'ada', rejected: 'Anyone with a handle', reason: 'Fewer strangers.' },
    { seq: 11, type: 'message', by: 'a-ben', at: T + 70 * min, text: 'Reading the server change now.' },
    { seq: 12, type: 'step', by: 'a-ada', at: T + 80 * min, text: 'Built requests on the server and put the change live.', proof: [{ label: 'commit af317d5' }], next: 'a-ben' },
  ],
  context: [{ name: 'Exploration notes', why: 'The trust ladder and the decisions behind it.' }],
  checks: Object.fromEntries([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map((s) => [signed(s), s === 1 ? 'host' : 'signed'])),
}
