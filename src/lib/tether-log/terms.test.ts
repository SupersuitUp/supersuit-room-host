// src/lib/tether-log/terms.test.ts
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { COPY, DEFINED_WORD, TERMS } from './terms.ts'

const DIR = join(process.cwd(), 'src/lib/tether-log')
const code = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\s)\/\/.*$/gm, '')

describe('every defined word goes through TERMS', () => {
  it('each term links to its exact wiki page', () => {
    for (const t of Object.values(TERMS)) expect(t.url).toMatch(/^https:\/\/wiki\.supersuit\.co\/concepts\/[a-z-]+$/)
    for (const t of Object.values(TERMS)) expect(t.gloss.length).toBeGreaterThan(10)
  })
  it('no string in COPY draws a defined word by hand', () => {
    for (const [name, parts] of Object.entries(COPY)) {
      for (const p of parts) if (typeof p === 'string') expect(`${name}: ${DEFINED_WORD.test(p) ? p : ''}`).toBe(`${name}: `)
    }
  })
  it('no file in the folder but terms.ts holds a defined word in its text', () => {
    for (const f of readdirSync(DIR).filter((n) => /\.tsx?$/.test(n) && !/\.test\./.test(n) && n !== 'terms.ts' && n !== 'story-fixture.ts')) {
      const quoted = code(readFileSync(join(DIR, f), 'utf8')).match(/(['"`>])[^'"`<>\n]*\1?/g) ?? []
      const hits = quoted.filter((q) => /\b(Plumas?|supersessions?|superprojects?|Helm)\b/.test(q) || /\btether(s| log)?\b/i.test(q.replace(/tether-log|tetherLog/g, '')))
      expect(`${f}: ${hits.join(' | ')}`).toBe(`${f}: `)
    }
  })
})

describe('the folder stands alone', () => {
  it('imports nothing from next, from @/ or from node:', () => {
    for (const f of readdirSync(DIR).filter((n) => /\.tsx?$/.test(n) && !/\.test\./.test(n))) {
      const src = readFileSync(join(DIR, f), 'utf8')
      expect(`${f}: ${/from '(next|@\/|node:)/.test(src)}`).toBe(`${f}: false`)
    }
  })
})

describe('the words read plainly (Simplified Technical English)', () => {
  const glossed = (parts: readonly (string | { term: keyof typeof TERMS; plural?: boolean })[]) =>
    parts.map((p) => (typeof p === 'string' ? p : `${(p.plural ? TERMS[p.term].plural : TERMS[p.term].label)} (${TERMS[p.term].gloss})`)).join('')
  it('each sentence in COPY has at most 25 words, even with each word defined as a shared page defines it', () => {
    for (const [name, parts] of Object.entries(COPY)) {
      for (const sentence of glossed(parts).split(/(?<=[.!?])\s+/)) {
        const n = sentence.split(/\s+/).filter(Boolean).length
        expect(`${name}: ${n > 25 ? sentence : 'ok'}`).toBe(`${name}: ok`)
      }
    }
  })
  it('never says "operator", a word this page does not define', () => {
    for (const [name, parts] of Object.entries(COPY)) expect(`${name}: ${/\boperators?\b/i.test(glossed(parts))}`).toBe(`${name}: false`)
  })
})
