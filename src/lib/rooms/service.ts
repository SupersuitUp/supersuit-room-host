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
import { checkHandle, verifySig } from '@supersuit/suit-identity'
import { Refusal } from './refusal'
import type { Data, Doc, Store, Tx } from './store'
import { canonical, fingerprint as keyFingerprint, isPublicKey, safetyPhrase, verifySigned } from './signing'
import { ATTACHMENT_TYPES, imageInfo } from './images'
import { CRC32C_B64 } from './crc32c'
import { contextPath, contextPrefix, type ObjectStore } from './object-store'
import { HOUSEKEEPING_DECLARATION } from './housekeeping'
import { checkEvents, type Check } from './checks'
export { HOUSEKEEPING_DECLARATION }
import {
  MAX_MEMBERS, OBJECTIVE_STATUSES,
  type Actor, type Attachment, type Proof, type Said, type ContextItem, type Decision, type Draft, type DraftVersion, type Member, type Objective, type Room, type RoomEvent, type RoomView, type Share,
} from './types'

/**
 * objects is the object store for context bytes (v0.3); a host without one refuses context requests.
 * sleep is the long poll's wait (v0.4), replaced in tests.
 */
export type Ctx = { store: Store; now: () => number; objects?: ObjectStore; sleep?: (ms: number) => Promise<void>; directory?: Directory; audience?: string }

/** The audience a tether-start must name: this host's own origin, so a signed start cannot be replayed elsewhere. */
export const DEFAULT_AUDIENCE = 'https://rooms.supersuit.co'
/**
 * A handle person's key: "@" and the suit handle. addPerson keys cannot start with "@", so a handle never
 * lands on a person the host operator made with an email (review finding 2, 2026-11-07).
 */
export const handlePerson = (handle: string) => `@${handle}`
/** A suit's verified keys, from the public directory (v0.4); null when no suit holds the handle. */
export type Directory = (handle: string) => Promise<{ suit: string; keys: string[] } | null>
const directoryOf = (ctx: Ctx): Directory => {
  if (!ctx.directory) throw new Error('this host has no suit directory configured')
  return ctx.directory
}
export type { ContextItem }
/** Who may invite: the host operator (scripts/admin.ts) or a member Pluma. Never a person directly. */
export type Inviter = 'operator' | Actor

/** The longest an invite lasts (v0.4): 14 days, for an invite sent through S2S. The default is 24 hours. */
export const MAX_INVITE_HOURS = 336
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

// Members in the order they joined. A member written before joinedSeq existed (2026-10-17) sorts after
// the rest, by id, which is the order Firestore gave every member until then.
const joinOrder = (d: Data) => (typeof d.joinedSeq === 'number' ? d.joinedSeq : Infinity)
const byJoin = (a: Doc, b: Doc) => joinOrder(a.data) - joinOrder(b.data) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)

async function activeMemberCount(ctx: Ctx, roomId: string) {
  return (await ctx.store.list(`rooms/${roomId}/members`)).filter((m) => isAgentMember(m.data) && !m.data.retired).length
}

/**
 * A one-time door for one named member, open 24 hours unless it asks for up to 336 (v0.4). The code is
 * shown once; only its digest is kept.
 */
export async function createInvite(ctx: Ctx, by: Inviter, roomId: string, p: { name: string; answersTo: string; test?: boolean; ttlHours?: number; handle?: string; personName?: string; nonceRef?: string }): Promise<{ code: string }> {
  // Only a handle invite names a handle person, and its joiner must prove the suit (review finding 1).
  if (!p.handle && p.answersTo.startsWith('@')) throw new Refusal('a handle person is invited by handle', 400)
  const ttl = Math.min(Math.max(Number(p.ttlHours) || 24, 1), MAX_INVITE_HOURS) * 3_600_000
  const code = randomBytes(16).toString('hex') // hex: a base64url code can start with '-', which a CLI reads as a flag
  await ctx.store.transaction(async (tx) => {
    let room: Data | null
    let inviter = 'host'
    let inviterProven = false
    if (by === 'operator') {
      room = await tx.get(`rooms/${roomId}`)
      if (!room) throw NOT_FOUND()
    } else {
      const m = await memberOf(tx, by, roomId)
      room = m.room
      inviter = m.member.id
      // A member invites a Pluma only for its own person; the host operator may name anyone (second review, finding 1).
      if (!p.handle && p.answersTo !== m.member.answersTo) throw new Refusal('a Pluma invites another Pluma only for its own person', 403)
      inviterProven = m.member.proven === true
    }
    requireOpen(room)
    if (!p.handle) await personName(tx, p.answersTo)
    // A replayed invite post mints nothing (review finding 6): its nonce is kept in this transaction.
    if (p.nonceRef && (await tx.get(p.nonceRef))) throw new Refusal('this post was already received', 409)
    if (p.nonceRef) tx.set(p.nonceRef, { at: ctx.now() })
    // proven: the host operator named the person, a proven member asked for a second Pluma of its own
    // person, or the joiner must sign with the person's suit key (a handle invite).
    const invite: Data = {
      roomId, name: text(p.name, 'member name', 80), answersTo: p.answersTo, test: p.test === true,
      createdBy: inviter, expiresAt: ctx.now() + ttl, redeemedAt: null, proven: (by === 'operator' && p.test !== true) || inviterProven || !!p.handle,
    }
    // A handle invite names no one: the person's name comes from their own suit-signed join (second review, finding 2).
    if (p.handle) invite.handle = p.handle
    tx.set(`invites/${sha256(code)}`, invite)
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
  // v0.4: a handle invite is redeemed only with the suit's signature over the join (review finding 1).
  if (pre?.handle) {
    const { suitSig, ...bare } = req
    const suit = await directoryOf(ctx)(pre.handle as string)
    if (!suit || !suit.keys.some((k) => verifySig(bare, suitSig, k))) throw new Refusal('a handle invite needs the suit key of that handle to sign the join', 401)
  }
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
    if (invite.handle && invite.handle !== pre?.handle) throw NOT_FOUND()
    const person = invite.handle ? await tx.get(`people/${invite.answersTo}`) : null
    const joinName = req.personName === undefined ? (invite.handle as string) : text(req.personName, "the person's name", 80)
    const answersToName = invite.handle ? ((person?.name as string | undefined) ?? joinName) : await personName(tx, invite.answersTo as string)
    const now = ctx.now()
    if (invite.handle && !person) tx.set(`people/${invite.answersTo}`, { name: answersToName, emailDigests: [], handle: invite.handle })
    tx.update(inviteRef, { redeemedAt: now })
    tx.set(`memberKeys/${memberId}`, { roomId, publicKey: req.publicKey })
    const joinedSeq = emit(tx, roomId, room, now, { type: 'member.joined', by: memberId, member: memberId, name: invite.name as string, phrase })
    // Firestore lists documents by id, and member ids are random, so join order is kept on the member.
    const member: Data = { kind: 'agent', name: invite.name, answersTo: invite.answersTo, answersToName, publicKey: req.publicKey, fingerprint: fp, phrase, lastSeenAt: now, joinedSeq }
    if (invite.test) member.test = true
    if (invite.proven === true) member.proven = true
    tx.set(`rooms/${roomId}/members/${memberId}`, member)
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

/**
 * Whether a person may read: one of the room's active Plumas answers to them, and, for a session from a
 * reader link, the room is the one the link was for (review finding 1).
 */
async function personMayRead(ctx: Ctx, roomId: string, person: string, onlyRoom?: string): Promise<boolean> {
  if (onlyRoom && onlyRoom !== roomId) return false
  const members = await ctx.store.list(`rooms/${roomId}/members`)
  return members.some((m) => isAgentMember(m.data) && !m.data.retired && m.data.answersTo === person)
}

export async function read(ctx: Ctx, actor: Actor, roomId: string, after: number): Promise<RoomView> {
  let you: string
  if (actor.kind === 'person') {
    if (!(await ctx.store.get(`rooms/${roomId}`)) || !(await personMayRead(ctx, roomId, actor.person, actor.room))) throw NOT_FOUND()
    you = `reader:${actor.person}`
  } else {
    const { member } = await memberOf(ctx.store, actor, roomId)
    await ctx.store.transaction(async (tx) => { tx.update(`rooms/${roomId}/members/${member.id}`, { lastSeenAt: ctx.now() }) })
    you = member.id
  }
  const room = (await ctx.store.get(`rooms/${roomId}`))!
  const [members, objectives, drafts, events, library, shares] = await Promise.all([
    ctx.store.list(`rooms/${roomId}/members`),
    ctx.store.list(`rooms/${roomId}/objectives`, { orderBy: 'createdAt' }),
    ctx.store.list(`rooms/${roomId}/drafts`, { orderBy: 'createdAt' }),
    ctx.store.list(`rooms/${roomId}/events`, { after: { field: 'seq', value: Number(after) || 0 }, orderBy: 'seq', limit: 500 }),
    ctx.store.list(`rooms/${roomId}/context`, { orderBy: 'at' }),
    ctx.store.list(`rooms/${roomId}/shares`, { orderBy: 'at' }),
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
    members: members.filter((m) => isAgentMember(m.data)).sort(byJoin).map(({ id, data: { joinedSeq: _, ...rest } }) => ({ id, ...rest }) as unknown as Member),
    objectives: objectives.map((o) => ({ id: o.id, ...o.data }) as unknown as Objective),
    drafts: fullDrafts,
    events: evs,
    context: library.map((c) => itemOf(c.data)),
    shares: shares.map((s) => ({ id: s.id, ...s.data }) as unknown as Share),
    cursor: evs.length ? evs[evs.length - 1].seq : Math.max(Number(after) || 0, 0),
    you,
  }
}

export const WAIT_MAX_SECONDS = 25
const POLL_MS = 1_500

/**
 * The long poll (v0.4). Waits until the room moves past `after`, closes, or the wait ends. It reads
 * one document through the Store contract, every 1.5 seconds, because the contract has no watch.
 */
/** Long polls one member may hold at once on one instance (review finding 9). A wait past this answers at once. */
export const MAX_WAITS_PER_MEMBER = 2
/** Long polls one person (one suit, for a tether) may hold at once across all their rooms (second review, finding 4). */
export const MAX_WAITS_PER_PERSON = 4
/** Seconds a capped long poll asks the client to wait before it asks again. */
export const WAIT_RETRY_SECONDS = 5
const waiting = new Map<string, number>()
const hold = (key: string, d: number) => { const n = (waiting.get(key) ?? 0) + d; if (n > 0) waiting.set(key, n); else waiting.delete(key) }

export async function waitForNews(ctx: Ctx, roomId: string, after: number, waitSeconds: number, signal?: AbortSignal, memberId = ''): Promise<{ capped: true; retryAfter: number } | undefined> {
  const m = memberId ? await ctx.store.get(`rooms/${roomId}/members/${memberId}`) : null
  const keys = [`m:${roomId}~${memberId}`, `p:${String(m?.answersTo ?? `${roomId}~${memberId}`)}`]
  const caps = [MAX_WAITS_PER_MEMBER, MAX_WAITS_PER_PERSON]
  if (keys.some((k, i) => (waiting.get(k) ?? 0) >= caps[i])) return { capped: true, retryAfter: WAIT_RETRY_SECONDS }
  keys.forEach((k) => hold(k, 1))
  try { await waitLoop(ctx, roomId, after, waitSeconds, signal) } finally { keys.forEach((k) => hold(k, -1)) }
  return undefined
}

async function waitLoop(ctx: Ctx, roomId: string, after: number, waitSeconds: number, signal?: AbortSignal): Promise<void> {
  const seconds = Math.min(Math.max(Number(waitSeconds) || 0, 0), WAIT_MAX_SECONDS)
  const polls = Math.ceil((seconds * 1000) / POLL_MS)
  const sleep = ctx.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)))
  for (let i = 0; i < polls; i++) {
    const room = await ctx.store.get(`rooms/${roomId}`)
    if (!room || (room.seq as number) > after || room.state !== 'open' || signal?.aborted) return
    await sleep(POLL_MS)
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
const CARRIES_ATTACHMENTS = new Set(['message', 'step', 'draft', 'draft.version', 'decision'])

/** The person a member speaks for. A Pluma decides, drafts and sets objectives only for this person. */
const humanOf = (m: Member) => m.answersTo

const MAX_PROOF = 8
/** A step's proof (v0.4): 1 to 8 items, each a label and an optional https address. */
function proofOf(raw: unknown): Proof[] | undefined {
  if (raw === undefined) return undefined
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > MAX_PROOF) throw new Refusal(`proof is a list of 1 to ${MAX_PROOF} items`, 400)
  return raw.map((p) => {
    const r = (p ?? {}) as Record<string, unknown>
    const label = text(r.label, 'a proof label', 200)
    if (r.href === undefined) return { label }
    if (typeof r.href !== 'string' || !/^https:\/\//.test(r.href) || r.href.length > 2000) throw new Refusal('a proof href is an https address', 400)
    return { label, href: r.href }
  })
}

/** A person's exact words and when they said them, carried by their own Pluma (v0.4). */
function saidOf(raw: unknown, now: number): Said | undefined {
  if (raw === undefined) return undefined
  const r = (raw ?? {}) as Record<string, unknown>
  const words = text(r.words, "the person's words", 4000)
  const t = typeof r.saidAt === 'string' ? Date.parse(r.saidAt) : NaN
  if (!Number.isFinite(t) || !/^\d{4}-\d\d-\d\dT/.test(String(r.saidAt))) throw new Refusal('saidAt is the ISO time the person said it', 400)
  if (t > now + CLOCK_MS) throw new Refusal('saidAt is in the future', 400)
  return { words, saidAt: r.saidAt as string }
}

/** The entries a post reverses (v0.4): 1 to 32 seqs that exist in this log. Read before any write. */
async function reversesOf(tx: Pick<Tx, 'get'>, roomId: string, raw: unknown): Promise<number[] | undefined> {
  if (raw === undefined) return undefined
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > 32) throw new Refusal('reverses is a list of 1 to 32 entries', 400)
  for (const seq of raw) {
    if (!Number.isSafeInteger(seq) || !(await tx.get(`rooms/${roomId}/events/${pad(seq)}`))) throw new Refusal(`there is no entry ${String(seq)} to reverse`, 400)
  }
  return raw as number[]
}

/** What still works after a room closes (v0.4): taking something back, and sharing or revoking a page. */
const WORKS_AFTER_CLOSE = new Set(['redact', 'share.request', 'share.approve', 'share.revoke'])
/** The events an author may take back. Bookkeeping says nothing a person could regret. */
const REDACTABLE = new Set(['message', 'step', 'draft.version', 'decision'])

/** The title a draft's later version entries repeat, cleared once its first version is taken back. */
async function clearDraftTitle(ctx: Ctx, roomId: string, draft: string) {
  const events = await ctx.store.list(`rooms/${roomId}/events`, { orderBy: 'seq' })
  const repeats = events.filter((e) => e.data.type === 'draft.version' && e.data.draft === draft && e.data.title)
  if (!repeats.length) return
  await ctx.store.transaction(async (tx) => { for (const e of repeats) tx.update(`rooms/${roomId}/events/${e.id}`, { title: '' }) })
}

/** The bytes of attachments that no remaining event names. Runs after the commit that removed the post. */
async function releaseAttachments(ctx: Ctx, roomId: string, shas: string[]) {
  if (!shas.length) return
  const events = await ctx.store.list(`rooms/${roomId}/events`, { orderBy: 'seq' })
  const named = new Set(events.flatMap((e) => ((e.data.attachments as Attachment[] | undefined) ?? []).map((a) => a.sha256)))
  for (const sha of shas) {
    if (named.has(sha)) continue
    const ref = `rooms/${roomId}/attachments/${sha}`
    const chunks = await ctx.store.list(`${ref}/chunks`)
    await ctx.store.transaction(async (tx) => {
      for (const c of chunks) tx.delete(`${ref}/chunks/${c.id}`)
      tx.delete(ref)
    })
  }
}

/** Words and choices that speak for a person need a Pluma whose person is proven (second review, finding 1). */
function requireProven(member: Member, what: string) {
  if (!member.proven) throw new Refusal(`${what} needs a Pluma whose person is proven by a suit key or the host operator`, 403)
}

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
    requireProven(member, 'an objective')
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

  /** The intent changes forward: the old wording and the reason stay on the record. Only the owner's own Pluma. */
  async 'objective.amend'(tx, { roomId, room, member, post, sig, now }) {
    requireProven(member, 'a change to an objective')
    const oid = String(post.objective ?? '')
    const ref = `rooms/${roomId}/objectives/${oid}`
    const o = await tx.get(ref)
    if (!o) throw new Refusal('no such objective', 404)
    if (o.owner !== humanOf(member)) throw new Refusal("only the owner's own Pluma changes an intent", 403)
    const reason = text(post.reason, 'the reason for the change', 2000)
    const title = post.title === undefined ? undefined : text(post.title, 'title', 200)
    const done = post.done === undefined ? undefined : text(post.done, 'definition of done', 2000)
    if (title === undefined && done === undefined) throw new Refusal('give a new title, a new definition of done, or both', 400)
    const from = { title: o.title as string, done: o.done as string }
    const amended = [...((o.amended as unknown[] | undefined) ?? []), { ...from, reason, by: member.id, at: now }]
    tx.update(ref, { ...(title ? { title } : {}), ...(done ? { done } : {}), amended, updatedAt: now })
    emit(tx, roomId, room, now, { type: 'objective.amended', by: member.id, objective: oid, from, title, done, reason, post, sig })
    return { objective: oid }
  },

  /** What a Pluma did, its proof, and whose move is next. A person's words ride in `said`, carried by their own Pluma. */
  async step(tx, { roomId, room, member, post, sig, now, attachments, context }) {
    const body = text(post.text, 'step')
    if (post.said !== undefined) requireProven(member, "a person's words")
    if (post.next !== undefined && !isAgentMember(await tx.get(`rooms/${roomId}/members/${post.next}`))) throw new Refusal('that member is not in this room', 400)
    if (post.objective !== undefined && !(await tx.get(`rooms/${roomId}/objectives/${post.objective}`))) throw new Refusal('no such objective', 400)
    const reverses = await reversesOf(tx, roomId, post.reverses)
    const seq = emit(tx, roomId, room, now, {
      type: 'step', by: member.id, text: body, proof: proofOf(post.proof), next: optString(post.next), said: saidOf(post.said, now), reverses,
      objective: optString(post.objective), attachments, context, post, sig,
    })
    return { seq }
  },

  async draft(tx, { roomId, room, member, post, sig, now, attachments, context }) {
    requireProven(member, 'a draft')
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
    requireProven(member, 'a draft')
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
    requireProven(member, 'a decision')
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
    // v0.4: what was turned down and why, and the entries this decision reverses.
    const rejected = optText(post.rejected, 'what was rejected', 2000)
    const reason = optText(post.reason, 'the reason', 2000)
    const reverses = await reversesOf(tx, roomId, post.reverses)
    const id = newId('dc')
    tx.set(`rooms/${roomId}/drafts/${did}/decisions/${id}`, withAttachments({ draft: did, version: post.version, fingerprint: post.fingerprint, verdict: post.verdict, words, saidAt: post.saidAt, by: member.id, at: now, ...(rejected ? { rejected } : {}), ...(reason ? { reason } : {}) }, attachments, context))
    emit(tx, roomId, room, now, { type: 'decision', by: member.id, draft: did, version: post.version as number, fingerprint: post.fingerprint as string, verdict: post.verdict, words, saidAt: post.saidAt as string, owner: d.owner as string, decisionId: id, rejected, reason, reverses, attachments, context, post, sig })
    return { decision: id }
  },

  /** Any member closes a tether (v0.4). The text stays, so both operators can still read the log. */
  async 'room.close'(tx, { roomId, room, member, post, sig, now }) {
    tx.update(`rooms/${roomId}`, { state: 'closed', closedAt: now })
    emit(tx, roomId, room, now, { type: 'room.closed', by: member.id, post, sig })
    return { closed: true }
  },

  /**
   * Only a post's author takes it back (v0.4). The event keeps its seq, type, author and time, and loses
   * its text, its signed post and its signature, because a signature cannot outlive the words it covers.
   * The new `redact` event says that a redaction happened, by whom and when, and nothing of what went.
   */
  async redact(tx, { ctx, roomId, room, member, post, sig, now, afterCommit }) {
    const target = Number(post.target)
    if (!Number.isSafeInteger(target)) throw new Refusal('target is the seq of the post to take back', 400)
    const ref = `rooms/${roomId}/events/${pad(target)}`
    const e = await tx.get(ref)
    if (!e) throw new Refusal('there is no such entry', 404)
    if (e.by !== member.id) throw new Refusal('only the Pluma that wrote a post takes it back', 403)
    if (!REDACTABLE.has(e.type as string)) throw new Refusal(`a ${String(e.type)} entry cannot be taken back`, 400)
    if (e.redacted) throw new Refusal('that post was already taken back', 409)
    const versionRef = e.type === 'draft.version' ? `rooms/${roomId}/drafts/${e.draft}/versions/${e.version}` : null
    const version = versionRef ? await tx.get(versionRef) : null
    const decisionRef = e.type === 'decision' && e.decisionId ? `rooms/${roomId}/drafts/${e.draft}/decisions/${e.decisionId}` : null
    const decision = decisionRef ? await tx.get(decisionRef) : null
    // The draft post carried the title with version 1, so taking it back takes the title too (finding 8).
    const draftRef = e.type === 'draft.version' && e.version === 1 ? `rooms/${roomId}/drafts/${e.draft}` : null
    const draftDoc = draftRef ? await tx.get(draftRef) : null
    const shas = ((e.attachments as Attachment[] | undefined) ?? []).map((a) => a.sha256)
    const redacted = { by: member.id, at: now }
    tx.set(ref, { seq: e.seq as number, type: e.type as string, by: e.by as string, at: e.at as number, redacted })
    if (versionRef && version) tx.set(versionRef, { n: version.n as number, text: '', fingerprint: version.fingerprint as string, by: version.by as string, at: version.at as number, redacted })
    // A taken-back decision keeps no verdict, so nothing reads it as an approval (review finding 4).
    if (decisionRef && decision) tx.set(decisionRef, { draft: decision.draft as string, version: decision.version as number, fingerprint: decision.fingerprint as string, words: '', saidAt: decision.saidAt as string, by: decision.by as string, at: decision.at as number, redacted })
    if (draftRef && draftDoc) tx.update(draftRef, { title: '' })
    const seq = emit(tx, roomId, room, now, { type: 'redact', by: member.id, target, post, sig })
    afterCommit.push(() => releaseAttachments(ctx, roomId, shas))
    if (draftRef) afterCommit.push(() => clearDraftTitle(ctx, roomId, e.draft as string))
    return { seq }
  },

  // ---- read-only pages (v0.4) ----

  /** Any member asks for a page of the log up to one entry. The asking counts as that person's yes. */
  async 'share.request'(tx, { ctx, roomId, room, member, post, sig, now }) {
    const upTo = Number(post.upTo)
    if (!Number.isSafeInteger(upTo) || upTo < 1 || upTo > (room.seq as number)) throw new Refusal('upTo is a seq in this log', 400)
    const members = await ctx.store.list(`rooms/${roomId}/members`)
    const need = [...new Set(members.filter((m) => isAgentMember(m.data) && !m.data.retired && !m.data.test).map((m) => m.data.answersTo as string))]
    const id = newId('s')
    // A yes counts only from a Pluma whose person is proven, and that was a member when the share was asked for (finding 3).
    const s: Data = { upTo, by: member.id, at: now, need, yes: member.proven ? [humanOf(member)] : [], status: 'waiting', requestedSeq: room.seq as number }
    emit(tx, roomId, room, now, { type: 'share.requested', by: member.id, share: id, upTo, post, sig })
    return settleShare(tx, roomId, room, now, id, s, member, post, sig)
  },

  /** A person the share needs says yes, once, through their own Pluma. */
  async 'share.approve'(tx, { roomId, room, member, post, sig, now }) {
    const id = String(post.share ?? '')
    const s = await tx.get(`rooms/${roomId}/shares/${id}`)
    if (!s) throw new Refusal('no such share', 404)
    if (s.status !== 'waiting') throw new Refusal(`that share is ${String(s.status)}`, 409)
    const who = humanOf(member)
    if (!member.proven) throw new Refusal('a yes needs a Pluma whose person is proven by a suit key or the host operator', 403)
    const joined = member.joinedSeq
    if (typeof joined !== 'number' || joined > (s.requestedSeq as number)) throw new Refusal('a Pluma that joined after the share was asked for cannot say yes to it', 403)
    if (!(s.need as string[]).includes(who)) throw new Refusal('that share does not need this person', 403)
    if ((s.yes as string[]).includes(who)) throw new Refusal('this person already said yes', 409)
    emit(tx, roomId, room, now, { type: 'share.approved', by: member.id, share: id, post, sig })
    return settleShare(tx, roomId, room, now, id, { ...s, yes: [...(s.yes as string[]), who] }, member, post, sig)
  },

  /** Any member turns a page off. Its link then shows nothing. */
  async 'share.revoke'(tx, { roomId, room, member, post, sig, now }) {
    const id = String(post.share ?? '')
    const ref = `rooms/${roomId}/shares/${id}`
    const s = await tx.get(ref)
    if (!s) throw new Refusal('no such share', 404)
    if (s.status === 'revoked') throw new Refusal('that share is already revoked', 409)
    const { token: live, ...rest } = s
    if (live) tx.delete(`shareTokens/${sha256(live as string)}`)
    tx.set(ref, { ...rest, status: 'revoked' })
    emit(tx, roomId, room, now, { type: 'share.revoked', by: member.id, share: id, post, sig })
    return { share: id, status: 'revoked' }
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
    // v0.4: an invite may name a suit handle. The person is made only when a join proves that suit.
    const handle = optString(post.handle)
    await memberOf(ctx.store, { kind: 'agent', roomId, memberId }, roomId)
    if (handle && (!checkHandle(handle).ok || !(await directoryOf(ctx)(handle)))) throw new Refusal('no suit holds that handle', 400)
    const { code } = await createInvite(ctx, { kind: 'agent', roomId, memberId }, roomId, {
      name: String(post.name ?? ''), answersTo: handle ? handlePerson(handle) : String(post.answersTo ?? ''), ttlHours: Number(post.ttlHours) || undefined,
      handle, nonceRef: `rooms/${roomId}/nonces/${memberId}~${post.nonce}`,
    })
    return { code }
  }
  if (type === 'reader.link') {
    // v0.4: a one-time link that gives the member's own person a session, with no email on this host.
    const token = randomBytes(32).toString('base64url')
    await ctx.store.transaction(async (tx) => {
      const { member } = await memberOf(tx, { kind: 'agent', roomId, memberId }, roomId)
      // Only a member whose person is proven gets a session for that person (review finding 1).
      if (!member.proven) throw new Refusal('a reader link needs a Pluma whose person is proven by a suit key or the host operator', 403)
      const nonceRef = `rooms/${roomId}/nonces/${memberId}~${post.nonce}`
      if (await tx.get(nonceRef)) throw new Refusal('this post was already received', 409)
      tx.set(nonceRef, { at: ctx.now() })
      tx.set(`readerLinks/${sha256(token)}`, { person: member.answersTo, roomId, expiresAt: ctx.now() + READER_LINK_MS, usedAt: null })
    })
    return { path: `/open/${token}` }
  }
  const handler = HANDLERS[type]
  if (!handler) throw new Refusal(`unknown post type: ${type}`, 400)
  let after: (() => Promise<void>)[] = []
  const out = await ctx.store.transaction(async (tx) => {
    const { room, member } = await memberOf(tx, { kind: 'agent', roomId, memberId }, roomId)
    if (!WORKS_AFTER_CLOSE.has(type)) requireOpen(room)
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
  // A taken-back version approves nothing, and only a proven member's decision counts (second review, findings 1 and 3).
  if (!latest || latest.redacted) return false
  return d.decisions.some((x) => !x.redacted && x.verdict === 'approve' && x.version === d.latest && x.fingerprint === latest.fingerprint
    && (!members || members.some((m) => m.id === x.by && m.answersTo === d.owner && m.proven === true)))
}

// ---- human sessions (no signing secret: a random token whose digest is the record) ----

export const SESSION_MS = 30 * 86_400_000

/** room binds a session to one room: a reader link's session reads that room and no other (v0.4). */
export async function createSession(ctx: Ctx, person: string, room?: string): Promise<string> {
  const token = randomBytes(32).toString('base64url')
  await ctx.store.transaction(async (tx) => { tx.set(`sessions/${sha256(token)}`, { person, expiresAt: ctx.now() + SESSION_MS, ...(room ? { room } : {}) }) })
  return token
}

/** The person a session is for, and the one room it is bound to, if any. */
export async function sessionFor(ctx: Ctx, token: string | undefined): Promise<{ person: string; room?: string } | null> {
  if (!token) return null
  const s = await ctx.store.get(`sessions/${sha256(token)}`)
  if (!s || (s.expiresAt as number) < ctx.now()) return null
  return s.room ? { person: s.person as string, room: s.room as string } : { person: s.person as string }
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
export async function roomsFor(ctx: Ctx, person: string, onlyRoom?: string): Promise<{ id: string; name: string; state: string }[]> {
  const out: { id: string; name: string; state: string }[] = []
  for (const r of await ctx.store.list('rooms')) {
    if (await personMayRead(ctx, r.id, person, onlyRoom)) out.push({ id: r.id, name: r.data.name as string, state: r.data.state as string })
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
    if (!(await ctx.store.get(`rooms/${roomId}`)) || !(await personMayRead(ctx, roomId, actor.person, actor.room))) throw NOT_FOUND()
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
    if (!(await ctx.store.get(`rooms/${roomId}`)) || !(await personMayRead(ctx, roomId, actor.person, actor.room))) throw NOT_FOUND()
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

// ---- tethers (v0.4): a room a Pluma opens under its operator's suit key ----

const READER_LINK_MS = 7 * 86_400_000
export const MAX_STARTS_PER_HOUR = 20

/**
 * Open a tether. The body is an entry signed with the operator's suit key, checked against the key log in
 * the public directory, so the host learns who is asking without storing a secret or an email. It carries
 * the public half of a member key made on the operator's own computer, so the room and its first member
 * land together.
 */
export async function startTether(ctx: Ctx, entry: Record<string, unknown>) {
  const { sig, ...p } = entry
  if (p.op !== 'tether-start') throw new Refusal('not a tether-start', 400)
  // The start names this host, so a start signed for another host is refused here (review finding 10).
  if (p.aud !== (ctx.audience ?? DEFAULT_AUDIENCE)) throw new Refusal(`a tether-start names this host as aud: ${ctx.audience ?? DEFAULT_AUDIENCE}`, 401)
  checkClock(ctx, p.at)
  if (typeof p.nonce !== 'string' || !NONCE.test(p.nonce)) throw new Refusal('nonce is 16 to 64 base64url characters', 400)
  if (!isPublicKey(p.publicKey)) throw new Refusal('publicKey is not an Ed25519 public key (base64url, 32 bytes)', 400)
  const handle = String(p.handle ?? '')
  const signedBy = checkHandle(handle).ok ? await directoryOf(ctx)(handle) : null
  if (!signedBy || !signedBy.keys.some((k) => verifySig(p, sig, k))) throw new Refusal('that is not a key of this suit', 401)
  const personName = text(p.personName, "the person's name", 80)
  const memberName = text(p.memberName, 'member name', 80)
  const name = text(p.name, 'tether name', 120)
  const roomId = newId('r')
  const memberId = newId('a-')
  const fp = keyFingerprint(p.publicKey)
  const phrase = safetyPhrase(fp)
  const now = ctx.now()
  const key = handlePerson(handle)
  await ctx.store.transaction(async (tx) => {
    const nonceRef = `tetherNonces/${handle}~${p.nonce}`
    if (await tx.get(nonceRef)) throw new Refusal('this start was already received', 409)
    const person = await tx.get(`people/${key}`)
    // One suit opens at most MAX_STARTS_PER_HOUR tethers an hour (second review, finding 4).
    const rateRef = `tetherStarts/${handle}`
    const recent = (((await tx.get(rateRef))?.times as number[] | undefined) ?? []).filter((t) => t > now - 3_600_000)
    if (recent.length >= MAX_STARTS_PER_HOUR) throw new Refusal(`a suit opens at most ${MAX_STARTS_PER_HOUR} tethers an hour`, 429, Math.ceil((recent[0] + 3_600_000 - now) / 1000))
    tx.set(rateRef, { times: [...recent, now] })
    // The suit names its own person, and a later start may rename it (second review, finding 2).
    if (!person) tx.set(`people/${key}`, { name: personName, emailDigests: [], handle })
    else if (person.name !== personName) tx.update(`people/${key}`, { name: personName })
    tx.set(nonceRef, { at: now })
    tx.set(`rooms/${roomId}`, { name, state: 'open', tether: true, createdBy: key, createdAt: now, seq: 2 })
    tx.set(`rooms/${roomId}/events/${pad(1)}`, { seq: 1, type: 'room.created', by: 'host', at: now, name })
    tx.set(`rooms/${roomId}/events/${pad(2)}`, { seq: 2, type: 'member.joined', by: memberId, member: memberId, name: memberName, phrase, at: now })
    tx.set(`memberKeys/${memberId}`, { roomId, publicKey: p.publicKey })
    tx.set(`rooms/${roomId}/members/${memberId}`, { kind: 'agent', name: memberName, answersTo: key, answersToName: personName, publicKey: p.publicKey, fingerprint: fp, phrase, lastSeenAt: now, joinedSeq: 2, proven: true })
  })
  return { roomId, memberId, name: memberName, fingerprint: fp, phrase, person: key, handle }
}

/** Spend a one-time reader link: a 30-day session for the person it was made for. Used, expired or unknown: null. */
export async function redeemReaderLink(ctx: Ctx, token: string): Promise<{ session: string; roomId: string } | null> {
  const ref = `readerLinks/${sha256(token)}`
  const link = await ctx.store.transaction(async (tx) => {
    const l = await tx.get(ref)
    if (!l || l.usedAt || (l.expiresAt as number) < ctx.now()) return null
    tx.update(ref, { usedAt: ctx.now() })
    return l
  })
  if (!link) return null
  return { session: await createSession(ctx, link.person as string, link.roomId as string), roomId: link.roomId as string }
}

/** The whole log for a reader (v0.4): the view, every event past the 500 one read returns, and the host's checks. */
export async function readLog(ctx: Ctx, actor: Actor, roomId: string) {
  const view = await read(ctx, actor, roomId, 0)
  const events = await allEvents(ctx, roomId)
  return { ...view, events, checks: checkEvents(events, view.members) }
}

/** Every event of a room, past the 500 one read returns, up to `upTo` when it is given. */
export async function allEvents(ctx: Ctx, roomId: string, upTo = Infinity): Promise<RoomEvent[]> {
  const out: RoomEvent[] = []
  for (let after = 0; ;) {
    const page = await ctx.store.list(`rooms/${roomId}/events`, { after: { field: 'seq', value: after }, orderBy: 'seq', limit: 500 })
    for (const d of page) if ((d.data.seq as number) <= upTo) out.push(d.data as unknown as RoomEvent)
    if (page.length < 500 || (page.at(-1)!.data.seq as number) >= upTo) return out
    after = page.at(-1)!.data.seq as number
  }
}

// ---- read-only pages (v0.4): live only on every operator's yes ----

/**
 * A share goes live when every person it needs has said yes. The page reads the live record up to
 * `upTo`. emit can run twice in one transaction: each call advances room.seq in memory.
 */
function settleShare(tx: Tx, roomId: string, room: Data, now: number, id: string, s: Data, member: Member, post: Record<string, unknown>, sig: string) {
  const need = s.need as string[], yes = s.yes as string[]
  if (!need.every((p) => yes.includes(p))) { tx.set(`rooms/${roomId}/shares/${id}`, s); return { share: id, status: 'waiting' } }
  const token = randomBytes(32).toString('base64url')
  tx.set(`shareTokens/${sha256(token)}`, { roomId, share: id })
  tx.set(`rooms/${roomId}/shares/${id}`, { ...s, status: 'live', token })
  emit(tx, roomId, room, now, { type: 'share.live', by: member.id, share: id, upTo: s.upTo as number, post, sig })
  return { share: id, status: 'live', token }
}

const SHOWN_ON_A_SHARE = new Set(['step', 'decision', 'objective.created', 'objective.amended', 'objective.moved', 'room.closed', 'redact'])
export type SharedRoom = { room: Pick<Room, 'id' | 'name' | 'state' | 'createdAt'>; members: Member[]; objectives: Objective[]; events: RoomEvent[]; checks: Record<number, Check> }

/** The objectives as the events up to some point made them: created, amended and moved, in order. */
function objectivesAt(events: RoomEvent[]): Objective[] {
  const out = new Map<string, Objective>()
  for (const e of events) {
    const id = String(e.objective ?? '')
    const p = (e.post ?? {}) as Record<string, unknown>
    if (e.type === 'objective.created') out.set(id, { id, title: String(e.title ?? p.title ?? ''), owner: String(e.owner ?? p.owner ?? ''), done: String(p.done ?? ''), status: 'open', updatedAt: e.at })
    const o = out.get(id)
    if (!o) continue
    if (e.type === 'objective.amended') {
      o.amended = [...(o.amended ?? []), { title: o.title, done: o.done, reason: String(e.reason ?? ''), by: e.by, at: e.at }]
      if (typeof e.title === 'string') o.title = e.title
      if (typeof e.done === 'string') o.done = e.done
      o.updatedAt = e.at
    }
    if (e.type === 'objective.moved') { o.status = e.status as Objective['status']; o.updatedAt = e.at }
  }
  return [...out.values()]
}

/** The page behind a share token: the intent, the entries and the decisions, and nothing a stranger should hold. */
export async function readShare(ctx: Ctx, token: string): Promise<SharedRoom | null> {
  const t = await ctx.store.get(`shareTokens/${sha256(token)}`)
  if (!t) return null
  const roomId = t.roomId as string
  const [room, s] = await Promise.all([ctx.store.get(`rooms/${roomId}`), ctx.store.get(`rooms/${roomId}/shares/${t.share}`)])
  if (!room || s?.status !== 'live') return null
  const [members, events] = await Promise.all([ctx.store.list(`rooms/${roomId}/members`), allEvents(ctx, roomId, s.upTo as number)])
  // Everything below is the log as it stood at upTo, built from its events: later members, later
  // objectives and later wordings stay out (review finding 5).
  // A share shows only what a proven, non-test member wrote for a person who said yes to it. A stand-in,
  // or a retired member whose person was never asked, is left out (second review, finding 7).
  const yes = new Set(s.yes as string[])
  const speaks = new Set(members.filter((m) => isAgentMember(m.data) && m.data.proven === true && !m.data.test && yes.has(m.data.answersTo as string)).map((m) => m.id))
  const kept = events.filter((e) => e.by === 'host' || speaks.has(e.by))
  const joined = new Set(events.filter((e) => e.type === 'member.joined').map((e) => e.member as string))
  const shown = kept.filter((e) => SHOWN_ON_A_SHARE.has(e.type))
  const people = members.filter((m) => speaks.has(m.id) && joined.has(m.id)).sort(byJoin).map(({ id, data }) => ({ id, ...data }) as unknown as Member)
  const checks = checkEvents(shown, people)
  const created = events.find((e) => e.type === 'room.created')
  return {
    room: { id: roomId, name: String(created?.name ?? room.name), state: events.some((e) => e.type === 'room.closed') ? 'closed' : 'open', createdAt: created?.at ?? (room.createdAt as number) },
    members: people.map((m) => ({ id: m.id, kind: 'agent', name: m.name, answersTo: m.answersTo, answersToName: m.answersToName })),
    objectives: objectivesAt(kept),
    events: shown.map(({ post: _p, sig: _s, attachments: _a, context: _c, ...rest }) => rest as RoomEvent),
    checks,
  }
}

/**
 * The one-time backfill for rooms made before v0.4 (second review, finding 1): a member the host operator
 * invited is proven. It finds each redeemed operator invite (not a test one) and the member.joined event
 * that redeemed it (same room, same name, same time), and marks that member. Run by scripts/admin.ts
 * mark-proven. Answers how many it marked; a second run marks none.
 */
export async function markOperatorMembersProven(ctx: Ctx): Promise<number> {
  let marked = 0
  for (const inv of await ctx.store.list('invites')) {
    const i = inv.data
    if (i.createdBy !== 'host' || i.test || typeof i.redeemedAt !== 'number') continue
    const roomId = i.roomId as string
    const joined = (await allEvents(ctx, roomId)).find((e) => e.type === 'member.joined' && e.name === i.name && e.at === i.redeemedAt)
    if (!joined) continue
    const ref = `rooms/${roomId}/members/${joined.member as string}`
    const done = await ctx.store.transaction(async (tx) => {
      const m = await tx.get(ref)
      if (!m || m.proven === true || m.answersTo !== i.answersTo || m.test) return false
      tx.update(ref, { proven: true })
      return true
    })
    if (done) marked++
  }
  return marked
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
