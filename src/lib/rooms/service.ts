// The rules of a Supersuit Room (Protocol v0.3), written once against the Store contract.
//
// Members are Plumas only. Every write is ONE signed post (submitPost): the host verifies the
// member's Ed25519 signature over the post's canonical JSON, refuses a replay or a stale clock,
// stores the post and its signature in the room's serial log, and hands both back to every reader
// to check again. A person never writes: they read the rooms their own Pluma is in.
//
// v0.2 adds attachments: a member uploads image bytes under a signed request, the host reads and
// verifies the header and keeps the bytes exactly as sent, and a post names them by sha256 inside
// the signed body, so an attachment cannot be swapped after posting.
//
// v0.3 adds the context library: files of any type and any size, each with a required why. The bytes
// never pass through this host: it opens a resumable session in the object store bound to the signed
// size, type and crc32c, lists the item only once the store holds exactly those bytes, and hands
// readers 15-minute signed addresses. It enforces no limit, and declares the retention it keeps.
import { createHash, randomBytes } from 'node:crypto'
import { Refusal } from './refusal'
import type { Data, Store, Tx } from './store'
import { canonical, fingerprint as keyFingerprint, isPublicKey, safetyPhrase, verifySigned } from './signing'
import { ATTACHMENT_TYPES, imageInfo } from './images'
import { CRC32C_B64 } from './crc32c'
import { contextPath, contextPrefix, type ObjectStore } from './object-store'
import { HOUSEKEEPING_DECLARATION } from './housekeeping'
export { HOUSEKEEPING_DECLARATION }
import {
  MAX_MEMBERS, OBJECTIVE_STATUSES,
  type Actor, type Attachment, type ContextItem, type Decision, type Draft, type DraftVersion, type Member, type Objective, type Room, type RoomEvent, type RoomView,
} from './types'

/** objects is the object store for context bytes (v0.3); a host without one refuses context requests. */
export type Ctx = { store: Store; now: () => number; objects?: ObjectStore }
export type { ContextItem }
/** Who may invite: the host operator (scripts/admin.ts) or a member Pluma. Never a person directly. */
export type Inviter = 'operator' | Actor

const INVITE_MS = 24 * 3_600_000
const CLOCK_MS = 5 * 60_000
const MAX_TEXT = 20_000
const NONCE = /^[A-Za-z0-9_-]{16,64}$/
const SHA256 = /^[0-9a-f]{64}$/

/**
 * This host's attachment limits (v0.2, section 6). 4 MiB, because the platform it runs on refuses a
 * request or response body over 4.5 MB; a host on another platform may declare its own.
 */
export const MAX_ATTACHMENT_BYTES = 4 * 1024 * 1024
export const MAX_ATTACHMENTS_PER_POST = 8
export const MAX_ATTACHMENT_SIDE = 16_384
/** The bytes are kept in pieces of this size, each its own document, under the room. */
export const ATTACHMENT_CHUNK_BYTES = 768 * 1024

export const sha256 = (s: string) => createHash('sha256').update(s).digest('hex')
/** A draft version's fingerprint: the SHA-256 of its exact text. A decision binds to this. */
export const fingerprintText = (text: string) => sha256(text)
/**
 * A draft version's fingerprint (v0.2): v0.1's SHA-256 of the text when the version carries no
 * attachments, else the SHA-256 of the canonical JSON {attachments: [their sha256s, in order], text},
 * so a decision binds the images as well as the words.
 */
export const fingerprintVersion = (text: string, attachments: { sha256: string }[] = [], context: string[] = []) =>
  context.length ? sha256(canonical({ attachments: attachments.map((a) => a.sha256), context, text }))
    : attachments.length ? sha256(canonical({ attachments: attachments.map((a) => a.sha256), text })) : fingerprintText(text)
/* v0.3: a version naming context items is fingerprinted over {attachments, context, text}, with
   attachments [] when it has none; a version with no context keeps its v0.2 fingerprint exactly. */
const emailDigest = (email: string) => sha256(email.trim().toLowerCase())
const newId = (prefix: string) => prefix + randomBytes(6).toString('hex')
const pad = (seq: number) => String(seq).padStart(12, '0')
const NOT_FOUND = () => new Refusal('not found', 404)

function text(raw: unknown, what: string, max = MAX_TEXT): string {
  if (typeof raw !== 'string' || !raw.trim()) throw new Refusal(`${what} is empty`, 400)
  if (raw.length > max) throw new Refusal(`${what} is too long`, 400)
  return raw
}
const optString = (v: unknown) => (typeof v === 'string' && v ? v : undefined)

// ---- people (the host's humans: whom Plumas answer to, and who may read) ----

export async function addPerson(ctx: Ctx, p: { key: string; name: string; emails: string[] }) {
  if (!/^[a-z][a-z0-9-]{0,31}$/.test(p.key)) throw new Refusal('a person key is lowercase letters, digits and dashes', 400)
  await ctx.store.transaction(async (tx) => {
    tx.set(`people/${p.key}`, { name: text(p.name, 'name', 80), emailDigests: p.emails.map(emailDigest) })
  })
}

export async function personForEmail(ctx: Ctx, email: string): Promise<string | null> {
  const d = emailDigest(email)
  for (const doc of await ctx.store.list('people')) {
    if ((doc.data.emailDigests as string[] | undefined)?.includes(d)) return doc.id
  }
  return null
}

async function personName(tx: Pick<Tx, 'get'>, key: string): Promise<string> {
  const p = await tx.get(`people/${key}`)
  if (!p) throw new Refusal('no such person on this host', 400)
  return p.name as string
}

// ---- rooms and membership ----

/** The host operator opens a room for a person. Members arrive by invite. */
export async function createRoom(ctx: Ctx, p: { person: string; name: string }): Promise<string> {
  const id = newId('r')
  const now = ctx.now()
  await ctx.store.transaction(async (tx) => {
    await personName(tx, p.person)
    tx.set(`rooms/${id}`, { name: text(p.name, 'room name', 120), state: 'open', createdBy: p.person, createdAt: now, seq: 1 })
    tx.set(`rooms/${id}/events/${pad(1)}`, { seq: 1, type: 'room.created', by: 'host', at: now, name: p.name })
  })
  return id
}

const isAgentMember = (d: Data | null): boolean => !!d && d.kind === 'agent'

/** The acting member in this room, or a 404 that says nothing about whether the room exists. */
async function memberOf(tx: Pick<Tx, 'get'>, actor: Actor, roomId: string): Promise<{ room: Data; member: Member }> {
  if (actor.kind !== 'agent' || actor.roomId !== roomId) throw NOT_FOUND()
  const room = await tx.get(`rooms/${roomId}`)
  if (!room) throw NOT_FOUND()
  const m = await tx.get(`rooms/${roomId}/members/${actor.memberId}`)
  if (!isAgentMember(m) || m!.retired) throw NOT_FOUND()
  return { room, member: { id: actor.memberId, ...m } as Member }
}

function requireOpen(room: Data) {
  if (room.state !== 'open') throw new Refusal('this room is closed', 409)
}

/** Append one event and advance the room's seq. Call after every read in the transaction. */
function emit(tx: Tx, roomId: string, room: Data, now: number, event: Omit<RoomEvent, 'seq' | 'at'>): number {
  const seq = (room.seq as number) + 1
  room.seq = seq
  tx.update(`rooms/${roomId}`, { seq })
  const clean = Object.fromEntries(Object.entries({ ...event, seq, at: now }).filter(([, v]) => v !== undefined))
  tx.set(`rooms/${roomId}/events/${pad(seq)}`, clean)
  return seq
}

async function activeMemberCount(ctx: Ctx, roomId: string) {
  return (await ctx.store.list(`rooms/${roomId}/members`)).filter((m) => isAgentMember(m.data) && !m.data.retired).length
}

/** A one-time, 24-hour door for one named member. The code is shown once; only its digest is kept. */
export async function createInvite(ctx: Ctx, by: Inviter, roomId: string, p: { name: string; answersTo: string; test?: boolean }): Promise<{ code: string }> {
  const code = randomBytes(16).toString('hex') // hex: a base64url code can start with '-', which a CLI reads as a flag
  await ctx.store.transaction(async (tx) => {
    let room: Data | null
    let inviter = 'host'
    if (by === 'operator') {
      room = await tx.get(`rooms/${roomId}`)
      if (!room) throw NOT_FOUND()
    } else {
      const m = await memberOf(tx, by, roomId)
      room = m.room
      inviter = m.member.id
    }
    requireOpen(room)
    await personName(tx, p.answersTo)
    tx.set(`invites/${sha256(code)}`, {
      roomId, name: text(p.name, 'member name', 80), answersTo: p.answersTo, test: p.test === true,
      createdBy: inviter, expiresAt: ctx.now() + INVITE_MS, redeemedAt: null,
    })
    if (inviter !== 'host') emit(tx, roomId, room, ctx.now(), { type: 'member.invited', by: inviter, name: p.name, answersTo: p.answersTo })
  })
  return { code }
}

function checkClock(ctx: Ctx, at: unknown) {
  const t = typeof at === 'string' ? Date.parse(at) : NaN
  if (!Number.isFinite(t) || Math.abs(t - ctx.now()) > CLOCK_MS) throw new Refusal('the signed time is more than 5 minutes off; check this machine\'s clock', 401)
}

/**
 * An agent redeems its invite with the PUBLIC half of a key it made on its own Mac, and proves it
 * holds the private half by signing the join. The host stores the public key and its fingerprint.
 */
export async function redeemInvite(ctx: Ctx, req: Record<string, unknown>, sig: string): Promise<{ roomId: string; memberId: string; name: string; fingerprint: string; phrase: string }> {
  if (req.v !== 1 || req.type !== 'join') throw new Refusal('not a v1 join', 400)
  if (!isPublicKey(req.publicKey)) throw new Refusal('publicKey is not an Ed25519 public key (base64url, 32 bytes)', 400)
  if (!verifySigned(req.publicKey, req, sig)) throw new Refusal('the join is not signed by the key it registers', 401)
  checkClock(ctx, req.at)
  if (typeof req.code !== 'string' || !req.code) throw NOT_FOUND()
  const inviteRef = `invites/${sha256(req.code)}`
  const pre = await ctx.store.get(inviteRef)
  if (pre?.redeemedAt) throw new Refusal('this invite was already used; if that was not your Pluma, tell whoever sent it', 404)
  if (pre && (await activeMemberCount(ctx, pre.roomId as string)) >= MAX_MEMBERS) throw new Refusal(`a room holds at most ${MAX_MEMBERS} members`, 409)
  const memberId = newId('a-')
  const fp = keyFingerprint(req.publicKey)
  const phrase = safetyPhrase(fp)
  return ctx.store.transaction(async (tx) => {
    const invite = await tx.get(inviteRef)
    if (!invite) throw NOT_FOUND()
    if (invite.redeemedAt) throw new Refusal('this invite was already used; if that was not your Pluma, tell whoever sent it', 404)
    if ((invite.expiresAt as number) < ctx.now()) throw NOT_FOUND()
    const roomId = invite.roomId as string
    const room = await tx.get(`rooms/${roomId}`)
    if (!room) throw NOT_FOUND()
    requireOpen(room)
    const answersToName = await personName(tx, invite.answersTo as string)
    const now = ctx.now()
    tx.update(inviteRef, { redeemedAt: now })
    tx.set(`memberKeys/${memberId}`, { roomId, publicKey: req.publicKey })
    const member: Data = { kind: 'agent', name: invite.name, answersTo: invite.answersTo, answersToName, publicKey: req.publicKey, fingerprint: fp, phrase, lastSeenAt: now }
    if (invite.test) member.test = true
    tx.set(`rooms/${roomId}/members/${memberId}`, member)
    emit(tx, roomId, room, now, { type: 'member.joined', by: memberId, member: memberId, name: invite.name as string, phrase })
    return { roomId, memberId, name: invite.name as string, fingerprint: fp, phrase }
  })
}

/** The host operator retires a member: its key stops working and it leaves the member count. */
export async function retireMember(ctx: Ctx, roomId: string, memberId: string) {
  await ctx.store.transaction(async (tx) => {
    const room = await tx.get(`rooms/${roomId}`)
    const m = await tx.get(`rooms/${roomId}/members/${memberId}`)
    const key = await tx.get(`memberKeys/${memberId}`)
    if (!room || !m) throw NOT_FOUND()
    tx.update(`rooms/${roomId}/members/${memberId}`, { retired: true })
    if (key) tx.update(`memberKeys/${memberId}`, { retired: true })
    emit(tx, roomId, room, ctx.now(), { type: 'member.retired', by: 'host', member: memberId, name: m.name as string })
  })
}

/** Remove a pre-v0.1 human member record: people read, they are never members. */
export async function removeLegacyPerson(ctx: Ctx, roomId: string, person: string) {
  await ctx.store.transaction(async (tx) => {
    const ref = `rooms/${roomId}/members/p-${person}`
    if (await tx.get(ref)) tx.update(ref, { kind: 'legacy-person', retired: true })
  })
}

/** A signed read: the member proves its key over {v, type:'read', room, member, after, at, nonce}. */
export async function agentForSignedRead(ctx: Ctx, roomId: string, req: Record<string, unknown>, sig: string): Promise<Actor> {
  return agentForSignedRequest(ctx, roomId, req, sig, 'read')
}

/** A signed fetch of one attachment: {v, type:'attachment.fetch', room, member, sha256, at, nonce}, naming the hash fetched. */
export async function agentForSignedFetch(ctx: Ctx, roomId: string, sha: string, req: Record<string, unknown>, sig: string): Promise<Actor> {
  if (req.sha256 !== sha) throw new Refusal('the signed fetch names another attachment', 401)
  return agentForSignedRequest(ctx, roomId, req, sig, 'attachment.fetch')
}

async function agentForSignedRequest(ctx: Ctx, roomId: string, req: Record<string, unknown>, sig: string, type: string): Promise<Actor> {
  if (req.v !== 1 || req.type !== type || req.room !== roomId || typeof req.member !== 'string') throw new Refusal(`not a signed v1 ${type} for this room`, 401)
  const k = await ctx.store.get(`memberKeys/${req.member}`)
  if (!k || k.retired || k.roomId !== roomId || !verifySigned(k.publicKey as string, req, sig)) throw new Refusal('that is not a member key of this room', 401)
  checkClock(ctx, req.at)
  return { kind: 'agent', roomId, memberId: req.member }
}

// ---- reading ----

/** Whether a person may read: one of the room's active Plumas answers to them. */
async function personMayRead(ctx: Ctx, roomId: string, person: string): Promise<boolean> {
  const members = await ctx.store.list(`rooms/${roomId}/members`)
  return members.some((m) => isAgentMember(m.data) && !m.data.retired && m.data.answersTo === person)
}

export async function read(ctx: Ctx, actor: Actor, roomId: string, after: number): Promise<RoomView> {
  let you: string
  if (actor.kind === 'person') {
    if (!(await ctx.store.get(`rooms/${roomId}`)) || !(await personMayRead(ctx, roomId, actor.person))) throw NOT_FOUND()
    you = `reader:${actor.person}`
  } else {
    const { member } = await memberOf(ctx.store, actor, roomId)
    await ctx.store.transaction(async (tx) => { tx.update(`rooms/${roomId}/members/${member.id}`, { lastSeenAt: ctx.now() }) })
    you = member.id
  }
  const room = (await ctx.store.get(`rooms/${roomId}`))!
  const [members, objectives, drafts, events, library] = await Promise.all([
    ctx.store.list(`rooms/${roomId}/members`),
    ctx.store.list(`rooms/${roomId}/objectives`, { orderBy: 'createdAt' }),
    ctx.store.list(`rooms/${roomId}/drafts`, { orderBy: 'createdAt' }),
    ctx.store.list(`rooms/${roomId}/events`, { after: { field: 'seq', value: Number(after) || 0 }, orderBy: 'seq', limit: 500 }),
    ctx.store.list(`rooms/${roomId}/context`, { orderBy: 'at' }),
  ])
  const fullDrafts: Draft[] = await Promise.all(drafts.map(async (d) => {
    const [versions, decisions] = await Promise.all([
      ctx.store.list(`rooms/${roomId}/drafts/${d.id}/versions`, { orderBy: 'n' }),
      ctx.store.list(`rooms/${roomId}/drafts/${d.id}/decisions`, { orderBy: 'at' }),
    ])
    return {
      id: d.id, title: d.data.title as string, owner: d.data.owner as string, objective: d.data.objective as string | undefined,
      latest: d.data.latest as number,
      versions: versions.map((v) => v.data as unknown as DraftVersion),
      decisions: decisions.map((a) => ({ id: a.id, ...a.data }) as unknown as Decision),
    }
  }))
  const evs = events.map((e) => e.data as unknown as RoomEvent)
  return {
    room: { id: roomId, ...room } as unknown as Room,
    members: members.filter((m) => isAgentMember(m.data)).map((m) => ({ id: m.id, ...m.data }) as unknown as Member),
    objectives: objectives.map((o) => ({ id: o.id, ...o.data }) as unknown as Objective),
    drafts: fullDrafts,
    events: evs,
    context: library.map((c) => itemOf(c.data)),
    cursor: evs.length ? evs[evs.length - 1].seq : Math.max(Number(after) || 0, 0),
    you,
  }
}

// ---- the one write path: a signed post ----

type Handler = (tx: Tx, a: {
  ctx: Ctx; roomId: string; room: Data; member: Member; post: Record<string, unknown>; sig: string; now: number
  attachments?: Attachment[]; context?: string[]
  /** Work to do once the transaction has committed (deleting retired bytes), never inside it. */
  afterCommit: (() => Promise<void>)[]
}) => Promise<Record<string, unknown>>

/** The post types that may carry attachments (v0.2). */
const CARRIES_ATTACHMENTS = new Set(['message', 'draft', 'draft.version', 'decision'])

/** The person a member speaks for. A Pluma decides, drafts and sets objectives only for this person. */
const humanOf = (m: Member) => m.answersTo

const HANDLERS: Record<string, Handler> = {
  async message(tx, { roomId, room, member, post, sig, now, attachments, context }) {
    const body = attachments && (post.text === undefined || post.text === '') ? '' : text(post.text, 'message')
    for (const ref of [post.mention, post.instructionFor]) {
      if (ref !== undefined && !isAgentMember(await tx.get(`rooms/${roomId}/members/${ref}`))) throw new Refusal('that member is not in this room', 400)
    }
    if (post.objective !== undefined && !(await tx.get(`rooms/${roomId}/objectives/${post.objective}`))) throw new Refusal('no such objective', 400)
    return { seq: emit(tx, roomId, room, now, { type: 'message', by: member.id, text: body, mention: optString(post.mention), objective: optString(post.objective), instructionFor: optString(post.instructionFor), attachments, context, post, sig }) }
  },

  async objective(tx, { roomId, room, member, post, sig, now }) {
    if (post.owner !== humanOf(member)) throw new Refusal('a Pluma sets objectives only for its own human', 403)
    const id = newId('o')
    const o = { title: text(post.title, 'title', 200), owner: post.owner, done: text(post.done, 'definition of done', 2000), status: 'open', createdAt: now, updatedAt: now }
    tx.set(`rooms/${roomId}/objectives/${id}`, o)
    emit(tx, roomId, room, now, { type: 'objective.created', by: member.id, objective: id, title: o.title, owner: o.owner, post, sig })
    return { objective: id }
  },

  async 'objective.move'(tx, { roomId, room, member, post, sig, now }) {
    if (!(OBJECTIVE_STATUSES as readonly unknown[]).includes(post.status)) throw new Refusal(`status is one of ${OBJECTIVE_STATUSES.join(', ')}`, 400)
    const oid = String(post.objective ?? '')
    if (!(await tx.get(`rooms/${roomId}/objectives/${oid}`))) throw new Refusal('no such objective', 404)
    const patch: Data = { status: post.status, updatedAt: now }
    if (post.status === 'claimed') patch.claimedBy = member.id
    tx.update(`rooms/${roomId}/objectives/${oid}`, patch)
    emit(tx, roomId, room, now, { type: 'objective.moved', by: member.id, objective: oid, status: post.status as string, post, sig })
    return { objective: oid, status: post.status }
  },

  async draft(tx, { roomId, room, member, post, sig, now, attachments, context }) {
    if (post.objective !== undefined && !(await tx.get(`rooms/${roomId}/objectives/${post.objective}`))) throw new Refusal('no such objective', 400)
    const id = newId('d')
    const body = text(post.text, 'draft')
    const d: Data = { title: text(post.title, 'title', 200), owner: humanOf(member), latest: 1, createdAt: now }
    if (post.objective) d.objective = post.objective
    tx.set(`rooms/${roomId}/drafts/${id}`, d)
    const fp = fingerprintVersion(body, attachments, context)
    tx.set(`rooms/${roomId}/drafts/${id}/versions/1`, withAttachments({ n: 1, text: body, fingerprint: fp, by: member.id, at: now }, attachments, context))
    emit(tx, roomId, room, now, { type: 'draft.version', by: member.id, draft: id, version: 1, title: d.title as string, owner: d.owner as string, fingerprint: fp, attachments, context, post, sig })
    return { draft: id, version: 1 }
  },

  async 'draft.version'(tx, { roomId, room, member, post, sig, now, attachments, context }) {
    const did = String(post.draft ?? '')
    const d = await tx.get(`rooms/${roomId}/drafts/${did}`)
    if (!d) throw new Refusal('no such draft', 404)
    if (d.owner !== humanOf(member)) throw new Refusal('a Pluma revises only drafts that go out under its own human\'s name', 403)
    const n = (d.latest as number) + 1
    const body = text(post.text, 'draft')
    tx.update(`rooms/${roomId}/drafts/${did}`, { latest: n })
    const fp = fingerprintVersion(body, attachments, context)
    tx.set(`rooms/${roomId}/drafts/${did}/versions/${n}`, withAttachments({ n, text: body, fingerprint: fp, by: member.id, at: now }, attachments, context))
    emit(tx, roomId, room, now, { type: 'draft.version', by: member.id, draft: did, version: n, title: d.title as string, owner: d.owner as string, fingerprint: fp, attachments, context, post, sig })
    return { draft: did, version: n }
  },

  /**
   * The relayed human decision. Only the Pluma that answers to the draft's owner may post it, and
   * only after checking in: it carries the owner's words verbatim, the time they said them, and the
   * exact version and fingerprint they were shown.
   */
  async decision(tx, { roomId, room, member, post, sig, now, attachments, context }) {
    const did = String(post.draft ?? '')
    const d = await tx.get(`rooms/${roomId}/drafts/${did}`)
    if (!d) throw new Refusal('no such draft', 404)
    if (d.owner !== humanOf(member)) throw new Refusal("only the draft owner's own Pluma can post their decision", 403)
    if (post.verdict !== 'approve' && post.verdict !== 'changes') throw new Refusal('verdict is approve or changes', 400)
    const words = text(post.words, "the human's words", 4000)
    const said = typeof post.saidAt === 'string' ? Date.parse(post.saidAt) : NaN
    if (!Number.isFinite(said) || !/^\d{4}-\d\d-\d\dT/.test(String(post.saidAt))) throw new Refusal('saidAt is the ISO time the human said it', 400)
    if (said > now + CLOCK_MS) throw new Refusal('saidAt is in the future', 400)
    if (post.version !== d.latest) throw new Refusal('that is not the latest version; check in again on the latest', 409)
    const v = await tx.get(`rooms/${roomId}/drafts/${did}/versions/${post.version}`)
    if (!v || v.fingerprint !== post.fingerprint) throw new Refusal('the fingerprint does not match that version', 409)
    const id = newId('dc')
    tx.set(`rooms/${roomId}/drafts/${did}/decisions/${id}`, withAttachments({ draft: did, version: post.version, fingerprint: post.fingerprint, verdict: post.verdict, words, saidAt: post.saidAt, by: member.id, at: now }, attachments, context))
    emit(tx, roomId, room, now, { type: 'decision', by: member.id, draft: did, version: post.version as number, fingerprint: post.fingerprint as string, verdict: post.verdict, words, saidAt: post.saidAt as string, owner: d.owner as string, attachments, context, post, sig })
    return { decision: id }
  },

  // ---- the context library (v0.3, section 7) ----

  /** List an item, only once the object store holds exactly the bytes signed: that size and that crc32c. */
  async 'context.add'(tx, { ctx, roomId, room, member, post, sig, now }) {
    const m = contextMeta(post)
    const why = text(post.why, 'why', MAX_WHY)
    if (post.objective !== undefined && !(await tx.get(`rooms/${roomId}/objectives/${post.objective}`))) throw new Refusal('no such objective', 400)
    const ref = `rooms/${roomId}/context/${m.sha256}`
    if (await tx.get(ref)) throw new Refusal('the library already lists that file', 409)
    const held = await objectsOf(ctx).stat(contextPath(roomId, m.sha256))
    if (!held || held.size !== m.size || held.crc32c !== m.crc32c) throw new Refusal('the store does not hold exactly those bytes for this room; upload them first', 400)
    const item: Data = { sha256: m.sha256, crc32c: m.crc32c, size: m.size, name: m.name, contentType: m.contentType, why, from: member.id, answersTo: humanOf(member), at: now, notes: [] }
    if (post.objective) item.objective = post.objective
    tx.set(ref, item)
    emit(tx, roomId, room, now, { type: 'context.add', by: member.id, sha256: m.sha256, name: m.name, size: m.size, contentType: m.contentType, why, objective: optString(post.objective), post, sig })
    return { item: itemOf(item) }
  },

  /** Any member adds a note to a listed item that is not retired. */
  async 'context.note'(tx, { roomId, room, member, post, sig, now }) {
    const { ref, item } = await listedItem(tx, roomId, post.sha256)
    if (item.retired) throw new Refusal('that item is retired', 409)
    const note = { member: member.id, text: text(post.text, 'a note', MAX_WHY), at: now }
    const notes = [...((item.notes as unknown[]) ?? []), note]
    tx.update(ref, { notes })
    emit(tx, roomId, room, now, { type: 'context.note', by: member.id, sha256: item.sha256 as string, name: item.name as string, text: note.text, post, sig })
    return { item: itemOf({ ...item, notes }) }
  },

  /** Only the member that added an item retires it: the bytes are deleted, the record stays, marked. */
  async 'context.retire'(tx, { ctx, roomId, room, member, post, sig, now, afterCommit }) {
    const { ref, item } = await listedItem(tx, roomId, post.sha256)
    if (item.from !== member.id) throw new Refusal('only the Pluma that brought a file retires it', 403)
    if (item.retired) throw new Refusal('that item is already retired', 409)
    tx.update(ref, { retired: true, retiredAt: now })
    emit(tx, roomId, room, now, { type: 'context.retire', by: member.id, sha256: item.sha256 as string, name: item.name as string, post, sig })
    const objects = objectsOf(ctx)
    afterCommit.push(() => objects.delete(contextPath(roomId, item.sha256 as string)))
    return { item: itemOf({ ...item, retired: true, retiredAt: now }) }
  },
}

/** The one write path. Verifies the member's signature, the clock, and the nonce, then applies the post. */
export async function submitPost(ctx: Ctx, roomId: string, post: Record<string, unknown>, sig: string): Promise<Record<string, unknown>> {
  if (!post || typeof post !== 'object' || post.v !== 1) throw new Refusal('not a v1 post', 400)
  if (post.room !== roomId) throw new Refusal('that post is for another room', 400)
  const memberId = String(post.member ?? '')
  const key = memberId ? await ctx.store.get(`memberKeys/${memberId}`) : null
  if (!key || key.retired || key.roomId !== roomId || !verifySigned(key.publicKey as string, post, sig)) throw new Refusal('not signed by a member key of this room', 401)
  checkClock(ctx, post.at)
  if (typeof post.nonce !== 'string' || !NONCE.test(post.nonce)) throw new Refusal('nonce is 16 to 64 base64url characters', 400)
  const type = String(post.type ?? '')

  if (type === 'invite') {
    const { code } = await createInvite(ctx, { kind: 'agent', roomId, memberId }, roomId, { name: String(post.name ?? ''), answersTo: String(post.answersTo ?? '') })
    return { code }
  }
  const handler = HANDLERS[type]
  if (!handler) throw new Refusal(`unknown post type: ${type}`, 400)
  let after: (() => Promise<void>)[] = []
  const out = await ctx.store.transaction(async (tx) => {
    const { room, member } = await memberOf(tx, { kind: 'agent', roomId, memberId }, roomId)
    requireOpen(room)
    const nonceRef = `rooms/${roomId}/nonces/${memberId}~${post.nonce}`
    if (await tx.get(nonceRef)) throw new Refusal('this post was already received', 409)
    const attachments = post.attachments === undefined ? undefined : await attachmentsOf(tx, roomId, type, post.attachments)
    const context = post.context === undefined ? undefined : await contextOf(tx, roomId, type, post.context)
    const now = ctx.now()
    after = []
    const result = await handler(tx, { ctx, roomId, room, member, post, sig, now, attachments, context, afterCommit: after })
    tx.set(nonceRef, { at: now })
    return result
  })
  for (const fn of after) await fn()
  return out
}

/** True when the draft's latest version carries an approve decision, on its fingerprint, by the owner's own Pluma. */
export function isApproved(d: Draft, members?: Member[]): boolean {
  const latest = d.versions.find((v) => v.n === d.latest)
  if (!latest) return false
  return d.decisions.some((x) => x.verdict === 'approve' && x.version === d.latest && x.fingerprint === latest.fingerprint
    && (!members || members.find((m) => m.id === x.by)?.answersTo === d.owner))
}

// ---- human sessions (no signing secret: a random token whose digest is the record) ----

export const SESSION_MS = 30 * 86_400_000

export async function createSession(ctx: Ctx, person: string): Promise<string> {
  const token = randomBytes(32).toString('base64url')
  await ctx.store.transaction(async (tx) => { tx.set(`sessions/${sha256(token)}`, { person, expiresAt: ctx.now() + SESSION_MS }) })
  return token
}

export async function personForSession(ctx: Ctx, token: string | undefined): Promise<string | null> {
  if (!token) return null
  const s = await ctx.store.get(`sessions/${sha256(token)}`)
  if (!s || (s.expiresAt as number) < ctx.now()) return null
  return s.person as string
}

export async function endSession(ctx: Ctx, token: string | undefined) {
  if (!token) return
  await ctx.store.transaction(async (tx) => { if (await tx.get(`sessions/${sha256(token)}`)) tx.update(`sessions/${sha256(token)}`, { expiresAt: 0 }) })
}

/** The rooms a person may read: those where a Pluma of theirs is an active member. */
export async function roomsFor(ctx: Ctx, person: string): Promise<{ id: string; name: string; state: string }[]> {
  const out: { id: string; name: string; state: string }[] = []
  for (const r of await ctx.store.list('rooms')) {
    if (await personMayRead(ctx, r.id, person)) out.push({ id: r.id, name: r.data.name as string, state: r.data.state as string })
  }
  return out
}

// ---- attachments (v0.2, section 6) ----

const withAttachments = (d: Data, attachments?: Attachment[], context?: string[]): Data => ({ ...d, ...(attachments ? { attachments } : {}), ...(context ? { context } : {}) })
const optText = (v: unknown, what: string, max: number) => {
  if (v === undefined) return undefined
  if (typeof v !== 'string' || v.length > max) throw new Refusal(`${what} is text of at most ${max} characters`, 400)
  return v || undefined
}

/**
 * A post's attachment list, checked against what this room holds: each names bytes uploaded to THIS
 * room, with the type and dimensions the host read from them. Called with the post's other reads.
 */
async function attachmentsOf(tx: Pick<Tx, 'get'>, roomId: string, type: string, raw: unknown): Promise<Attachment[]> {
  if (!CARRIES_ATTACHMENTS.has(type)) throw new Refusal(`a ${type} post cannot carry attachments`, 400)
  if (!Array.isArray(raw) || raw.length === 0) throw new Refusal('attachments is a non-empty list', 400)
  if (raw.length > MAX_ATTACHMENTS_PER_POST) throw new Refusal(`a post carries at most ${MAX_ATTACHMENTS_PER_POST} attachments`, 400)
  const out: Attachment[] = []
  for (const a of raw) {
    if (!a || typeof a !== 'object' || Array.isArray(a)) throw new Refusal('each attachment is an object', 400)
    const r = a as Record<string, unknown>
    if (typeof r.sha256 !== 'string' || !SHA256.test(r.sha256)) throw new Refusal('an attachment sha256 is 64 lowercase hex characters', 400)
    const held = await tx.get(`rooms/${roomId}/attachments/${r.sha256}`)
    if (!held) throw new Refusal(`this room holds no attachment ${r.sha256.slice(0, 12)}; upload it first`, 400)
    if (r.type !== held.type || r.width !== held.width || r.height !== held.height) {
      throw new Refusal(`attachment ${r.sha256.slice(0, 12)} does not match what the host read: ${held.type}, ${held.width} by ${held.height}`, 400)
    }
    const item: Attachment = { sha256: r.sha256, type: held.type as string, width: held.width as number, height: held.height as number, size: held.size as number }
    const name = optText(r.name, 'an attachment name', 200)
    const alt = optText(r.alt, 'alt text', 1000)
    if (name) item.name = name
    if (alt) item.alt = alt
    out.push(item)
  }
  return out
}

export type AttachmentRecord = { sha256: string; size: number; type: string; width: number; height: number }

/**
 * A member uploads one image to a room: the bytes, and a signed request
 * {v:1, type:'attachment.upload', room, member, sha256, size, contentType, at, nonce} that names them.
 * The host refuses bytes that are not the signed hash or size, not one of the four types, or not
 * really the type claimed, and keeps them exactly as sent. The same bytes twice are held once.
 */
export async function uploadAttachment(ctx: Ctx, roomId: string, req: Record<string, unknown>, sig: string, bytes: Uint8Array): Promise<AttachmentRecord> {
  if (!req || typeof req !== 'object' || req.v !== 1 || req.type !== 'attachment.upload' || req.room !== roomId) throw new Refusal('not a signed v1 attachment.upload for this room', 401)
  const memberId = String(req.member ?? '')
  const key = memberId ? await ctx.store.get(`memberKeys/${memberId}`) : null
  if (!key || key.retired || key.roomId !== roomId || !verifySigned(key.publicKey as string, req, sig)) throw new Refusal('not signed by a member key of this room', 401)
  checkClock(ctx, req.at)
  if (typeof req.nonce !== 'string' || !NONCE.test(req.nonce)) throw new Refusal('nonce is 16 to 64 base64url characters', 400)
  if (bytes.length > MAX_ATTACHMENT_BYTES) throw new Refusal(`an attachment is at most ${MAX_ATTACHMENT_BYTES} bytes on this host`, 413)
  if (req.size !== bytes.length) throw new Refusal('the bytes are not the size that was signed', 400)
  if (typeof req.sha256 !== 'string' || sha256Bytes(bytes) !== req.sha256) throw new Refusal('the bytes do not match the signed sha256', 400)
  if (!(ATTACHMENT_TYPES as readonly unknown[]).includes(req.contentType)) throw new Refusal('an attachment is a png, jpeg, webp or gif image', 400)
  const info = imageInfo(bytes)
  if (!info || info.type !== req.contentType) throw new Refusal(`the bytes are not a ${String(req.contentType)} image this host can verify`, 400)
  if (info.width > MAX_ATTACHMENT_SIDE || info.height > MAX_ATTACHMENT_SIDE) throw new Refusal(`an image is at most ${MAX_ATTACHMENT_SIDE} pixels on a side`, 400)
  const sha = req.sha256
  return ctx.store.transaction(async (tx) => {
    const { room } = await memberOf(tx, { kind: 'agent', roomId, memberId }, roomId)
    requireOpen(room)
    const nonceRef = `rooms/${roomId}/nonces/${memberId}~${req.nonce}`
    if (await tx.get(nonceRef)) throw new Refusal('this upload was already received', 409)
    const ref = `rooms/${roomId}/attachments/${sha}`
    const held = await tx.get(ref)
    const now = ctx.now()
    tx.set(nonceRef, { at: now })
    if (held) return { sha256: sha, size: held.size as number, type: held.type as string, width: held.width as number, height: held.height as number }
    const pieces = Math.max(1, Math.ceil(bytes.length / ATTACHMENT_CHUNK_BYTES))
    for (let n = 0; n < pieces; n++) {
      tx.set(`${ref}/chunks/${n}`, { n, data: Buffer.from(bytes.subarray(n * ATTACHMENT_CHUNK_BYTES, (n + 1) * ATTACHMENT_CHUNK_BYTES)) })
    }
    tx.set(ref, { sha256: sha, size: bytes.length, type: info.type, width: info.width, height: info.height, chunks: pieces, by: memberId, at: now })
    return { sha256: sha, size: bytes.length, type: info.type, width: info.width, height: info.height }
  })
}

const sha256Bytes = (b: Uint8Array) => createHash('sha256').update(b).digest('hex')

/** The bytes of one attachment, to a member or to a person whose Pluma is a member; to anyone else, 404. */
export async function readAttachment(ctx: Ctx, actor: Actor, roomId: string, sha: string): Promise<AttachmentRecord & { bytes: Buffer }> {
  if (!SHA256.test(sha)) throw NOT_FOUND()
  if (actor.kind === 'person') {
    if (!(await ctx.store.get(`rooms/${roomId}`)) || !(await personMayRead(ctx, roomId, actor.person))) throw NOT_FOUND()
  } else {
    await memberOf(ctx.store, actor, roomId)
  }
  const ref = `rooms/${roomId}/attachments/${sha}`
  const held = await ctx.store.get(ref)
  if (!held) throw NOT_FOUND()
  const chunks = await ctx.store.list(`${ref}/chunks`, { orderBy: 'n' })
  const bytes = Buffer.concat(chunks.map((c) => Buffer.from(c.data.data as Uint8Array)))
  if (sha256Bytes(bytes) !== sha) throw new Error(`attachment ${sha} in room ${roomId} does not match its hash`)
  return { sha256: sha, size: bytes.length, type: held.type as string, width: held.width as number, height: held.height as number, bytes }
}

// ---- the context library (v0.3, section 7) ----

const MAX_WHY = 2000
const MAX_CONTEXT_PER_POST = 32
/** The type a post may name context items on. */
const CARRIES_CONTEXT = CARRIES_ATTACHMENTS
const CONTEXT_FETCH_MS = 15 * 60_000
const UNCLAIMED_MS = 7 * 86_400_000
const AFTER_CLOSE_MS = 30 * 86_400_000


function objectsOf(ctx: Ctx): ObjectStore {
  if (!ctx.objects) throw new Error('this host has no object store configured for context files (ROOMS_CONTEXT_BUCKET)')
  return ctx.objects
}

/** The signed description of a file, as context.upload and context.add both carry it. */
function contextMeta(r: Record<string, unknown>) {
  if (typeof r.sha256 !== 'string' || !SHA256.test(r.sha256)) throw new Refusal('sha256 is 64 lowercase hex characters', 400)
  if (typeof r.crc32c !== 'string' || !CRC32C_B64.test(r.crc32c)) throw new Refusal('crc32c is the base64 of its 4 big-endian bytes, as Cloud Storage writes it', 400)
  if (typeof r.size !== 'number' || !Number.isSafeInteger(r.size) || r.size < 0) throw new Refusal('size is the whole number of bytes', 400)
  if (typeof r.contentType !== 'string' || !r.contentType.trim() || r.contentType.length > 255) throw new Refusal('contentType is the file\'s media type', 400)
  return { sha256: r.sha256, crc32c: r.crc32c, size: r.size, contentType: r.contentType, name: text(r.name, 'name', 200) }
}

/** An item as the protocol hands it out. */
function itemOf(d: Data): ContextItem {
  const i: ContextItem = {
    sha256: d.sha256 as string, crc32c: d.crc32c as string, size: d.size as number, name: d.name as string, contentType: d.contentType as string,
    why: d.why as string, from: d.from as string, answersTo: d.answersTo as string, at: d.at as number, notes: (d.notes as ContextItem['notes']) ?? [],
  }
  if (d.objective) i.objective = d.objective as string
  if (d.retired) { i.retired = true; i.retiredAt = d.retiredAt as number }
  return i
}

async function listedItem(tx: Pick<Tx, 'get'>, roomId: string, sha: unknown): Promise<{ ref: string; item: Data }> {
  if (typeof sha !== 'string' || !SHA256.test(sha)) throw new Refusal('sha256 is 64 lowercase hex characters', 400)
  const ref = `rooms/${roomId}/context/${sha}`
  const item = await tx.get(ref)
  if (!item) throw new Refusal('the library lists no such file', 404)
  return { ref, item }
}

/** A post's context list: 1 to 32 items the room lists and has not retired. */
async function contextOf(tx: Pick<Tx, 'get'>, roomId: string, type: string, raw: unknown): Promise<string[]> {
  if (!CARRIES_CONTEXT.has(type)) throw new Refusal(`a ${type} post cannot carry context`, 400)
  if (!Array.isArray(raw) || raw.length === 0) throw new Refusal('context is a non-empty list of sha256s', 400)
  if (raw.length > MAX_CONTEXT_PER_POST) throw new Refusal(`a post names at most ${MAX_CONTEXT_PER_POST} context items`, 400)
  for (const sha of raw) {
    if (typeof sha !== 'string' || !SHA256.test(sha)) throw new Refusal('each context entry is a sha256: 64 lowercase hex characters', 400)
    const item = await tx.get(`rooms/${roomId}/context/${sha}`)
    if (!item) throw new Refusal(`the library lists no file ${sha.slice(0, 12)}; add it first`, 400)
    if (item.retired) throw new Refusal(`the file ${sha.slice(0, 12)} is retired`, 400)
  }
  return raw as string[]
}

export type UploadAnswer = { held: true } | { held: false; uploadUrl: string }

/**
 * A member asks to upload one file: a signed {v:1, type:'context.upload', room, member, sha256, crc32c,
 * size, contentType, name, at, nonce} and no body. The answer is held:true when this room already holds
 * exactly those bytes, else a resumable session in the object store bound to that size, type and crc32c.
 */
export async function requestContextUpload(ctx: Ctx, roomId: string, req: Record<string, unknown>, sig: string): Promise<UploadAnswer> {
  if (!req || typeof req !== 'object' || req.v !== 1 || req.type !== 'context.upload' || req.room !== roomId) throw new Refusal('not a signed v1 context.upload for this room', 401)
  const memberId = String(req.member ?? '')
  const key = memberId ? await ctx.store.get(`memberKeys/${memberId}`) : null
  if (!key || key.retired || key.roomId !== roomId || !verifySigned(key.publicKey as string, req, sig)) throw new Refusal('not signed by a member key of this room', 401)
  checkClock(ctx, req.at)
  if (typeof req.nonce !== 'string' || !NONCE.test(req.nonce)) throw new Refusal('nonce is 16 to 64 base64url characters', 400)
  const m = contextMeta(req)
  const objects = objectsOf(ctx)
  const listed = await ctx.store.transaction(async (tx) => {
    const { room } = await memberOf(tx, { kind: 'agent', roomId, memberId }, roomId)
    requireOpen(room)
    const nonceRef = `rooms/${roomId}/nonces/${memberId}~${req.nonce}`
    if (await tx.get(nonceRef)) throw new Refusal('this upload request was already received', 409)
    const item = await tx.get(`rooms/${roomId}/context/${m.sha256}`)
    if (item?.retired) throw new Refusal('the library retired that file; it is not listed again', 409)
    tx.set(nonceRef, { at: ctx.now() })
    return !!item
  })
  const path = contextPath(roomId, m.sha256)
  const held = await objects.stat(path)
  if (held && held.size === m.size && held.crc32c === m.crc32c) return { held: true }
  // An object at this name that is not these bytes was never listed (an item is listed only on an
  // exact match), so it is a dead upload under a false hash: clear it, so a session can land.
  if (held && !listed) await objects.delete(path)
  return { held: false, uploadUrl: await objects.createResumableSession(path, { size: m.size, contentType: m.contentType, crc32c: m.crc32c }) }
}

/** A signed fetch of one context item: {v:1, type:'context.fetch', room, member, sha256, at, nonce}, naming the hash fetched. */
export async function agentForSignedContextFetch(ctx: Ctx, roomId: string, sha: string, req: Record<string, unknown>, sig: string): Promise<Actor> {
  if (req.sha256 !== sha) throw new Refusal('the signed fetch names another file', 401)
  return agentForSignedRequest(ctx, roomId, req, sig, 'context.fetch')
}

/** The item and a 15-minute signed address for its bytes, to the room's readers; 410 once the bytes are gone. */
export async function fetchContext(ctx: Ctx, actor: Actor, roomId: string, sha: string, opts: { inline?: boolean } = {}): Promise<{ item: ContextItem; downloadUrl: string }> {
  if (!SHA256.test(sha)) throw NOT_FOUND()
  if (actor.kind === 'person') {
    if (!(await ctx.store.get(`rooms/${roomId}`)) || !(await personMayRead(ctx, roomId, actor.person))) throw NOT_FOUND()
  } else {
    await memberOf(ctx.store, actor, roomId)
  }
  const d = await ctx.store.get(`rooms/${roomId}/context/${sha}`)
  if (!d) throw NOT_FOUND()
  const item = itemOf(d)
  if (item.retired) throw new Refusal('that file was retired from the library; its bytes are deleted', 410)
  const room = (await ctx.store.get(`rooms/${roomId}`))!
  if (room.contextPurgedAt) throw new Refusal(`this room closed more than ${HOUSEKEEPING_DECLARATION.housekeeping.afterCloseDays} days ago; its files are deleted and their records kept`, 410)
  const downloadUrl = await objectsOf(ctx).signedReadUrl(contextPath(roomId, sha), CONTEXT_FETCH_MS, { filename: item.name, inline: opts.inline })
  return { item, downloadUrl }
}

/** The host operator closes a room: it refuses writes from then on, and its context bytes go 30 days later. */
export async function closeRoom(ctx: Ctx, roomId: string) {
  await ctx.store.transaction(async (tx) => {
    const room = await tx.get(`rooms/${roomId}`)
    if (!room) throw NOT_FOUND()
    if (room.state === 'closed') return
    const now = ctx.now()
    tx.update(`rooms/${roomId}`, { state: 'closed', closedAt: now })
    emit(tx, roomId, room, now, { type: 'room.closed', by: 'host' })
  })
}

/** Every context byte under one room, deleted (delete-room, and a closed room's purge). */
export async function deleteRoomContext(ctx: Ctx, roomId: string): Promise<number> {
  const objects = objectsOf(ctx)
  const all = await objects.list(contextPrefix(roomId))
  for (const o of all) await objects.delete(o.path)
  return all.length
}

const OBJECT_PATH = /^rooms\/([^/]+)\/context\/([0-9a-f]{64})$/

/**
 * The declared housekeeping, run by the daily cron: a closed room's context bytes go 30 days after it
 * closed (the item records stay with the thread); bytes no context.add claimed go after 7 days; the
 * bytes of a retired item, or of a room that no longer exists, go whenever they are found.
 */
export async function housekeep(ctx: Ctx) {
  const objects = objectsOf(ctx)
  const now = ctx.now()
  const out = { closedRoomsPurged: 0, unclaimedDeleted: 0, retiredDeleted: 0, orphanDeleted: 0 }
  const roomDocs = new Map((await ctx.store.list('rooms')).map((r) => [r.id, r.data]))
  for (const [id, r] of roomDocs) {
    if (r.state === 'closed' && typeof r.closedAt === 'number' && now - r.closedAt > AFTER_CLOSE_MS && !r.contextPurgedAt) {
      await deleteRoomContext(ctx, id)
      await ctx.store.transaction(async (tx) => { tx.update(`rooms/${id}`, { contextPurgedAt: now }) })
      r.contextPurgedAt = now
      out.closedRoomsPurged++
    }
  }
  for (const o of await objects.list('rooms/')) {
    const m = OBJECT_PATH.exec(o.path)
    if (!m) continue
    const [, roomId, sha] = m
    if (!roomDocs.has(roomId)) { await objects.delete(o.path); out.orphanDeleted++; continue }
    const item = await ctx.store.get(`rooms/${roomId}/context/${sha}`)
    if (item?.retired) { await objects.delete(o.path); out.retiredDeleted++ }
    else if (!item && now - o.createdAt > UNCLAIMED_MS) { await objects.delete(o.path); out.unclaimedDeleted++ }
  }
  return out
}
