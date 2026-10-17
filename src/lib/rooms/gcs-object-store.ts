// The production object store: one private Cloud Storage bucket. Uniform access, public access
// prevented; the host's service account is its only writer, and readers get 15-minute signed addresses.
import type { Storage } from 'firebase-admin/storage'
import type { ObjectInfo, ObjectStore } from './object-store'

type Bucket = ReturnType<Storage['bucket']>
type Meta = { name?: string; size?: string | number; crc32c?: string; contentType?: string; timeCreated?: string }

const info = (path: string, m: Meta): ObjectInfo => ({
  path, size: Number(m.size), crc32c: String(m.crc32c ?? ''), contentType: String(m.contentType ?? ''), createdAt: Date.parse(String(m.timeCreated ?? '')) || 0,
})

const header = (h: unknown, name: string): string | undefined => {
  if (h && typeof (h as Headers).get === 'function') return (h as Headers).get(name) ?? undefined
  const o = h as Record<string, string | undefined> | undefined
  return o?.[name] ?? o?.[name.toLowerCase()]
}

export class GcsObjectStore implements ObjectStore {
  constructor(private bucket: Bucket) {}

  /**
   * Opens a JSON API resumable session. The object resource carries crc32c, and X-Upload-Content-Length
   * and X-Upload-Content-Type bind the size and type, so Cloud Storage refuses the final piece of any
   * other bytes. ifGenerationMatch=0 means a session can never overwrite an object that exists.
   */
  async createResumableSession(path: string, bind: { size: number; contentType: string; crc32c: string }) {
    const url = `https://storage.googleapis.com/upload/storage/v1/b/${encodeURIComponent(this.bucket.name)}/o?uploadType=resumable&ifGenerationMatch=0&name=${encodeURIComponent(path)}`
    const res = await this.bucket.storage.authClient.request({
      method: 'POST', url,
      headers: { 'content-type': 'application/json; charset=UTF-8', 'x-upload-content-type': bind.contentType, 'x-upload-content-length': String(bind.size) },
      data: { name: path, contentType: bind.contentType, crc32c: bind.crc32c },
    })
    const location = header(res.headers, 'location')
    if (!location) throw new Error('Cloud Storage opened no upload session')
    return location
  }

  async stat(path: string) {
    try {
      const [m] = await this.bucket.file(path).getMetadata()
      return info(path, m as Meta)
    } catch (e) {
      if ((e as { code?: number }).code === 404) return null
      throw e
    }
  }

  async signedReadUrl(path: string, ttlMs: number, opts: { filename?: string; inline?: boolean } = {}) {
    const name = (opts.filename ?? path.split('/').pop() ?? 'file').replace(/["\\\r\n]/g, '_')
    const [url] = await this.bucket.file(path).getSignedUrl({
      version: 'v4', action: 'read', expires: Date.now() + ttlMs,
      responseDisposition: `${opts.inline ? 'inline' : 'attachment'}; filename="${name}"; filename*=UTF-8''${encodeURIComponent(name)}`,
    })
    return url
  }

  async delete(path: string) { await this.bucket.file(path).delete({ ignoreNotFound: true }) }

  async list(prefix: string) {
    const [files] = await this.bucket.getFiles({ prefix, autoPaginate: true })
    return files.map((f) => info(f.name, f.metadata as Meta))
  }
}
