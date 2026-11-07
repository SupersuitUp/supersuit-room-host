// src/lib/tether-log/model.test.ts
import { describe, it, expect } from 'vitest'
import { tetherLog } from './model.ts'
import { storyFixture as S } from './story-fixture.ts'

const m = tetherLog(S)

describe('tetherLog, on the shape of a real tether', () => {
  it('runs newest first, and numbers entries from the first, with bookkeeping left out', () => {
    expect(m.entries.map((e) => e.seq)).toEqual([12, 10, 9, 8, 7, 6, 5])
    expect(m.entries.map((e) => e.no)).toEqual([7, 6, 5, 4, 3, 2, 1])
  })
  it('gives each Pluma its side, by join order', () => {
    expect(m.entries.find((e) => e.seq === 5)).toMatchObject({ side: 'right', who: "Ben's Pluma" })
    expect(m.entries.find((e) => e.seq === 6)).toMatchObject({ side: 'left' })
    expect([m.left.count, m.right?.count]).toEqual([5, 2])
  })
  it('turns a reversal into links both ways, by entry number', () => {
    expect(m.entries.find((e) => e.seq === 5)).toMatchObject({ reversedBy: 4 })
    expect(m.entries.find((e) => e.seq === 8)).toMatchObject({ reverses: [1] })
  })
  it('shows a person\'s words with who carried them', () => {
    expect(m.entries.find((e) => e.seq === 7)).toMatchObject({ kind: 'said', words: 'what does the split buy us', saidBy: 'Ben', carriedBy: "Ben's Pluma" })
    expect(m.entries.find((e) => e.seq === 10)).toMatchObject({ kind: 'decision', words: 'Invite tree only', saidBy: 'Ada', rejected: 'Anyone with a handle', reason: 'Fewer strangers.' })
  })
  it('says whose move it is from `next`, never from a guess', () => {
    expect(m.standing).toMatchObject({ state: 'Waiting', waitingOn: "Ben's Pluma", line: "Waiting on Ben's Pluma" })
    const noNext = { ...S, events: S.events.filter((e) => e.seq !== 12) }
    expect(tetherLog(noNext).standing).toMatchObject({ state: 'Working', waitingOn: null })
  })
  it('counts a handoff when `next` changes', () => {
    expect(m.handoffs).toBe(1)
    const two = { ...S, events: [...S.events, { seq: 13, type: 'step', by: 'a-ben', at: S.events[11].at + 1, text: 'Read it.', next: 'a-ada' }] }
    expect(tetherLog(two).handoffs).toBe(2)
  })
  it('fills Settled and Still open', () => {
    expect(m.settled[0]).toMatchObject({ text: 'Invite tree only', person: true })
    expect(m.settled.map((s) => s.text)).toContain('Built requests on the server and put the change live.')
    expect(m.open.map((o) => o.text)).toContain("Waiting on Ben's Pluma")
    expect(m.open.map((o) => o.text)).toContain(S.objectives[0].done)
  })
  it('writes the story from typed events, one line for each decision and each proof', () => {
    expect(m.story).toEqual(['Ada decided: "Invite tree only".', "Ada's Pluma: Built requests on the server and put the change live. Proof: commit af317d5."])
  })
  it('keeps chat out of the entries and in the conversation', () => {
    expect(m.entries.some((e) => e.seq === 11)).toBe(false)
    expect(m.conversation.map((c) => c.seq)).toContain(11)
  })
  it('counts the signature checks, and a failure stays a failure', () => {
    expect(m.signatures).toMatchObject({ total: 11, signed: 11, failed: 0 })
    expect(tetherLog({ ...S, checks: { ...S.checks, 6: 'failed' } }).signatures.failed).toBe(1)
  })
  it('keeps one line for a redaction and nothing of what it removed', () => {
    const gone = { ...S, events: S.events.map((e) => (e.seq === 6 ? { seq: 6, type: 'step', by: 'a-ada', at: e.at, redacted: { by: 'a-ada', at: e.at + 1 } } : e)), checks: { ...S.checks, 6: 'redacted' as const } }
    const e = tetherLog(gone).entries.find((x) => x.seq === 6)!
    expect(e).toMatchObject({ kind: 'redacted', who: "Ada's Pluma" })
    expect(e.text).toBeUndefined()
  })
  it('reads Done when the room closes or the objectives finish', () => {
    expect(tetherLog({ ...S, room: { ...S.room, state: 'closed', closedAt: 9 } }).standing.state).toBe('Done')
    expect(tetherLog({ ...S, objectives: [{ ...S.objectives[0], status: 'done' }] }).standing.state).toBe('Done')
  })
  it('handles a log with one member and no entries', () => {
    const lone = tetherLog({ ...S, members: [S.members[0]], events: S.events.slice(0, 2), drafts: [] })
    expect(lone.entries).toEqual([])
    expect(lone.right).toBeNull()
  })
})
