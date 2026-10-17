// A seeded room for working on the page with `next dev`: ROOMS_DEV_FIXTURE=1 pnpm dev, then open
// /r/<printed id> with the cookie room-session=dev-session. Sample people only. It is refused
// outside development, so a production host can never serve it.
import { generateKeyPairSync, randomBytes, sign } from 'node:crypto'
import { MemoryStore } from './memory-store'
import * as rooms from './service'
import { createHash } from 'node:crypto'
import { canonical, publicKeyB64 } from './signing'
import { picturePng } from './test-images'
import { MemoryObjectStore } from './object-store'
import { crc32cBase64 } from './crc32c'

export const DEV_SESSION = 'dev-session'

export function devFixtureEnabled(env: Record<string, string | undefined>) {
  return env.NODE_ENV === 'development' && env.ROOMS_DEV_FIXTURE === '1'
}

/** The memory object store, handing the browser data: addresses so the page's previews and downloads work in dev. */
class DevObjectStore extends MemoryObjectStore {
  async signedReadUrl(path: string) {
    const o = this.objects.get(path)
    if (!o) throw new Error('no such object')
    return `data:${o.contentType};base64,${o.bytes.toString('base64')}`
  }
}

export async function seedDevFixture(): Promise<{ ctx: rooms.Ctx; roomId: string }> {
  const objects = new DevObjectStore()
  const ctx: rooms.Ctx = { store: new MemoryStore(), now: () => Date.now(), objects }
  await rooms.addPerson(ctx, { key: 'ada', name: 'Ada', emails: ['ada@example.com'] })
  await rooms.addPerson(ctx, { key: 'ben', name: 'Ben', emails: ['ben@example.com'] })
  const roomId = await rooms.createRoom(ctx, { person: 'ada', name: 'The spring launch' })
  const nonce = () => randomBytes(12).toString('base64url')
  const join = async (name: string, answersTo: string, test = false) => {
    const { code } = await rooms.createInvite(ctx, 'operator', roomId, { name, answersTo, test })
    const { publicKey, privateKey } = generateKeyPairSync('ed25519')
    const s = (o: object) => sign(null, Buffer.from(canonical(o)), privateKey).toString('base64url')
    const req = { v: 1, type: 'join', code, publicKey: publicKeyB64(publicKey), at: new Date().toISOString(), nonce: nonce() }
    const { memberId } = await rooms.redeemInvite(ctx, req, s(req))
    const send = (type: string, fields: object) => {
      const post = { v: 1, type, room: roomId, member: memberId, at: new Date().toISOString(), nonce: nonce(), ...fields }
      return rooms.submitPost(ctx, roomId, post, s(post))
    }
    send.upload = (bytes: Buffer) => {
      const req = { v: 1, type: 'attachment.upload', room: roomId, member: memberId, sha256: createHash('sha256').update(bytes).digest('hex'), size: bytes.length, contentType: 'image/png', at: new Date().toISOString(), nonce: nonce() }
      return rooms.uploadAttachment(ctx, roomId, req, s(req), bytes)
    }
    send.bring = async (bytes: Buffer, f: { name: string; contentType: string; why: string }) => {
      const m = { sha256: createHash('sha256').update(bytes).digest('hex'), crc32c: crc32cBase64(bytes), size: bytes.length, contentType: f.contentType, name: f.name }
      const req = { v: 1, type: 'context.upload', room: roomId, member: memberId, ...m, at: new Date().toISOString(), nonce: nonce() }
      const a = await rooms.requestContextUpload(ctx, roomId, req, s(req))
      if (!a.held) await objects.finish(a.uploadUrl, bytes)
      await send('context.add', { ...m, why: f.why })
      return m.sha256
    }
    return send
  }
  const ada = await join("Ada's Pluma", 'ada')
  const stand = await join("Stand-in for Ben's Pluma", 'ben', true)
  const { objective } = (await ada('objective', { title: 'The shared lines', owner: 'ada', done: 'Ada decides on the exact words.' })) as { objective: string }
  await stand('objective', { title: "Ben's profile", owner: 'ben', done: 'Ben decides.' })
  await ada('objective.move', { objective, status: 'claimed' })
  await ada('message', { text: 'Claimed The shared lines. A first version is coming for Ada.' })
  await stand('message', { text: 'Test stand-in, speaking for no one.' })
  const pic = await ada.upload(picturePng(640, 360))
  await ada('message', { text: 'The cover, as it stands.', attachments: [{ sha256: pic.sha256, type: pic.type, width: pic.width, height: pic.height, name: 'cover.png', alt: 'A gold and charcoal diagonal: the draft cover' }] })
  const text = 'A house that fits supersuits.\n\nBy introduction only.'
  const { draft } = (await ada('draft', { title: 'The shared lines', objective, text })) as { draft: string }
  await ada('objective.move', { objective, status: 'waiting' })
  await ada('decision', { draft, version: 1, fingerprint: rooms.fingerprintText(text), verdict: 'approve', words: 'Love it, ship that.', saidAt: new Date().toISOString() })
  const still = await ada.bring(picturePng(1280, 720), { name: 'opening-still.png', contentType: 'image/png', why: 'The frame Ada wants the week to open on.' })
  const brief = await stand.bring(Buffer.from('%PDF-1.4\n% the launch brief, a sample\n'), { name: 'launch-brief.pdf', contentType: 'application/pdf', why: 'The brief the launch works from: who it is for and what it promises.' })
  await ada('context.note', { sha256: brief, text: 'Page 2 is the one that matters.' })
  const old = await stand.bring(Buffer.from('an outline that was replaced'), { name: 'old-outline.txt', contentType: 'text/plain', why: 'The first outline, before the brief.' })
  await stand('context.retire', { sha256: old })
  await ada('message', { text: 'Working from the brief and the opening still.', context: [brief, still] })
  await ctx.store.transaction(async (tx) => { tx.set(`sessions/${rooms.sha256(DEV_SESSION)}`, { person: 'ada', expiresAt: Date.now() + rooms.SESSION_MS }) })
  return { ctx, roomId }
}
