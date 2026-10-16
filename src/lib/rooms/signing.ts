// Signing, as Supersuit Room Protocol v0.1 defines it (PROTOCOL.md, section 2 and appendix A).
// A member key is Ed25519. Its public half travels as base64url of the 32 raw bytes. A post is
// signed over its canonical JSON. The safety phrase is five words picked by the first five bytes
// of the key's fingerprint. Every implementation must reproduce appendix A's vector exactly.
import { createHash, createPublicKey, verify, type KeyObject } from 'node:crypto'

/** JSON with object keys sorted at every depth, no whitespace, undefined fields dropped. */
export function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return '[' + value.map((v) => (v === undefined ? 'null' : canonical(v))).join(',') + ']'
  const obj = value as Record<string, unknown>
  return '{' + Object.keys(obj).filter((k) => obj[k] !== undefined).sort().map((k) => JSON.stringify(k) + ':' + canonical(obj[k])).join(',') + '}'
}

/** The 32 raw bytes of an Ed25519 public key, as base64url. */
export function publicKeyB64(key: KeyObject): string {
  return key.export({ format: 'jwk' }).x as string
}

/** Lowercase hex SHA-256 of the raw public key bytes. */
export function fingerprint(publicKey: string): string {
  return createHash('sha256').update(Buffer.from(publicKey, 'base64url')).digest('hex')
}

export function isPublicKey(publicKey: unknown): publicKey is string {
  return typeof publicKey === 'string' && /^[A-Za-z0-9_-]{43}$/.test(publicKey) && Buffer.from(publicKey, 'base64url').length === 32
}

/** Five words, one per byte of the fingerprint's first five bytes. Humans compare it out of band. */
export function safetyPhrase(fp: string): string {
  return [0, 1, 2, 3, 4].map((i) => WORDS[parseInt(fp.slice(i * 2, i * 2 + 2), 16)]).join(' ')
}

/** True only when sig is a valid Ed25519 signature by publicKey over canonical(payload). Never throws. */
export function verifySigned(publicKey: string, payload: unknown, sig: unknown): boolean {
  try {
    if (!isPublicKey(publicKey) || typeof sig !== 'string') return false
    const key = createPublicKey({ key: { kty: 'OKP', crv: 'Ed25519', x: publicKey }, format: 'jwk' })
    return verify(null, Buffer.from(canonical(payload)), key, Buffer.from(sig, 'base64url'))
  } catch { return false }
}

// 256 short, distinct, easy-to-say words. Index = byte value. Fixed by the protocol: never reorder.
export const WORDS = [
  'acorn', 'actor', 'agent', 'alarm', 'album', 'alley', 'amber', 'angle', 'ankle', 'apple', 'apron', 'arena', 'arrow', 'atlas', 'attic', 'award',
  'bacon', 'badge', 'bagel', 'baker', 'banjo', 'barn', 'basin', 'beach', 'beard', 'bench', 'berry', 'bison', 'blade', 'blank', 'bloom', 'board',
  'bonus', 'boot', 'brain', 'brass', 'bread', 'brick', 'bride', 'brook', 'brush', 'bunny', 'cabin', 'cable', 'camel', 'candy', 'canoe', 'cargo',
  'carol', 'cedar', 'chair', 'chalk', 'charm', 'chess', 'chief', 'cider', 'cliff', 'clock', 'cloud', 'clown', 'coast', 'cobra', 'comet', 'coral',
  'couch', 'crane', 'crown', 'cube', 'curry', 'daisy', 'dance', 'delta', 'denim', 'depot', 'diary', 'disco', 'dodge', 'dove', 'dozen', 'drama',
  'dream', 'drum', 'eagle', 'earth', 'easel', 'echo', 'elbow', 'elder', 'ember', 'emu', 'epoch', 'fable', 'fairy', 'feast', 'fern', 'ferry',
  'fiber', 'field', 'flame', 'flask', 'fleet', 'flint', 'flute', 'focus', 'forge', 'fox', 'frost', 'fudge', 'gecko', 'genie', 'ghost', 'giant',
  'ginger', 'glass', 'globe', 'glove', 'goose', 'grape', 'gravy', 'gull', 'habit', 'harbor', 'harp', 'hazel', 'heart', 'hedge', 'helix', 'heron',
  'hippo', 'honey', 'hotel', 'house', 'igloo', 'image', 'index', 'iris', 'ivory', 'jacket', 'jaguar', 'jelly', 'jewel', 'joker', 'judge', 'juice',
  'kayak', 'kettle', 'kiosk', 'kite', 'koala', 'label', 'ladder', 'lagoon', 'lake', 'lamp', 'laser', 'lemon', 'level', 'lilac', 'linen', 'lion',
  'llama', 'lobby', 'lotus', 'lunar', 'magic', 'mango', 'maple', 'marble', 'medal', 'melon', 'meteor', 'mint', 'mirror', 'mocha', 'moose', 'motor',
  'nectar', 'needle', 'nest', 'noble', 'noodle', 'north', 'novel', 'nutmeg', 'oasis', 'ocean', 'olive', 'onion', 'opera', 'orbit', 'otter', 'owl',
  'paddle', 'panda', 'paper', 'parade', 'pearl', 'pecan', 'pepper', 'piano', 'pilot', 'pixel', 'plaza', 'plum', 'polar', 'pony', 'poppy', 'prism',
  'puzzle', 'quail', 'quartz', 'quill', 'rabbit', 'radar', 'raven', 'reef', 'ribbon', 'river', 'robin', 'rocket', 'rose', 'ruby', 'saddle', 'salmon',
  'scarf', 'shell', 'silk', 'sketch', 'sloth', 'solar', 'spark', 'spice', 'spoon', 'stamp', 'storm', 'sugar', 'swan', 'table', 'tango', 'tiger',
  'toast', 'topaz', 'torch', 'tulip', 'tundra', 'turtle', 'umbra', 'valley', 'velvet', 'violin', 'walnut', 'whale', 'willow', 'yacht', 'zebra', 'zenith',
] as const
