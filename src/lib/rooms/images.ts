// Reading an attachment's header (Protocol v0.2, section 6). The host verifies the bytes ARE the
// image type they claim and reads the dimensions from the header. It decodes nothing else, changes
// nothing, and refuses whatever it cannot verify: an SVG, an HTML page, a truncated header.
export const ATTACHMENT_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'] as const
export type AttachmentType = (typeof ATTACHMENT_TYPES)[number]
export type ImageInfo = { type: AttachmentType; width: number; height: number }

const at = (b: Uint8Array, i: number, bytes: number[]) => bytes.every((x, k) => b[i + k] === x)
const be16 = (b: Uint8Array, i: number) => (b[i] << 8) | b[i + 1]
const be32 = (b: Uint8Array, i: number) => ((b[i] << 24) >>> 0) + (b[i + 1] << 16) + (b[i + 2] << 8) + b[i + 3]
const le16 = (b: Uint8Array, i: number) => b[i] | (b[i + 1] << 8)
const le24 = (b: Uint8Array, i: number) => b[i] | (b[i + 1] << 8) | (b[i + 2] << 16)

function png(b: Uint8Array): ImageInfo | null {
  if (b.length < 24 || !at(b, 0, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]) || !at(b, 12, [0x49, 0x48, 0x44, 0x52])) return null
  return { type: 'image/png', width: be32(b, 16), height: be32(b, 20) }
}

function gif(b: Uint8Array): ImageInfo | null {
  if (b.length < 10 || !(at(b, 0, [0x47, 0x49, 0x46, 0x38, 0x37, 0x61]) || at(b, 0, [0x47, 0x49, 0x46, 0x38, 0x39, 0x61]))) return null
  return { type: 'image/gif', width: le16(b, 6), height: le16(b, 8) }
}

function webp(b: Uint8Array): ImageInfo | null {
  if (b.length < 25 || !at(b, 0, [0x52, 0x49, 0x46, 0x46]) || !at(b, 8, [0x57, 0x45, 0x42, 0x50])) return null
  if (b.length >= 30 && at(b, 12, [0x56, 0x50, 0x38, 0x20]) && at(b, 23, [0x9d, 0x01, 0x2a])) {
    return { type: 'image/webp', width: le16(b, 26) & 0x3fff, height: le16(b, 28) & 0x3fff }
  }
  if (at(b, 12, [0x56, 0x50, 0x38, 0x4c]) && b[20] === 0x2f) {
    const bits = (b[21] | (b[22] << 8) | (b[23] << 16) | (b[24] << 24)) >>> 0
    return { type: 'image/webp', width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1 }
  }
  if (b.length >= 30 && at(b, 12, [0x56, 0x50, 0x38, 0x58])) return { type: 'image/webp', width: le24(b, 24) + 1, height: le24(b, 27) + 1 }
  return null
}

function jpeg(b: Uint8Array): ImageInfo | null {
  if (b.length < 4 || b[0] !== 0xff || b[1] !== 0xd8) return null
  let i = 2
  while (i + 4 <= b.length) {
    if (b[i] !== 0xff) return null
    const marker = b[i + 1]
    if (marker === 0xff) { i += 1; continue }
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { i += 2; continue }
    if (marker === 0xd9 || marker === 0xda) return null
    const len = be16(b, i + 2)
    if (len < 2) return null
    const sof = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc
    if (sof) {
      if (i + 9 > b.length) return null
      return { type: 'image/jpeg', height: be16(b, i + 5), width: be16(b, i + 7) }
    }
    i += 2 + len
  }
  return null
}

/** The image type and dimensions the header declares, or null when the bytes are not one we can verify. */
export function imageInfo(bytes: Uint8Array): ImageInfo | null {
  const info = png(bytes) ?? gif(bytes) ?? webp(bytes) ?? jpeg(bytes)
  return info && info.width > 0 && info.height > 0 ? info : null
}
