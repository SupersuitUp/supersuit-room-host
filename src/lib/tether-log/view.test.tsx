// src/lib/tether-log/view.test.tsx
// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { layout } from './layout.ts'
import { tetherLog } from './model.ts'
import { storyFixture } from './story-fixture.ts'
import { TetherLogView } from './view.tsx'
import { readFileSync } from 'node:fs'

const model = tetherLog(storyFixture)
const member = renderToStaticMarkup(<TetherLogView model={model} mode="member" checkedBy="host" />)
const shared = renderToStaticMarkup(<TetherLogView model={model} mode="shared" checkedBy="host" aboutHref="https://rooms.supersuit.co/about" />)

describe('layout', () => {
  it('breaks the book at each stamp, and the intent still reads forward from the top', () => {
    const b = layout(model.entries, 'one two three four')
    expect(b.map((x) => x.kind)).toEqual(['run', 'stamp', 'run'])
    const clauses = b.flatMap((x) => (x.kind === 'run' ? [x.clause] : []))
    expect(clauses.join(' ')).toBe('one two three four')
  })
})

describe('the order on a phone', () => {
  it('runs name, intent, standing, actions, settled, story, entries', () => {
    const at = (s: string) => member.indexOf(s)
    const order = [at('Tethered supersession'), at(model.intent.slice(0, 20)), at('Waiting on Ben'), at('Check signatures'), at('Settled'), at('The story so far'), at('id="tl-e7"')]
    expect(order).toEqual([...order].sort((a, b) => a - b))
    expect(order.every((n) => n >= 0)).toBe(true)
  })
})

describe('a stamp', () => {
  it('is violet only for a person\'s words, and names who carried them', () => {
    expect(member).toContain('Invite tree only')
    expect(member).toContain('Carried by Ada&#x27;s Pluma')
    const css = readFileSync('src/lib/tether-log/tether-log.css', 'utf8')
    // Each rule whose body uses the violet ink, read rule by rule because a rule can span lines.
    const violet = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].filter((r) => r[2].includes('var(--violet')).map((r) => r[1].trim())
    expect(violet.length).toBeGreaterThan(3)
    for (const sel of violet) expect(sel).toMatch(/tl-(said|plate|seal|words|list|two|key)/)
  })
  it('shows what was rejected and the reason, and says so when there is no reason', () => {
    expect(member).toContain('Anyone with a handle')
    expect(member).toContain('Fewer strangers.')
    const none = tetherLog({ ...storyFixture, events: storyFixture.events.map((e) => (e.seq === 10 ? { ...e, reason: undefined } : e)) })
    expect(renderToStaticMarkup(<TetherLogView model={none} mode="member" checkedBy="host" />)).toContain('No reason on record.')
  })
})

describe('a member\'s page explains itself', () => {
  it('puts an ⓘ on the first use of each defined word, to its exact page', () => {
    expect(member).toContain('href="https://wiki.supersuit.co/concepts/tethered-supersession"')
    expect(member).toContain('href="https://wiki.supersuit.co/concepts/pluma"')
    expect((member.match(/concepts\/pluma"/g) ?? []).length).toBe(1)
  })
  it('names the standard at its foot', () => {
    expect(member).toContain('https://hypercontext.wiki/standards/tether-log/v1')
  })
  it('says who checked', () => {
    expect(member).toContain('Checked by the host, which holds public keys only.')
    expect(renderToStaticMarkup(<TetherLogView model={model} mode="member" checkedBy="mac" />)).toContain('Checked on your computer.')
  })
})

describe('a shared page', () => {
  it('holds no wiki link, and defines each word in its own sentence', () => {
    expect(shared).not.toContain('wiki.supersuit.co')
    expect(shared).not.toContain('hypercontext.wiki')
    expect(shared).toContain('https://rooms.supersuit.co/about')
    expect(shared).toContain('an AI agent that works for one person')
  })
  it('leaves out the conversation and the sharing action', () => {
    expect(shared).not.toContain('Open full conversation')
    expect(shared).not.toContain('Share a read-only page')
    expect(shared).not.toContain('Reading the server change now.')
  })
})

describe('a failed signature', () => {
  it('shows a broken mark on the entry and says so at the top of the check', () => {
    const bad = tetherLog({ ...storyFixture, checks: { ...storyFixture.checks, 6: 'failed' } })
    const html = renderToStaticMarkup(<TetherLogView model={bad} mode="member" checkedBy="host" />)
    expect(html).toContain('1 post failed its check')
    expect(html).toContain('tl-failed')
  })
})
