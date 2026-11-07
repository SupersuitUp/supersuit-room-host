// src/lib/tether-log/time.test.ts
import { describe, it, expect } from 'vitest'
import { dayName, rel } from './time.ts'

const NOW = Date.parse('2026-11-07T20:00:00.000Z')
const min = 60_000

describe('rel', () => {
  it('says the time as the prototype says it', () => {
    expect(rel(NOW - 20_000, NOW)).toBe('just now')
    expect(rel(NOW - min, NOW)).toBe('1 min ago')
    expect(rel(NOW - 10 * min, NOW)).toBe('10 mins ago')
    expect(rel(NOW - 60 * min, NOW)).toBe('1 hour ago')
    expect(rel(NOW - 3 * 60 * min, NOW)).toBe('3 hours ago')
    expect(rel(NOW - 30 * 60 * min, NOW)).toMatch(/yesterday|days ago/)
  })
})
describe('dayName', () => {
  it('names today', () => { expect(dayName(NOW, NOW)).toBe('Today') })
})
