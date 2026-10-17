// CRC32C (Castagnoli, reflected polynomial 0x82F63B78), table-driven. Cloud Storage checks an
// upload against it, and reports an object's as base64 of the 4 big-endian bytes, which is the form
// Protocol v0.3 (section 7) signs.
const TABLE = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? (c >>> 1) ^ 0x82f63b78 : c >>> 1
    t[n] = c >>> 0
  }
  return t
})()

export class Crc32c {
  private c = 0xffffffff
  update(b: Uint8Array): this {
    let c = this.c
    for (let i = 0; i < b.length; i++) c = TABLE[(c ^ b[i]) & 0xff] ^ (c >>> 8)
    this.c = c
    return this
  }
  value(): number { return (this.c ^ 0xffffffff) >>> 0 }
  base64(): string { const b = Buffer.alloc(4); b.writeUInt32BE(this.value()); return b.toString('base64') }
}

export const crc32c = (b: Uint8Array) => new Crc32c().update(b).value()
export const crc32cBase64 = (b: Uint8Array) => new Crc32c().update(b).base64()
/** The shape Cloud Storage reports: 4 bytes, base64, with padding. */
export const CRC32C_B64 = /^[A-Za-z0-9+/]{6}==$/
