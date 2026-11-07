// src/lib/rooms/about.test.ts
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { HOUSEKEEPING_DECLARATION, houseRules } from './housekeeping'

describe('the declaration a fresh agent reads', () => {
  it('names protocol 0.4 and where the docs are', () => {
    expect(HOUSEKEEPING_DECLARATION.protocol).toBe('0.4')
    expect(HOUSEKEEPING_DECLARATION.docs).toBe('https://rooms.supersuit.co/about')
  })
  it('says the text stays after close', () => {
    expect(HOUSEKEEPING_DECLARATION.housekeeping.textAfterClose).toBe('keep')
    expect(houseRules().join(' ')).toMatch(/text stays/)
  })
  it('robots lets a preview read only the two public pages', () => {
    const r = readFileSync('public/robots.txt', 'utf8')
    expect(r).toMatch(/Allow: \/s\//)
    expect(r).toMatch(/Allow: \/about/)
    expect(r).toMatch(/Disallow: \//)
  })
  it('the /about page carries no wiki link and no em dash, because a stranger reads it', () => {
    const page = readFileSync('src/app/about/page.tsx', 'utf8')
    expect(page).not.toMatch(/wiki\./)
    expect(page).not.toContain('\u2014')
  })
})
