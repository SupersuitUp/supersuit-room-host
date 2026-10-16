import { describe, it, expect } from 'vitest'
import { generateKeyPairSync, sign } from 'node:crypto'
import { canonical, fingerprint, safetyPhrase, verifySigned, WORDS, publicKeyB64 } from './signing'

// The protocol's test vector (PROTOCOL.md, appendix A). Any implementation must reproduce it.
// Private key: the Ed25519 seed of 32 bytes of 0x07.
const VECTOR = {
  publicKey: '6kpsY-KcUgq-9VB7Ey7F-ZVHdq6-vnuSQh7qaRRG0iw',
  fingerprint: 'fe812c12f3ab4ce6ac5db69ac352f906cb1b11ef43fb33e252ef7ff552263889',
  phrase: 'zebra honey camel bagel tulip',
  post: { v: 1, type: 'message', room: 'r1', member: 'a-1', text: 'hello', at: '2026-10-15T12:00:00.000Z', nonce: 'AAAAAAAAAAAAAAAAAAAAAA' },
  canonical: '{"at":"2026-10-15T12:00:00.000Z","member":"a-1","nonce":"AAAAAAAAAAAAAAAAAAAAAA","room":"r1","text":"hello","type":"message","v":1}',
  sig: 'GO5C9_izYZkOh439FPhpiGgWtrivIHn_fB1dryBoeuktFX2ZEuZvmTSO6DJ6bv6olyIGr3L2sGxZcwwdhMsxAw',
}

describe('signing', () => {
  it('canonical JSON sorts keys at every depth and drops undefined', () => {
    expect(canonical({ b: 1, a: { d: [3, { z: 1, y: 2 }], c: 'x' }, u: undefined })).toBe('{"a":{"c":"x","d":[3,{"y":2,"z":1}]},"b":1}')
  })

  it('has 256 distinct words', () => {
    expect(WORDS.length).toBe(256)
    expect(new Set(WORDS).size).toBe(256)
  })

  it('reproduces the protocol vector exactly: fingerprint, phrase, canonical bytes, signature', () => {
    expect(fingerprint(VECTOR.publicKey)).toBe(VECTOR.fingerprint)
    expect(safetyPhrase(VECTOR.fingerprint)).toBe(VECTOR.phrase)
    expect(canonical(VECTOR.post)).toBe(VECTOR.canonical)
    expect(verifySigned(VECTOR.publicKey, VECTOR.post, VECTOR.sig)).toBe(true)
  })

  it('verifies a post signed by the matching key and refuses any change', () => {
    const { publicKey, privateKey } = generateKeyPairSync('ed25519')
    const pub = publicKeyB64(publicKey)
    const post = { v: 1, room: 'r1', member: 'a-1', type: 'message', text: 'hi', at: '2026-10-15T00:00:00.000Z', nonce: 'n1' }
    const sig = sign(null, Buffer.from(canonical(post)), privateKey).toString('base64url')
    expect(verifySigned(pub, post, sig)).toBe(true)
    expect(verifySigned(pub, { ...post, text: 'hj' }, sig)).toBe(false)
    expect(verifySigned(pub, post, 'not-a-signature')).toBe(false)
    expect(verifySigned('garbage', post, sig)).toBe(false)
  })
})
