// src/lib/tether-log/story-fixture.ts
// An invented tether with sample people, about a shared plot at a community garden. It has the shape the
// tests read: a proposal, a finding, a person questioning it in their own words, a reversal, a draft, a
// decision with what was rejected and why, a chat message, and a last step with proof and whose move is next.
import type { TetherInput } from './types.ts'

const T = Date.parse('2026-11-05T15:00:00.000Z')
const min = 60_000
const signed = (seq: number) => seq

export const storyFixture: TetherInput = {
  room: { id: 'r1', name: 'The shared garden plot', state: 'open', createdAt: T },
  members: [
    { id: 'a-ada', name: "Ada's Pluma", answersTo: 'ada', answersToName: 'Ada', lastSeenAt: T + 600 * min },
    { id: 'a-ben', name: "Ben's Pluma", answersTo: 'ben', answersToName: 'Ben', lastSeenAt: T + 610 * min },
  ],
  objectives: [{ id: 'o1', title: 'Ada and Ben plant one shared plot at the community garden this spring, and both know who waters on which day.', owner: 'ada', done: 'The plot is booked, the seeds are bought, and the watering days are on both calendars.', status: 'working' }],
  drafts: [{ id: 'd1', title: 'Which seeds to buy', owner: 'ada', latest: 1, versions: [{ n: 1, fingerprint: 'f1' }], decisions: [{ version: 1, fingerprint: 'f1' }] }],
  events: [
    { seq: 1, type: 'room.created', by: 'host', at: T },
    { seq: 2, type: 'member.joined', by: 'a-ada', at: T },
    { seq: 3, type: 'member.joined', by: 'a-ben', at: T + min },
    { seq: 4, type: 'objective.created', by: 'a-ada', at: T + 2 * min, objective: 'o1', title: 'x', owner: 'ada' },
    { seq: 5, type: 'step', by: 'a-ben', at: T + 3 * min, text: 'Proposed a split: Ada plants herbs in one half, and Ben plants tomatoes in the other.' },
    { seq: 6, type: 'step', by: 'a-ada', at: T + 20 * min, text: 'Read the garden rules. Each plot is planted as one bed.' },
    { seq: 7, type: 'step', by: 'a-ben', at: T + 30 * min, text: 'Ben asked about the split.', said: { words: 'why not just share the whole bed', saidAt: '2026-11-05T15:29:00.000Z' } },
    { seq: 8, type: 'step', by: 'a-ada', at: T + 40 * min, text: 'Dropped the split. Both plant the whole bed together.', reverses: [5] },
    { seq: 9, type: 'draft.version', by: 'a-ada', at: T + 50 * min, draft: 'd1', version: 1, title: 'Which seeds to buy', owner: 'ada', fingerprint: 'f1' },
    { seq: 10, type: 'decision', by: 'a-ada', at: T + 60 * min, draft: 'd1', version: 1, verdict: 'approve', words: 'Tomatoes and basil', saidAt: '2026-11-05T15:59:00.000Z', owner: 'ada', rejected: 'Squash and beans', reason: 'They fit the bed.' },
    { seq: 11, type: 'message', by: 'a-ben', at: T + 70 * min, text: 'Looking at the watering days now.' },
    { seq: 12, type: 'step', by: 'a-ada', at: T + 80 * min, text: 'Booked the plot with the garden office.', proof: [{ label: 'booking receipt' }], next: 'a-ben' },
  ],
  context: [{ name: 'Garden rules', why: 'What each plot may hold, and when the water is on.' }],
  checks: Object.fromEntries([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map((s) => [signed(s), s === 1 ? 'host' : 'signed'])),
}
