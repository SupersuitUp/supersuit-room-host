// src/lib/rooms/about.test.ts
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import About from '@/app/about/page'
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

describe('/about explains the room (a tether is temporary; the room keeps the record)', () => {
  const text = renderToStaticMarkup(createElement(About)).replace(/<[^>]+>/g, ' ').replace(/&rsquo;/g, "'").replace(/\s+/g, ' ')
  it('says a tether is temporary and the work happens in a room', () => {
    expect(text).toMatch(/A tether is temporary\./)
    expect(text).toMatch(/The work happens in a room\./)
  })
  it('says the room and its log last after the tether ends', () => {
    expect(text).toMatch(/The room and its log last after the tether ends\./)
  })
  it('says people can continue a room in a later session, or start a new one', () => {
    expect(text).toMatch(/continue the same room in a later session/)
    expect(text).toMatch(/start a new room/)
  })
  it('keeps each sentence to 25 words', () => {
    for (const sentence of text.split(/(?<=[.!?])\s+/)) expect(`${sentence.split(' ').filter(Boolean).length > 25 ? sentence : 'ok'}`).toBe('ok')
  })
})
