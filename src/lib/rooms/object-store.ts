// The object-store port (Protocol v0.3, section 7). Context bytes never pass through the host's own
// request body: the host opens a resumable upload session bound to a size, a content type and a
// crc32c, the member sends the bytes straight to the store, and the store itself refuses any other
// bytes as the last piece lands. The service is written against this port; tests use the memory
// fake below, production uses Cloud Storage (gcs-object-store.ts).
import { crc32cBase64 } from './crc32c'

export type ObjectInfo = { path: string; size: number; crc32c: string; contentType: string; createdAt: number }

export interface ObjectStore {
  /** A resumable upload session for exactly these bytes, as an address the member PUTs pieces to. Never overwrites an object. */
  createResumableSession(path: string, bind: { size: number; contentType: string; crc32c: string }): Promise<string>
  stat(path: string): Promise<ObjectInfo | null>
  /** A signed address that reads one object, valid for ttlMs. */
  signedReadUrl(path: string, ttlMs: number, opts?: { filename?: string; inline?: boolean }): Promise<string>
  delete(path: string): Promise<void>
  list(prefix: string): Promise<ObjectInfo[]>
}

/** Where a room's context bytes live in the object store: under the room, named by sha256. */
export const contextPath = (roomId: string, sha256: string) => `rooms/${roomId}/context/${sha256}`
export const contextPrefix = (roomId: string) => `rooms/${roomId}/context/`

type Session = { path: string; size: number; contentType: string; crc32c: string }

/**
 * The test store. `finish(uploadUrl, bytes)` stands in for the member's PUTs, and refuses what Cloud
 * Storage refuses: bytes of another size or another crc32c than the session was bound to, and an
 * object that already exists.
 */
export class MemoryObjectStore implements ObjectStore {
  objects = new Map<string, ObjectInfo & { bytes: Buffer }>()
  sessions = new Map<string, Session>()
  now: () => number = () => Date.now()
  private n = 0

  async createResumableSession(path: string, bind: { size: number; contentType: string; crc32c: string }) {
    const url = `memory://upload/${++this.n}`
    this.sessions.set(url, { path, ...bind })
    return url
  }

  /** Test helper: the whole upload, as the store would judge it. Throws on a mismatch. */
  async finish(url: string, bytes: Uint8Array) {
    const s = this.sessions.get(url)
    if (!s) throw new Error('no such upload session')
    if (bytes.length !== s.size) throw new Error('the store refused the bytes: wrong size')
    if (crc32cBase64(bytes) !== s.crc32c) throw new Error('the store refused the bytes: crc32c mismatch')
    if (this.objects.has(s.path)) throw new Error('the store refused the bytes: the object exists')
    this.objects.set(s.path, { path: s.path, size: bytes.length, crc32c: s.crc32c, contentType: s.contentType, createdAt: this.now(), bytes: Buffer.from(bytes) })
    this.sessions.delete(url)
  }

  /** Test helper: an object put straight in, bypassing a session (as a forger with store access would). */
  put(path: string, bytes: Uint8Array, contentType = 'application/octet-stream', createdAt = this.now()) {
    this.objects.set(path, { path, size: bytes.length, crc32c: crc32cBase64(bytes), contentType, createdAt, bytes: Buffer.from(bytes) })
  }

  async stat(path: string) {
    const o = this.objects.get(path)
    return o ? { path: o.path, size: o.size, crc32c: o.crc32c, contentType: o.contentType, createdAt: o.createdAt } : null
  }

  async signedReadUrl(path: string, ttlMs: number, opts: { filename?: string; inline?: boolean } = {}) {
    if (!this.objects.has(path)) throw new Error('no such object')
    const q = new URLSearchParams({ expires: String(this.now() + ttlMs), ...(opts.inline ? { inline: '1' } : {}) })
    return `memory://read/${path}?${q}`
  }

  async delete(path: string) { this.objects.delete(path) }

  async list(prefix: string) {
    return [...this.objects.values()].filter((o) => o.path.startsWith(prefix)).map(({ bytes: _b, ...o }) => o)
  }
}
