// CRC32C (Castagnoli), as Cloud Storage writes it: base64 of the 4 big-endian bytes. Protocol v0.3, section 7.
import { describe, it, expect } from 'vitest'
import { crc32c, crc32cBase64, Crc32c } from './crc32c'

describe('crc32c', () => {
  it('pins the standard check value: "123456789" is 0xE3069283', () => {
    expect(crc32c(Buffer.from('123456789'))).toBe(0xe3069283)
  })
  it('is base64 of the big-endian bytes, as Cloud Storage reports it (empty input is AAAAAA==)', () => {
    expect(crc32cBase64(Buffer.from('123456789'))).toBe(Buffer.from([0xe3, 0x06, 0x92, 0x83]).toString('base64'))
    expect(crc32cBase64(Buffer.alloc(0))).toBe('AAAAAA==')
  })
  it('streams: pieces give the same value as the whole', () => {
    const b = Buffer.from('the quick brown fox jumps over the lazy dog, twice over')
    const c = new Crc32c()
    c.update(b.subarray(0, 7)); c.update(b.subarray(7, 30)); c.update(b.subarray(30))
    expect(c.base64()).toBe(crc32cBase64(b))
  })
})
