// The rules of a Supersuit Room (Protocol v0.1), written once against the Store contract.
// Every write that changes what a member reads appends one event under the room's serial `seq`,
// so "read since cursor" is one query and two readers never disagree about order.
import { createHash, randomBytes } from 'node:crypto'
import { Refusal } from './refusal'
import type { Data, Store, Tx } from './store'
import {
  MAX_MEMBERS, OBJECTIVE_STATUSES,
  type Actor, type Approval, type Draft, type DraftVersion, type Member, type Objective, type ObjectiveStatus, type Room, type RoomEvent, type RoomView,
} from './types'

export type Ctx = { store: Store; now: () => number }

const INVITE_MS = 7 * 86_400_000
const HEX64 = /^[0-9a-f]{64}$/
const MAX_TEXT = 20_000

export const sha256 = (s: string) => createHash('sha256').update(s).digest('hex')
/** A draft version's fingerprint: the SHA-256 of its exact text. An approval binds to this. */
export const fingerprint = (text: string) => sha256(text)
const emailDigest = (email: string) => sha256(email.trim().toLowerCase())
const newId = (prefix: string) => prefix + randomBytes(6).toString('hex')
const pad = (seq: number) => String(seq).padStart(12, '0')
const NOT_FOUND = () => new Refusal('not found', 404)

function text(raw: unknown, what: string, max = MAX_TEXT): string {
  if (typeof raw !== 'string' || !raw.trim()) throw new Refusal(`${what} is empty`, 400)
  if (raw.length > max) throw new Refusal(`${what} is too long`, 400)
  return raw
}

// ---- people (the host's humans) ----

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

async function personName(tx: Tx, key: string): Promise<string> {
  const p = await tx.get(`people/${key}`)
  if (!p) throw new Refusal('no such person on this host', 400)
  return p.name as string
}

// ---- membership ----

/** The member this actor is in the room, or a 404 that says nothing about whether the room exists. */
async function memberOf(tx: Pick<Tx, 'get'>, actor: Actor, roomId: string): Promise<{ room: Data; member: Member }> {
  const room = await tx.get(`rooms/${roomId}`)
  if (!room) throw NOT_FOUND()
  const memberId = actor.kind === 'person' ? `p-${actor.person}` : actor.roomId === roomId ? actor.memberId : null
  if (!memberId) throw NOT_FOUND()
  const m = await tx.get(`rooms/${roomId}/members/${memberId}`)
  if (!m) throw NOT_FOUND()
  return { room, member: { id: memberId, ...m } as Member }
}

function requirePerson(actor: Actor, what: string): asserts actor is Extract<Actor, { kind: 'person' }> {
  if (actor.kind !== 'person') throw new Refusal(`${what} takes a person, not an agent`, 403)
}

function requireOpen(room: Data) {
  if (room.state !== 'open') throw new Refusal('this room is closed', 409)
}

/** Append one event and advance the room's seq. Call after every read in the transaction. */
function emit(tx: Tx, roomId: string, room: Data, now: number, event: Omit<RoomEvent, 'seq' | 'at'>): number {
  const seq = (room.seq as number) + 1
  room.seq = seq
  tx.update(`rooms/${roomId}`, { seq })
  tx.set(`rooms/${roomId}/events/${pad(seq)}`, { ...event, seq, at: now })
  return seq
}

export async function createRoom(ctx: Ctx, actor: Actor, p: { name: string }): Promise<string> {
  requirePerson(actor, 'creating a room')
  const id = newId('r')
  const now = ctx.now()
  await ctx.store.transaction(async (tx) => {
    const name = await personName(tx, actor.person)
    tx.set(`rooms/${id}`, { name: text(p.name, 'room name', 120), state: 'open', createdBy: actor.person, createdAt: now, seq: 1 })
    tx.set(`rooms/${id}/members/p-${actor.person}`, { kind: 'person', person: actor.person, name })
    tx.set(`rooms/${id}/events/${pad(1)}`, { seq: 1, type: 'room.created', by: `p-${actor.person}`, at: now, name: p.name })
  })
  return id
}

export async function closeRoom(ctx: Ctx, actor: Actor, roomId: string) {
  requirePerson(actor, 'closing a room')
  await ctx.store.transaction(async (tx) => {
    const { room, member } = await memberOf(tx, actor, roomId)
    requireOpen(room)
    tx.update(`rooms/${roomId}`, { state: 'closed', closedAt: ctx.now() })
    emit(tx, roomId, room, ctx.now(), { type: 'room.closed', by: member.id })
  })
}

async function memberCount(ctx: Ctx, roomId: string) {
  return (await ctx.store.list(`rooms/${roomId}/members`)).length
}

export async function addPersonToRoom(ctx: Ctx, actor: Actor, roomId: string, person: string) {
  requirePerson(actor, 'adding a member')
  if ((await memberCount(ctx, roomId)) >= MAX_MEMBERS) throw new Refusal(`a room holds at most ${MAX_MEMBERS} members`, 409)
  await ctx.store.transaction(async (tx) => {
    const { room, member } = await memberOf(tx, actor, roomId)
    requireOpen(room)
    const name = await personName(tx, person)
    if (await tx.get(`rooms/${roomId}/members/p-${person}`)) return
    tx.set(`rooms/${roomId}/members/p-${person}`, { kind: 'person', person, name })
    emit(tx, roomId, room, ctx.now(), { type: 'member.joined', by: member.id, member: `p-${person}`, name })
  })
}

/** A person invites an agent that answers to them. The code is shown once; only its digest is kept. */
export async function createInvite(ctx: Ctx, actor: Actor, roomId: string, p: { name: string; test?: boolean }): Promise<{ code: string }> {
  requirePerson(actor, 'inviting')
  const code = randomBytes(16).toString('base64url')
  await ctx.store.transaction(async (tx) => {
    const { room } = await memberOf(tx, actor, roomId)
    requireOpen(room)
    tx.set(`invites/${sha256(code)}`, {
      roomId, name: text(p.name, 'agent name', 80), answersTo: actor.person, test: p.test === true,
      createdBy: actor.person, expiresAt: ctx.now() + INVITE_MS, redeemedAt: null,
    })
  })
  return { code }
}

/** An agent redeems its invite with the digest of a key it made itself. The key never travels. */
export async function redeemInvite(ctx: Ctx, p: { code: string; keyDigest: string }): Promise<{ roomId: string; memberId: string; name: string }> {
  const keyDigest = String(p.keyDigest ?? '').toLowerCase()
  if (!HEX64.test(keyDigest)) throw new Refusal('keyDigest is not a 64 hex sha256 digest', 400)
  if (typeof p.code !== 'string' || !p.code) throw NOT_FOUND()
  const inviteRef = `invites/${sha256(p.code)}`
  const pre = await ctx.store.get(inviteRef)
  if (pre && (await memberCount(ctx, pre.roomId as string)) >= MAX_MEMBERS) throw new Refusal(`a room holds at most ${MAX_MEMBERS} members`, 409)
  const memberId = newId('a-')
  return ctx.store.transaction(async (tx) => {
    const invite = await tx.get(inviteRef)
    if (!invite || invite.redeemedAt || (invite.expiresAt as number) < ctx.now()) throw NOT_FOUND()
    if (await tx.get(`agentKeys/${keyDigest}`)) throw new Refusal('that key is already a member somewhere; make a new one', 409)
    const roomId = invite.roomId as string
    const room = await tx.get(`rooms/${roomId}`)
    if (!room) throw NOT_FOUND()
    requireOpen(room)
    const now = ctx.now()
    tx.update(inviteRef, { redeemedAt: now })
    tx.set(`agentKeys/${keyDigest}`, { roomId, memberId })
    const member: Data = { kind: 'agent', name: invite.name, answersTo: invite.answersTo, lastSeenAt: now }
    if (invite.test) member.test = true
    tx.set(`rooms/${roomId}/members/${memberId}`, member)
    emit(tx, roomId, room, now, { type: 'member.joined', by: memberId, member: memberId, name: invite.name as string })
    return { roomId, memberId, name: invite.name as string }
  })
}

export async function agentForKeyDigest(ctx: Ctx, keyDigest: string): Promise<Actor | null> {
  if (!HEX64.test(keyDigest)) return null
  const k = await ctx.store.get(`agentKeys/${keyDigest}`)
  return k ? { kind: 'agent', roomId: k.roomId as string, memberId: k.memberId as string } : null
}

// ---- reading ----

export async function read(ctx: Ctx, actor: Actor, roomId: string, after: number): Promise<RoomView> {
  const { member } = await memberOf(ctx.store, actor, roomId)
  if (actor.kind === 'agent') {
    await ctx.store.transaction(async (tx) => { tx.update(`rooms/${roomId}/members/${member.id}`, { lastSeenAt: ctx.now() }) })
  }
  const room = (await ctx.store.get(`rooms/${roomId}`))!
  const [members, objectives, drafts, events] = await Promise.all([
    ctx.store.list(`rooms/${roomId}/members`),
    ctx.store.list(`rooms/${roomId}/objectives`, { orderBy: 'createdAt' }),
    ctx.store.list(`rooms/${roomId}/drafts`, { orderBy: 'createdAt' }),
    ctx.store.list(`rooms/${roomId}/events`, { after: { field: 'seq', value: Number(after) || 0 }, orderBy: 'seq', limit: 500 }),
  ])
  const fullDrafts: Draft[] = await Promise.all(drafts.map(async (d) => {
    const [versions, approvals] = await Promise.all([
      ctx.store.list(`rooms/${roomId}/drafts/${d.id}/versions`, { orderBy: 'n' }),
      ctx.store.list(`rooms/${roomId}/drafts/${d.id}/approvals`, { orderBy: 'at' }),
    ])
    return {
      id: d.id, title: d.data.title as string, owner: d.data.owner as string, objective: d.data.objective as string | undefined,
      latest: d.data.latest as number,
      versions: versions.map((v) => v.data as unknown as DraftVersion),
      approvals: approvals.map((a) => ({ id: a.id, ...a.data }) as unknown as Approval),
    }
  }))
  const evs = events.map((e) => e.data as unknown as RoomEvent)
  return {
    room: { id: roomId, ...room } as unknown as Room,
    members: members.map((m) => ({ id: m.id, ...m.data }) as unknown as Member),
    objectives: objectives.map((o) => ({ id: o.id, ...o.data }) as unknown as Objective),
    drafts: fullDrafts,
    events: evs,
    cursor: evs.length ? evs[evs.length - 1].seq : Math.max(Number(after) || 0, 0),
    you: member.id,
  }
}

// ---- messages ----

export async function postMessage(ctx: Ctx, actor: Actor, roomId: string, p: { text: string; mention?: string; objective?: string; instructionFor?: string }) {
  return ctx.store.transaction(async (tx) => {
    const { room, member } = await memberOf(tx, actor, roomId)
    requireOpen(room)
    const body = text(p.text, 'message')
    for (const ref of [p.mention, p.instructionFor]) {
      if (ref !== undefined && !(await tx.get(`rooms/${roomId}/members/${ref}`))) throw new Refusal('that member is not in this room', 400)
    }
    if (p.objective !== undefined && !(await tx.get(`rooms/${roomId}/objectives/${p.objective}`))) throw new Refusal('no such objective', 400)
    const ev: Omit<RoomEvent, 'seq' | 'at'> = { type: 'message', by: member.id, text: body }
    if (p.mention) ev.mention = p.mention
    if (p.objective) ev.objective = p.objective
    if (p.instructionFor) ev.instructionFor = p.instructionFor
    return { seq: emit(tx, roomId, room, ctx.now(), ev) }
  })
}

// ---- objectives ----

export async function createObjective(ctx: Ctx, actor: Actor, roomId: string, p: { title: string; owner: string; done: string }): Promise<string> {
  requirePerson(actor, 'creating an objective')
  const id = newId('o')
  await ctx.store.transaction(async (tx) => {
    const { room, member } = await memberOf(tx, actor, roomId)
    requireOpen(room)
    if (!(await tx.get(`rooms/${roomId}/members/p-${p.owner}`))) throw new Refusal('an objective is owned by a person in this room', 400)
    const now = ctx.now()
    const o = { title: text(p.title, 'title', 200), owner: p.owner, done: text(p.done, 'definition of done', 2000), status: 'open', createdAt: now, updatedAt: now }
    tx.set(`rooms/${roomId}/objectives/${id}`, o)
    emit(tx, roomId, room, now, { type: 'objective.created', by: member.id, objective: id, title: o.title, owner: o.owner })
  })
  return id
}

export async function moveObjective(ctx: Ctx, actor: Actor, roomId: string, oid: string, p: { status: ObjectiveStatus }) {
  if (!(OBJECTIVE_STATUSES as readonly string[]).includes(p.status)) throw new Refusal(`status is one of ${OBJECTIVE_STATUSES.join(', ')}`, 400)
  await ctx.store.transaction(async (tx) => {
    const { room, member } = await memberOf(tx, actor, roomId)
    requireOpen(room)
    if (!(await tx.get(`rooms/${roomId}/objectives/${oid}`))) throw new Refusal('no such objective', 404)
    const now = ctx.now()
    const patch: Data = { status: p.status, updatedAt: now }
    if (p.status === 'claimed') patch.claimedBy = member.id
    tx.update(`rooms/${roomId}/objectives/${oid}`, patch)
    emit(tx, roomId, room, now, { type: 'objective.moved', by: member.id, objective: oid, status: p.status })
  })
}

// ---- drafts and approvals ----

/** Whose name a draft may go out under: a person may draft for anyone in the room, an agent only for the person it answers to. */
function mayDraftFor(member: Member, owner: string) {
  return member.kind === 'person' || member.answersTo === owner
}

export async function createDraft(ctx: Ctx, actor: Actor, roomId: string, p: { title: string; owner: string; objective?: string; text: string }): Promise<string> {
  const id = newId('d')
  await ctx.store.transaction(async (tx) => {
    const { room, member } = await memberOf(tx, actor, roomId)
    requireOpen(room)
    if (!(await tx.get(`rooms/${roomId}/members/p-${p.owner}`))) throw new Refusal('a draft is owned by a person in this room', 400)
    if (!mayDraftFor(member, p.owner)) throw new Refusal('an agent drafts only under the name of the person it answers to', 403)
    if (p.objective !== undefined && !(await tx.get(`rooms/${roomId}/objectives/${p.objective}`))) throw new Refusal('no such objective', 400)
    const now = ctx.now()
    const body = text(p.text, 'draft')
    const d: Data = { title: text(p.title, 'title', 200), owner: p.owner, latest: 1, createdAt: now }
    if (p.objective) d.objective = p.objective
    tx.set(`rooms/${roomId}/drafts/${id}`, d)
    tx.set(`rooms/${roomId}/drafts/${id}/versions/1`, { n: 1, text: body, fingerprint: fingerprint(body), by: member.id, at: now })
    emit(tx, roomId, room, now, { type: 'draft.version', by: member.id, draft: id, version: 1, title: d.title as string, fingerprint: fingerprint(body) })
  })
  return id
}

export async function addDraftVersion(ctx: Ctx, actor: Actor, roomId: string, did: string, p: { text: string }): Promise<number> {
  return ctx.store.transaction(async (tx) => {
    const { room, member } = await memberOf(tx, actor, roomId)
    requireOpen(room)
    const d = await tx.get(`rooms/${roomId}/drafts/${did}`)
    if (!d) throw new Refusal('no such draft', 404)
    if (!mayDraftFor(member, d.owner as string)) throw new Refusal('an agent drafts only under the name of the person it answers to', 403)
    const n = (d.latest as number) + 1
    const body = text(p.text, 'draft')
    const now = ctx.now()
    tx.update(`rooms/${roomId}/drafts/${did}`, { latest: n })
    tx.set(`rooms/${roomId}/drafts/${did}/versions/${n}`, { n, text: body, fingerprint: fingerprint(body), by: member.id, at: now })
    emit(tx, roomId, room, now, { type: 'draft.version', by: member.id, draft: did, version: n, title: d.title as string, fingerprint: fingerprint(body) })
    return n
  })
}

/**
 * The owner's tap on one exact version. There is no agent path to this function: an agent actor is
 * refused before anything is read, and the route in front of it refuses any request carrying an
 * agent key at all. The approval records the fingerprint it was given, which must be the latest's.
 */
export async function approve(ctx: Ctx, actor: Actor, roomId: string, did: string, p: { version: number; fingerprint: string; verdict: 'approve' | 'changes' }) {
  if (actor.kind !== 'person') throw new Refusal('an approval takes the owner, signed in; no agent can approve', 403)
  if (p.verdict !== 'approve' && p.verdict !== 'changes') throw new Refusal('verdict is approve or changes', 400)
  const id = newId('ap')
  await ctx.store.transaction(async (tx) => {
    const { room, member } = await memberOf(tx, actor, roomId)
    requireOpen(room)
    const d = await tx.get(`rooms/${roomId}/drafts/${did}`)
    if (!d) throw new Refusal('no such draft', 404)
    if (d.owner !== actor.person) throw new Refusal('only the person whose name this goes out under can approve it', 403)
    if (p.version !== d.latest) throw new Refusal('that is not the latest version; read the latest and tap again', 409)
    const v = await tx.get(`rooms/${roomId}/drafts/${did}/versions/${p.version}`)
    if (!v || v.fingerprint !== p.fingerprint) throw new Refusal('the fingerprint does not match that version', 409)
    const now = ctx.now()
    tx.set(`rooms/${roomId}/drafts/${did}/approvals/${id}`, { draft: did, version: p.version, fingerprint: p.fingerprint, by: actor.person, at: now, verdict: p.verdict })
    emit(tx, roomId, room, now, { type: p.verdict === 'approve' ? 'draft.approved' : 'draft.changes', by: member.id, draft: did, version: p.version, fingerprint: p.fingerprint })
  })
}

/** True when the draft's latest version carries its owner's approval of that exact fingerprint. */
export function isApproved(d: Draft): boolean {
  const latest = d.versions.find((v) => v.n === d.latest)
  if (!latest) return false
  return d.approvals.some((a) => a.verdict === 'approve' && a.version === d.latest && a.fingerprint === latest.fingerprint && a.by === d.owner)
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

/** The rooms a person belongs to, for the home page. */
export async function roomsFor(ctx: Ctx, person: string): Promise<{ id: string; name: string; state: string }[]> {
  const out: { id: string; name: string; state: string }[] = []
  for (const r of await ctx.store.list('rooms')) {
    if (await ctx.store.get(`rooms/${r.id}/members/p-${person}`)) out.push({ id: r.id, name: r.data.name as string, state: r.data.state as string })
  }
  return out
}
