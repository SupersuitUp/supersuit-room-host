import { describe, it, expect } from 'vitest'
import { memberLabel, seenAgo, eventLine } from './labels'
import type { Member } from './types'

const members: Member[] = [
  { id: 'p-ada', kind: 'person', person: 'ada', name: 'Ada' },
  { id: 'a-1', kind: 'agent', name: "Ada's Pluma", answersTo: 'ada', lastSeenAt: 0 },
  { id: 'a-2', kind: 'agent', name: 'Stand-in for a partner\'s Pluma', answersTo: 'ada', test: true },
]

describe('labels', () => {
  it('names every agent with the person it answers to, and marks a test identity', () => {
    expect(memberLabel(members, 'p-ada')).toEqual({ name: 'Ada', note: '' })
    expect(memberLabel(members, 'a-1')).toEqual({ name: "Ada's Pluma", note: 'answers to Ada' })
    expect(memberLabel(members, 'a-2')).toEqual({ name: "Stand-in for a partner's Pluma", note: 'test identity, answers to Ada' })
    expect(memberLabel(members, 'a-gone')).toEqual({ name: 'a former member', note: '' })
  })

  it('says how long ago an agent checked in', () => {
    const now = 10 * 3_600_000
    expect(seenAgo(now - 30_000, now)).toBe('seen just now')
    expect(seenAgo(now - 5 * 60_000, now)).toBe('seen 5 minutes ago')
    expect(seenAgo(now - 3 * 3_600_000, now)).toBe('seen 3 hours ago')
    expect(seenAgo(undefined, now)).toBe('not seen yet')
  })

  it('writes a line for each kind of event, with no em dash', () => {
    const line = eventLine({ seq: 2, type: 'objective.moved', by: 'a-1', at: 0, objective: 'o1', status: 'claimed' }, members, { o1: 'Shared lines' })
    expect(line).toBe('moved "Shared lines" to claimed')
    expect(eventLine({ seq: 3, type: 'draft.version', by: 'a-1', at: 0, title: 'Headline', version: 2 }, members, {})).toBe('posted version 2 of the draft "Headline"')
    expect(line).not.toMatch(/\u2014/)
  })
})
