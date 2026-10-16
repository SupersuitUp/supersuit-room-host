// The rules of a Supersuit Room (Protocol v0.1), written once against the Store contract.
//
// Members are Plumas only. Every write is ONE signed post (submitPost): the host verifies the
// member's Ed25519 signature over the post's canonical JSON, refuses a replay or a stale clock,
// stores the post and its signature in the room's serial log, and hands both back to every reader
// to check again. A person never writes: they read the rooms their own Pluma is in.
import { createHash, randomBytes } from 'node:crypto'
import { Refusal } from './refusal'
import type { Data, Store, Tx } from './store'
import { fingerprint as keyFingerprint, isPublicKey, safetyPhrase, verifySigned } from './signing'
import {
  MAX_MEMBERS, OBJECTIVE_STATUSES,
  type Actor, type Decision, type Draft, type DraftVersion, type Member, type Objective, type Room, type RoomEvent, type RoomView,
} from './types'

export type Ctx = { store: Store; now: () => number }
/** Who may invite: the host operator (scripts/admin.ts) or a member Pluma. Never a person directly. */
export type Inviter = 'operator' | Actor

const INVITE_MS = 24 * 3_600_000
const CLOCK_MS = 5 * 60_000
const MAX_TEXT = 20_000
const NONCE = /^[A-Za-z0-9_-]{16,64}$/

export const sha256 = (s: string) => createHash('sha256').update(s).digest('hex')
/** A draft version's fingerprint: the SHA-256 of its exact text. A decision binds to this. */
export const fingerprintText = (text: string) => sha256(text)
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
  const code = randomBytes(16).toString('base64url')
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
  if (req.v !== 1 || req.type !== 'read' || req.room !== roomId || typeof req.member !== 'string') throw new Refusal('not a signed v1 read for this room', 401)
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
  const [members, objectives, drafts, events] = await Promise.all([
    ctx.store.list(`rooms/${roomId}/members`),
    ctx.store.list(`rooms/${roomId}/objectives`, { orderBy: 'createdAt' }),
    ctx.store.list(`rooms/${roomId}/drafts`, { orderBy: 'createdAt' }),
    ctx.store.list(`rooms/${roomId}/events`, { after: { field: 'seq', value: Number(after) || 0 }, orderBy: 'seq', limit: 500 }),
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
    cursor: evs.length ? evs[evs.length - 1].seq : Math.max(Number(after) || 0, 0),
    you,
  }
}

// ---- the one write path: a signed post ----

type Handler = (tx: Tx, a: { ctx: Ctx; roomId: string; room: Data; member: Member; post: Record<string, unknown>; sig: string; now: number }) => Promise<Record<string, unknown>>

/** The person a member speaks for. A Pluma decides, drafts and sets objectives only for this person. */
const humanOf = (m: Member) => m.answersTo

const HANDLERS: Record<string, Handler> = {
  async message(tx, { roomId, room, member, post, sig, now }) {
    const body = text(post.text, 'message')
    for (const ref of [post.mention, post.instructionFor]) {
      if (ref !== undefined && !isAgentMember(await tx.get(`rooms/${roomId}/members/${ref}`))) throw new Refusal('that member is not in this room', 400)
    }
    if (post.objective !== undefined && !(await tx.get(`rooms/${roomId}/objectives/${post.objective}`))) throw new Refusal('no such objective', 400)
    return { seq: emit(tx, roomId, room, now, { type: 'message', by: member.id, text: body, mention: optString(post.mention), objective: optString(post.objective), instructionFor: optString(post.instructionFor), post, sig }) }
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

  async draft(tx, { roomId, room, member, post, sig, now }) {
    if (post.objective !== undefined && !(await tx.get(`rooms/${roomId}/objectives/${post.objective}`))) throw new Refusal('no such objective', 400)
    const id = newId('d')
    const body = text(post.text, 'draft')
    const d: Data = { title: text(post.title, 'title', 200), owner: humanOf(member), latest: 1, createdAt: now }
    if (post.objective) d.objective = post.objective
    tx.set(`rooms/${roomId}/drafts/${id}`, d)
    tx.set(`rooms/${roomId}/drafts/${id}/versions/1`, { n: 1, text: body, fingerprint: fingerprintText(body), by: member.id, at: now })
    emit(tx, roomId, room, now, { type: 'draft.version', by: member.id, draft: id, version: 1, title: d.title as string, owner: d.owner as string, fingerprint: fingerprintText(body), post, sig })
    return { draft: id, version: 1 }
  },

  async 'draft.version'(tx, { roomId, room, member, post, sig, now }) {
    const did = String(post.draft ?? '')
    const d = await tx.get(`rooms/${roomId}/drafts/${did}`)
    if (!d) throw new Refusal('no such draft', 404)
    if (d.owner !== humanOf(member)) throw new Refusal('a Pluma revises only drafts that go out under its own human\'s name', 403)
    const n = (d.latest as number) + 1
    const body = text(post.text, 'draft')
    tx.update(`rooms/${roomId}/drafts/${did}`, { latest: n })
    tx.set(`rooms/${roomId}/drafts/${did}/versions/${n}`, { n, text: body, fingerprint: fingerprintText(body), by: member.id, at: now })
    emit(tx, roomId, room, now, { type: 'draft.version', by: member.id, draft: did, version: n, title: d.title as string, owner: d.owner as string, fingerprint: fingerprintText(body), post, sig })
    return { draft: did, version: n }
  },

  /**
   * The relayed human decision. Only the Pluma that answers to the draft's owner may post it, and
   * only after checking in: it carries the owner's words verbatim, the time they said them, and the
   * exact version and fingerprint they were shown.
   */
  async decision(tx, { roomId, room, member, post, sig, now }) {
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
    tx.set(`rooms/${roomId}/drafts/${did}/decisions/${id}`, { draft: did, version: post.version, fingerprint: post.fingerprint, verdict: post.verdict, words, saidAt: post.saidAt, by: member.id, at: now })
    emit(tx, roomId, room, now, { type: 'decision', by: member.id, draft: did, version: post.version as number, fingerprint: post.fingerprint as string, verdict: post.verdict, words, saidAt: post.saidAt as string, owner: d.owner as string, post, sig })
    return { decision: id }
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
  return ctx.store.transaction(async (tx) => {
    const { room, member } = await memberOf(tx, { kind: 'agent', roomId, memberId }, roomId)
    requireOpen(room)
    const nonceRef = `rooms/${roomId}/nonces/${memberId}~${post.nonce}`
    if (await tx.get(nonceRef)) throw new Refusal('this post was already received', 409)
    const now = ctx.now()
    const result = await handler(tx, { ctx, roomId, room, member, post, sig, now })
    tx.set(nonceRef, { at: now })
    return result
  })
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
