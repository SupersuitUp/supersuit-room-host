// src/lib/tether-log/view.test.tsx
// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { layout } from './layout.ts'
import { tetherLog } from './model.ts'
import { storyFixture, sittingsFixture } from './story-fixture.ts'
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
  it('runs Room, the room\'s name, intent, standing, actions, settled, story, entries', () => {
    const at = (s: string) => member.indexOf(s)
    const order = [at('>Room<'), at(model.name), at(model.intent.slice(0, 20)), at('Waiting on Ben'), at('Check signatures'), at('Settled'), at('The story so far'), at('id="tl-e7"')]
    expect(order).toEqual([...order].sort((a, b) => a - b))
    expect(order.every((n) => n >= 0)).toBe(true)
  })
})

describe('a stamp', () => {
  it('is violet only for a person\'s words, and names who carried them', () => {
    expect(member).toContain('Tomatoes and basil')
    expect(member).toContain('Carried by Ada&#x27;s Pluma')
    const css = readFileSync('src/lib/tether-log/tether-log.css', 'utf8')
    // Each rule whose body uses the violet ink, read rule by rule because a rule can span lines.
    const violet = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].filter((r) => r[2].includes('var(--violet')).map((r) => r[1].trim())
    expect(violet.length).toBeGreaterThan(3)
    for (const sel of violet) expect(sel).toMatch(/tl-(said|plate|seal|words|list|two|key)/)
  })
  it('shows what was rejected and the reason, and says so when there is no reason', () => {
    expect(member).toContain('Squash and beans')
    expect(member).toContain('They fit the bed.')
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
    expect(shared).not.toContain('Looking at the watering days now.')
  })
})

describe('what the screenshots showed (2026-11-07)', () => {
  it('a said entry keeps what its Pluma did under the person\'s words', () => {
    expect(member).toContain('Ben asked about the split.')
  })
  it('says "No reason on record." only when something was rejected', () => {
    const plain = tetherLog({ ...storyFixture, events: storyFixture.events.map((e) => (e.seq === 10 ? { ...e, reason: undefined, rejected: undefined } : e)) })
    expect(renderToStaticMarkup(<TetherLogView model={plain} mode="member" checkedBy="host" />)).not.toContain('No reason on record.')
  })
  it('names one day when the log spans one day', () => {
    const oneDay = { ...model, to: model.from + 60_000 }
    expect(renderToStaticMarkup(<TetherLogView model={oneDay} mode="member" checkedBy="host" />)).not.toMatch(/Nov \d+ to Nov/)
  })
  it('a shared page keeps the bar short and defines the name in the lead', () => {
    const bar = shared.slice(shared.indexOf('tl-bar'), shared.indexOf('</div>', shared.indexOf('tl-bar')))
    expect(bar).not.toContain('(')
    expect(shared).toContain('tethered supersession (two conversations connected')
  })
})

describe('the stylesheet', () => {
  it('keeps the prototype\'s weight on element rules, so a class such as .tl-act always wins', () => {
    const css = readFileSync('src/lib/tether-log/tether-log.css', 'utf8')
    const heavy = css.split(/[{}]/).filter((_, i) => i % 2 === 0).flatMap((sel) => sel.split(',')).map((x) => x.trim()).filter((x) => /^\.tl\s+(button|a|h1|h2|h3|p|dialog)\b/.test(x))
    expect(heavy).toEqual([])
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

describe('a room keeps the record; a tether is temporary', () => {
  const sit = tetherLog(sittingsFixture)
  const html = renderToStaticMarkup(<TetherLogView model={sit} mode="member" checkedBy="host" />)
  const sharedSit = renderToStaticMarkup(<TetherLogView model={sit} mode="shared" checkedBy="host" aboutHref="https://rooms.supersuit.co/about" />)
  it('the room\'s name is the large title, under a "Room" label with its ⓘ', () => {
    expect(html).toMatch(/<h1 class="tl-intent">The shared garden plot<\/h1>/)
    expect(html).toMatch(/<b><span>Room<a class="tl-i" href="https:\/\/wiki\.supersuit\.co\/concepts\/tethered-supersession"/)
  })
  it('counts the tethered supersessions', () => {
    // The defined word is its own element (it carries an ⓘ), so the count is read as text.
    const text = (h: string) => h.replace(/<[^>]+>/g, '')
    expect(text(html)).toContain('2 tethered supersessions')
    expect(text(renderToStaticMarkup(<TetherLogView model={{ ...sit, sittings: sit.sittings.slice(0, 1) }} mode="member" checkedBy="host" />))).toMatch(/1 tethered supersession(?!s)/)
  })
  it('marks where each one started and ended, between the entries, on a member\'s page and a shared page', () => {
    for (const page of [html, sharedSit]) {
      expect(page).toContain('Ada&#x27;s Pluma tethered: Planning the plot')
      expect(page).toContain('Ada&#x27;s Pluma ended: Planning the plot')
      expect(page).toContain('Ben&#x27;s Pluma tethered: Watering days')
    }
    expect(html.indexOf('ended: Planning the plot')).toBeLessThan(html.indexOf('id="tl-e7"'))
  })
  it('How to read this page says a tether is temporary and the room keeps the record', () => {
    expect(html).toMatch(/is temporary\./)
    expect(html).toContain('keeps the record')
  })
})
