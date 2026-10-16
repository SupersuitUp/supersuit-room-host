import { describe, it, expect } from 'vitest'
import { imageInfo } from './images'
import { GIF_1x1, PNG_1x1, gif, jpeg, png, webpExtended, webpLossless, webpLossy } from './test-images'

describe('the host reads an image header, and only an image header', () => {
  it('reads the type and dimensions of png, jpeg, webp (all three kinds) and gif', () => {
    expect(imageInfo(PNG_1x1)).toEqual({ type: 'image/png', width: 1, height: 1 })
    expect(imageInfo(png(1200, 630))).toEqual({ type: 'image/png', width: 1200, height: 630 })
    expect(imageInfo(jpeg(640, 480))).toEqual({ type: 'image/jpeg', width: 640, height: 480 })
    expect(imageInfo(webpLossy(300, 200))).toEqual({ type: 'image/webp', width: 300, height: 200 })
    expect(imageInfo(webpLossless(301, 201))).toEqual({ type: 'image/webp', width: 301, height: 201 })
    expect(imageInfo(webpExtended(4000, 3000))).toEqual({ type: 'image/webp', width: 4000, height: 3000 })
    expect(imageInfo(GIF_1x1)).toEqual({ type: 'image/gif', width: 1, height: 1 })
    expect(imageInfo(gif(17, 9))).toEqual({ type: 'image/gif', width: 17, height: 9 })
  })

  it('anything it cannot verify is null: svg, html, truncated headers, zero dimensions', () => {
    expect(imageInfo(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'))).toBeNull()
    expect(imageInfo(Buffer.from('<html><script>alert(1)</script></html>'))).toBeNull()
    expect(imageInfo(png(10, 10).subarray(0, 20))).toBeNull()
    expect(imageInfo(jpeg(10, 10).subarray(0, 12))).toBeNull()
    expect(imageInfo(png(0, 10))).toBeNull()
    expect(imageInfo(Buffer.alloc(0))).toBeNull()
  })
})

describe('the picture the dev room and the live check post', () => {
  it('is a real png the host reads at its size', async () => {
    const { picturePng } = await import('./test-images')
    expect(imageInfo(picturePng(640, 360))).toEqual({ type: 'image/png', width: 640, height: 360 })
  })
})
