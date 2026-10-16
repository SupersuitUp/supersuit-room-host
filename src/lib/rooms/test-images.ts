import { crc32, deflateSync } from 'node:zlib'

// Small, real image bytes for tests: each is a header a host can read dimensions from, built here
// so no binary fixture has to live in the repository.
const u32be = (n: number) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255]
const u16le = (n: number) => [n & 255, (n >>> 8) & 255]
const u24le = (n: number) => [n & 255, (n >>> 8) & 255, (n >>> 16) & 255]

/** A complete 1x1 PNG, decodable by any viewer. */
export const PNG_1x1 = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64')
/** A complete 1x1 GIF. */
export const GIF_1x1 = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64')

export function png(width: number, height: number, padTo = 0): Buffer {
  const head = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, ...u32be(width), ...u32be(height), 8, 6, 0, 0, 0, 0, 0, 0, 0])
  return padTo > head.length ? Buffer.concat([head, Buffer.alloc(padTo - head.length)]) : head
}

export function jpeg(width: number, height: number): Buffer {
  // SOI, an APP0 segment to skip, then SOF0 carrying height and width, then EOI.
  return Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0,
    0xff, 0xc0, 0, 17, 8, (height >> 8) & 255, height & 255, (width >> 8) & 255, width & 255, 3, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1, 0xff, 0xd9])
}

export function webpLossy(width: number, height: number): Buffer {
  const vp8 = [0x56, 0x50, 0x38, 0x20, ...u32be(0).reverse(), 0, 0, 0, 0x9d, 0x01, 0x2a, ...u16le(width), ...u16le(height)]
  return Buffer.from([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50, ...vp8, 0, 0])
}

export function webpExtended(width: number, height: number): Buffer {
  return Buffer.from([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50, 0x56, 0x50, 0x38, 0x58, 10, 0, 0, 0, 0, 0, 0, 0, ...u24le(width - 1), ...u24le(height - 1)])
}

export function webpLossless(width: number, height: number): Buffer {
  const bits = ((width - 1) & 0x3fff) | (((height - 1) & 0x3fff) << 14)
  return Buffer.from([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50, 0x56, 0x50, 0x38, 0x4c, 5, 0, 0, 0, 0x2f, bits & 255, (bits >>> 8) & 255, (bits >>> 16) & 255, (bits >>> 24) & 255])
}

export function gif(width: number, height: number): Buffer {
  return Buffer.from([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, ...u16le(width), ...u16le(height), 0, 0, 0, 0x3b])
}

/** A real, decodable PNG of the given size: a two-colour diagonal, for the dev room and live checks. */
export function picturePng(width: number, height: number, a: [number, number, number] = [196, 154, 92], b: [number, number, number] = [24, 28, 36]): Buffer {
  const rows: Buffer[] = []
  for (let y = 0; y < height; y++) {
    const row = Buffer.alloc(1 + width * 3)
    for (let x = 0; x < width; x++) row.set(x / width + y / height < 1 ? a : b, 1 + x * 3)
    rows.push(row)
  }
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length)
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body) >>> 0)
    return Buffer.concat([len, body, crc])
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4); ihdr[8] = 8; ihdr[9] = 2
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(Buffer.concat(rows))), chunk('IEND', Buffer.alloc(0))])
}
