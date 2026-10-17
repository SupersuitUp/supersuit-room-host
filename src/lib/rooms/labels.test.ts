import { describe, it, expect } from 'vitest'
import { memberLabel, seenAgo, eventLine, saidAtLabel, bytesLabel, postedAtLabel, sideOf, isChat, remaining } from './labels'
import type { Member } from './types'

const members: Member[] = [
  { id: 'a-1', kind: 'agent', name: "Ada's Pluma", answersTo: 'ada', answersToName: 'Ada', phrase: 'zebra honey camel bagel tulip', lastSeenAt: 0 },
  { id: 'a-2', kind: 'agent', name: "Stand-in for a partner's Pluma", answersTo: 'ada', answersToName: 'Ada', test: true },
  { id: 'a-3', kind: 'agent', name: 'Old', answersTo: 'ada', retired: true },
]

describe('labels', () => {
  it('names every member with the person it answers to, and marks a test identity and a retired one', () => {
    expect(memberLabel(members, 'a-1')).toEqual({ name: "Ada's Pluma", note: 'answers to Ada' })
    expect(memberLabel(members, 'a-2')).toEqual({ name: "Stand-in for a partner's Pluma", note: 'test identity, answers to Ada' })
    expect(memberLabel(members, 'a-3')).toEqual({ name: 'Old', note: 'retired' })
    expect(memberLabel(members, 'host')).toEqual({ name: 'The host', note: '' })
    expect(memberLabel(members, 'a-gone')).toEqual({ name: 'a former member', note: '' })
  })

  it('says how long ago a member checked in', () => {
    const now = 10 * 3_600_000
    expect(seenAgo(now - 30_000, now)).toBe('seen just now')
    expect(seenAgo(now - 5 * 60_000, now)).toBe('seen 5 minutes ago')
    expect(seenAgo(now - 3 * 3_600_000, now)).toBe('seen 3 hours ago')
    expect(seenAgo(undefined, now)).toBe('not seen yet')
  })

  it('writes a line for each kind of event, with no em dash', () => {
    const m = { o1: 'Shared lines' }
    expect(eventLine({ seq: 2, type: 'objective.moved', by: 'a-1', at: 0, objective: 'o1', status: 'claimed' }, members, m)).toBe('moved "Shared lines" to claimed')
    expect(eventLine({ seq: 3, type: 'draft.version', by: 'a-1', at: 0, title: 'Headline', version: 2 }, members, m)).toBe('posted version 2 of the draft "Headline"')
    expect(eventLine({ seq: 4, type: 'decision', by: 'a-1', at: 0, verdict: 'approve', version: 1, owner: 'ada' }, members, m)).toBe("relayed Ada's decision: approve version 1")
    expect(eventLine({ seq: 5, type: 'member.joined', by: 'a-2', at: 0, member: 'a-2', phrase: 'a b c d e' }, members, m)).toBe('joined, safety phrase "a b c d e"')
    for (const t of ['decision', 'member.invited', 'member.retired', 'room.created']) expect(eventLine({ seq: 1, type: t, by: 'a-1', at: 0 }, members, m)).not.toMatch(/\u2014/)
  })

  it('reads a context post as one line: what came in, its size and why; a note; a retirement', () => {
    expect(eventLine({ seq: 6, type: 'context.add', by: 'a-1', at: 0, name: 'brief.pdf', size: 2_400_000, why: 'the brief we work from' }, members, {}))
      .toBe('brought "brief.pdf" (2.3 MB) into the library: the brief we work from')
    expect(eventLine({ seq: 7, type: 'context.note', by: 'a-1', at: 0, name: 'brief.pdf', text: 'page 3' }, members, {})).toBe('noted on "brief.pdf": page 3')
    expect(eventLine({ seq: 8, type: 'context.retire', by: 'a-1', at: 0, name: 'brief.pdf' }, members, {})).toBe('retired "brief.pdf" from the library')
  })

  it('says a size the way a person would', () => {
    expect(bytesLabel(70)).toBe('70 bytes')
    expect(bytesLabel(1536)).toBe('1.5 KB')
    expect(bytesLabel(2 * 1024 ** 3)).toBe('2 GB')
    expect(bytesLabel(3.25 * 1024 ** 4)).toBe('3.3 TB')
  })

  it('shows when the human said it, in plain words', () => {
    expect(saidAtLabel('2026-10-15T19:04:00.000Z', 'UTC')).toBe('Oct 15, 7:04 PM')
  })
})

describe('postedAtLabel', () => {
  const tz = 'America/New_York'
  const now = Date.parse('2026-10-17T15:30:00Z') // 11:30 AM in New York
  it('a post from today reads as the time alone', () => {
    expect(postedAtLabel(Date.parse('2026-10-17T15:05:00Z'), now, tz)).toBe('11:05 AM')
  })
  it('a post from yesterday says so', () => {
    expect(postedAtLabel(Date.parse('2026-10-16T20:12:00Z'), now, tz)).toBe('Yesterday, 4:12 PM')
  })
  it('an older post carries its date', () => {
    expect(postedAtLabel(Date.parse('2026-10-14T13:00:00Z'), now, tz)).toBe('Oct 14, 9:00 AM')
  })
  it('a missing time reads as nothing rather than a broken date', () => {
    expect(postedAtLabel(NaN, now, tz)).toBe('')
  })
})

describe('sideOf', () => {
  it("puts the reader's own Pluma on the right and everyone else on the left", () => {
    expect(sideOf(members, 'reader:ada', 'a-1')).toBe('right')
    expect(sideOf(members, 'reader:ben', 'a-1')).toBe('left')
  })
  it("a member's own view puts that member on the right", () => {
    expect(sideOf(members, 'a-1', 'a-1')).toBe('right')
    expect(sideOf(members, 'a-1', 'a-2')).toBe('left')
  })
  it('the host and former members are never on the right', () => {
    expect(sideOf(members, 'reader:ada', 'host')).toBe('left')
    expect(sideOf(members, 'reader:ada', 'a-gone')).toBe('left')
  })
})

describe('isChat', () => {
  it('messages, decisions and library additions are chat; bookkeeping is not', () => {
    for (const t of ['message', 'decision', 'context.add']) expect(isChat(t)).toBe(true)
    for (const t of ['member.joined', 'objective.moved', 'objective.created', 'room.created', 'context.note', 'context.retire']) expect(isChat(t)).toBe(false)
  })
})

describe('remaining', () => {
  const o = (id: string, title: string, owner: string, status: string) => ({ id, title, owner, done: 'd', status, updatedAt: 0 }) as never
  const v = (n: number, fp: string) => ({ n, text: 't', fingerprint: fp, by: 'a-1', at: 0 })
  it('lists what is not done, most stuck first, and says whose decision a draft waits on', () => {
    const objectives = [o('o1', 'The short', 'ada', 'waiting'), o('o2', 'Ben moments', 'ben', 'working'), o('o3', 'Ada moments', 'ada', 'done'), o('o4', 'Stuck', 'ben', 'blocked')]
    const drafts = [{ id: 'd1', title: 'The short', owner: 'ada', objective: 'o1', latest: 2, versions: [v(1, 'f1'), v(2, 'f2')], decisions: [{ id: 'x', draft: 'd1', version: 1, fingerprint: 'f1', verdict: 'changes', words: 'w', saidAt: '', by: 'a-1', at: 0 }] }] as never
    const r = remaining(objectives, drafts, members)
    expect(r.open.map((x) => x.title)).toEqual(['Stuck', 'The short', 'Ben moments'])
    expect(r.open[1].waitingOn).toBe('Ada’s decision on version 2 of "The short"')
    expect(r.open[0].waitingOn).toBeUndefined()
    expect(r.done.map((x) => x.title)).toEqual(['Ada moments'])
  })
  it('a draft whose latest version is approved waits on nobody', () => {
    const objectives = [o('o1', 'The short', 'ada', 'waiting')]
    const drafts = [{ id: 'd1', title: 'The short', owner: 'ada', objective: 'o1', latest: 1, versions: [v(1, 'f1')], decisions: [{ id: 'x', draft: 'd1', version: 1, fingerprint: 'f1', verdict: 'approve', words: 'w', saidAt: '', by: 'a-1', at: 0 }] }] as never
    expect(remaining(objectives, drafts, members).open[0].waitingOn).toBeUndefined()
  })
})
