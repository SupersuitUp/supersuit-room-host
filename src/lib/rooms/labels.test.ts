import { describe, it, expect } from 'vitest'
import { memberLabel, seenAgo, eventLine, saidAtLabel, bytesLabel } from './labels'
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
