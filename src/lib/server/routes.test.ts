import { describe, it, expect, beforeEach } from 'vitest'
import { createHash } from 'node:crypto'
import { MemoryStore } from '@/lib/rooms/memory-store'
import * as rooms from '@/lib/rooms/service'
import { setCtxForTests, SESSION_COOKIE } from './ctx'
import { setIdTokenVerifierForTests } from './auth'
import { POST as approvePOST } from '@/app/api/rooms/[id]/drafts/[did]/approvals/route'
import { GET as eventsGET } from '@/app/api/rooms/[id]/events/route'
import { POST as messagesPOST } from '@/app/api/rooms/[id]/messages/route'
import { POST as joinPOST } from '@/app/api/agent/join/route'
import { POST as sessionPOST } from '@/app/api/session/route'

const digest = (s: string) => createHash('sha256').update(s).digest('hex')
let ctx: rooms.Ctx
let roomId: string, did: string, adaToken: string, benToken: string
const AGENT_KEY = 'ada-pluma-key-0123456789'

const req = (url: string, init: { method?: string; body?: unknown; key?: string; session?: string } = {}) => {
  const headers = new Headers({ 'content-type': 'application/json' })
  if (init.key) headers.set('authorization', `Bearer ${init.key}`)
  if (init.session) headers.set('cookie', `${SESSION_COOKIE}=${init.session}`)
  return new Request('https://host.test' + url, { method: init.method ?? 'GET', headers, body: init.body ? JSON.stringify(init.body) : undefined })
}
const params = <T,>(p: T) => ({ params: Promise.resolve(p) })

beforeEach(async () => {
  let t = 1000
  ctx = { store: new MemoryStore(), now: () => ++t }
  setCtxForTests(ctx)
  await rooms.addPerson(ctx, { key: 'ada', name: 'Ada', emails: ['ada@example.com'] })
  await rooms.addPerson(ctx, { key: 'ben', name: 'Ben', emails: ['ben@example.com'] })
  const ada = { kind: 'person', person: 'ada' } as const
  roomId = await rooms.createRoom(ctx, ada, { name: 'Room' })
  await rooms.addPersonToRoom(ctx, ada, roomId, 'ben')
  const { code } = await rooms.createInvite(ctx, ada, roomId, { name: "Ada's Pluma" })
  const res = await joinPOST(req('/api/agent/join', { method: 'POST', body: { code, keyDigest: digest(AGENT_KEY) } }))
  expect(res.status).toBe(200)
  const { memberId } = await res.json()
  did = await rooms.createDraft(ctx, { kind: 'agent', roomId, memberId }, roomId, { title: 'T', owner: 'ada', text: 'words' })
  adaToken = await rooms.createSession(ctx, 'ada')
  benToken = await rooms.createSession(ctx, 'ben')
})

const approval = (extra: { key?: string; session?: string }) =>
  approvePOST(req(`/api/rooms/${roomId}/drafts/${did}/approvals`, { method: 'POST', body: { version: 1, fingerprint: rooms.fingerprint('words'), verdict: 'approve' }, ...extra }), params({ id: roomId, did }))

describe('the approval route', () => {
  it('REFUSES A VALID AGENT KEY and records nothing', async () => {
    const res = await approval({ key: AGENT_KEY })
    expect(res.status).toBe(403)
    expect((await res.json()).error).toMatch(/agent/)
    const v = await rooms.read(ctx, { kind: 'person', person: 'ada' }, roomId, 0)
    expect(v.drafts[0].approvals).toEqual([])
  })

  it('refuses an agent key even when the owner session rides along', async () => {
    expect((await approval({ key: AGENT_KEY, session: adaToken })).status).toBe(403)
  })

  it('refuses no session at all', async () => {
    expect((await approval({})).status).toBe(401)
  })

  it('refuses another member\'s session', async () => {
    expect((await approval({ session: benToken })).status).toBe(403)
  })

  it('accepts the owner\'s session', async () => {
    const res = await approval({ session: adaToken })
    expect(res.status).toBe(200)
  })
})

describe('reading and posting', () => {
  it('an agent reads with its key and posts', async () => {
    const p = await messagesPOST(req(`/api/rooms/${roomId}/messages`, { method: 'POST', key: AGENT_KEY, body: { text: 'hello' } }), params({ id: roomId }))
    expect(p.status).toBe(200)
    const r = await eventsGET(req(`/api/rooms/${roomId}/events?after=0`, { key: AGENT_KEY }), params({ id: roomId }))
    expect(r.status).toBe(200)
    expect((await r.json()).events.some((e: { text?: string }) => e.text === 'hello')).toBe(true)
  })

  it('a wrong key, a stranger and nobody all get the same 404 or 401, never the room', async () => {
    const wrong = await eventsGET(req(`/api/rooms/${roomId}/events`, { key: 'not-a-member-key' }), params({ id: roomId }))
    expect(wrong.status).toBe(401)
    await rooms.addPerson(ctx, { key: 'eve', name: 'Eve', emails: ['eve@example.com'] })
    const eve = await rooms.createSession(ctx, 'eve')
    const stranger = await eventsGET(req(`/api/rooms/${roomId}/events`, { session: eve }), params({ id: roomId }))
    expect(stranger.status).toBe(404)
    expect(await stranger.text()).not.toContain('Room')
    const nobody = await eventsGET(req(`/api/rooms/${roomId}/events`), params({ id: roomId }))
    expect(nobody.status).toBe(401)
  })

  it('an agent key is good only in its own room', async () => {
    const other = await rooms.createRoom(ctx, { kind: 'person', person: 'ada' }, { name: 'Other' })
    const r = await eventsGET(req(`/api/rooms/${other}/events`, { key: AGENT_KEY }), params({ id: other }))
    expect(r.status).toBe(404)
  })
})

describe('the session route', () => {
  it('a verified Google email on this host gets a session cookie; anyone else gets 403', async () => {
    setIdTokenVerifierForTests(async (t) => (t === 'good' ? { email: 'ada@example.com', email_verified: true } : t === 'unverified' ? { email: 'ada@example.com', email_verified: false } : { email: 'eve@example.com', email_verified: true }))
    const ok = await sessionPOST(req('/api/session', { method: 'POST', body: { idToken: 'good' } }))
    expect(ok.status).toBe(200)
    expect(ok.headers.get('set-cookie')).toMatch(new RegExp(`${SESSION_COOKIE}=`))
    expect(ok.headers.get('set-cookie')).toMatch(/HttpOnly/i)
    expect((await sessionPOST(req('/api/session', { method: 'POST', body: { idToken: 'unverified' } }))).status).toBe(403)
    expect((await sessionPOST(req('/api/session', { method: 'POST', body: { idToken: 'stranger' } }))).status).toBe(403)
  })
})
