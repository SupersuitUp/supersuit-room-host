import { describe, it, expect, beforeEach } from 'vitest'
import { generateKeyPairSync, sign, randomBytes } from 'node:crypto'
import { MemoryStore } from '@/lib/rooms/memory-store'
import * as rooms from '@/lib/rooms/service'
import { canonical, publicKeyB64 } from '@/lib/rooms/signing'
import { setCtxForTests, SESSION_COOKIE, audienceFrom } from './ctx'
import { setIdTokenVerifierForTests } from './auth'
import { POST as postsPOST } from '@/app/api/rooms/[id]/posts/route'
import { GET as eventsGET } from '@/app/api/rooms/[id]/events/route'
import { POST as joinPOST } from '@/app/api/agent/join/route'
import { POST as sessionPOST } from '@/app/api/session/route'
import { GET as roomsGET } from '@/app/api/rooms/route'
import { POST as tethersPOST } from '@/app/api/tethers/route'
import { POST as openPOST } from '@/app/api/open/route'
import { newDeviceKey, signEntry } from '@supersuit/suit-identity'
import { join as joinMember } from '@/lib/rooms/test-members'

let ctx: rooms.Ctx
let roomId: string
const H = 'https://host.test'
const params = <T,>(p: T) => ({ params: Promise.resolve(p) })
const iso = () => new Date(ctx.now()).toISOString()
const nonce = () => randomBytes(12).toString('base64url')

type K = { pub: string; s: (o: object) => string; memberId: string }
async function joinVia(name: string, answersTo: string): Promise<K> {
  const { code } = await rooms.createInvite(ctx, 'operator', roomId, { name, answersTo })
  const { publicKey, privateKey } = generateKeyPairSync('ed25519')
  const pub = publicKeyB64(publicKey)
  const s = (o: object) => sign(null, Buffer.from(canonical(o)), privateKey).toString('base64url')
  const req = { v: 1, type: 'join', code, publicKey: pub, at: iso(), nonce: nonce() }
  const res = await joinPOST(new Request(H + '/api/agent/join', { method: 'POST', body: JSON.stringify({ request: req, sig: s(req) }) }))
  expect(res.status).toBe(200)
  return { pub, s, memberId: (await res.json()).memberId }
}
const postAs = (k: K, type: string, fields: object, cookie?: string) => {
  const post = { v: 1, type, room: roomId, member: k.memberId, at: iso(), nonce: nonce(), ...fields }
  const headers: Record<string, string> = { 'content-type': 'application/json' }
  if (cookie) headers.cookie = `${SESSION_COOKIE}=${cookie}`
  return postsPOST(new Request(`${H}/api/rooms/${roomId}/posts`, { method: 'POST', headers, body: JSON.stringify({ post, sig: k.s(post) }) }), params({ id: roomId }))
}
const signedRead = (k: K, after = 0) => {
  const req = { v: 1, type: 'read', room: roomId, member: k.memberId, after, at: iso(), nonce: nonce() }
  return eventsGET(new Request(`${H}/api/rooms/${roomId}/events?after=${after}`, { headers: { 'x-room-request': Buffer.from(canonical(req)).toString('base64url'), 'x-room-signature': k.s(req) } }), params({ id: roomId }))
}

let ada: K, ben: K, draft: string
beforeEach(async () => {
  let t = Date.parse('2026-10-15T12:00:00.000Z')
  ctx = { store: new MemoryStore(), now: () => (t += 1) }
  setCtxForTests(ctx)
  await rooms.addPerson(ctx, { key: 'ada', name: 'Ada', emails: ['ada@example.com'] })
  await rooms.addPerson(ctx, { key: 'ben', name: 'Ben', emails: ['ben@example.com'] })
  await rooms.addPerson(ctx, { key: 'eve', name: 'Eve', emails: ['eve@example.com'] })
  roomId = await rooms.createRoom(ctx, { person: 'ada', name: 'Room' })
  ada = await joinVia("Ada's Pluma", 'ada')
  ben = await joinVia("Ben's Pluma", 'ben')
  const r = await postAs(ada, 'draft', { title: 'T', text: 'words' })
  draft = (await r.json()).draft
})

const decide = (k: K, cookie?: string) => postAs(k, 'decision', { draft, version: 1, fingerprint: rooms.fingerprintText('words'), verdict: 'approve', words: 'Yes.', saidAt: '2026-10-15T11:59:00.000Z' }, cookie)

describe('the posts route: every write is a signed member post', () => {
  it("the draft owner's own Pluma posts the decision", async () => {
    expect((await decide(ada)).status).toBe(200)
  })

  it('ANY OTHER MEMBER gets 403, and nothing is recorded', async () => {
    const res = await decide(ben)
    expect(res.status).toBe(403)
    const v = await rooms.read(ctx, { kind: 'person', person: 'ada' }, roomId, 0)
    expect(v.drafts[0].decisions).toEqual([])
  })

  it('a human session cannot write: a post with a session cookie and no valid signature is 401', async () => {
    const token = await rooms.createSession(ctx, 'ada')
    const post = { v: 1, type: 'message', room: roomId, member: ada.memberId, at: iso(), nonce: nonce(), text: 'from the page' }
    const res = await postsPOST(new Request(`${H}/api/rooms/${roomId}/posts`, { method: 'POST', headers: { cookie: `${SESSION_COOKIE}=${token}` }, body: JSON.stringify({ post, sig: '' }) }), params({ id: roomId }))
    expect(res.status).toBe(401)
  })

  it('a forged signature is 401', async () => {
    const post = { v: 1, type: 'message', room: roomId, member: ada.memberId, at: iso(), nonce: nonce(), text: 'forged' }
    const res = await postsPOST(new Request(`${H}/api/rooms/${roomId}/posts`, { method: 'POST', body: JSON.stringify({ post, sig: ben.s(post) }) }), params({ id: roomId }))
    expect(res.status).toBe(401)
  })
})

describe('reading', () => {
  it('a member reads with a signed request and gets each post with its signature', async () => {
    await postAs(ada, 'message', { text: 'hello' })
    const r = await signedRead(ben)
    expect(r.status).toBe(200)
    const v = await r.json()
    const e = v.events.find((x: { text?: string }) => x.text === 'hello')
    expect(e.sig).toBeTruthy()
    expect(e.post.member).toBe(ada.memberId)
  })

  it('no credential, a forged read signature, and a bad header are all 401', async () => {
    expect((await eventsGET(new Request(`${H}/api/rooms/${roomId}/events`), params({ id: roomId }))).status).toBe(401)
    const req = { v: 1, type: 'read', room: roomId, member: ada.memberId, after: 0, at: iso(), nonce: nonce() }
    const forged = await eventsGET(new Request(`${H}/api/rooms/${roomId}/events`, { headers: { 'x-room-request': Buffer.from(canonical(req)).toString('base64url'), 'x-room-signature': ben.s(req) } }), params({ id: roomId }))
    expect(forged.status).toBe(401)
    const junk = await eventsGET(new Request(`${H}/api/rooms/${roomId}/events`, { headers: { 'x-room-request': '!!!', 'x-room-signature': 'x' } }), params({ id: roomId }))
    expect(junk.status).toBe(401)
    expect((await eventsGET(new Request(`${H}/api/rooms/${roomId}/events`, { headers: { cookie: `${SESSION_COOKIE}=forged` } }), params({ id: roomId }))).status).toBe(401)
  })

  it('a signed-in human whose Pluma is in the room reads it; another human gets 404 and no name', async () => {
    const adaTok = await rooms.createSession(ctx, 'ada')
    const ok = await eventsGET(new Request(`${H}/api/rooms/${roomId}/events`, { headers: { cookie: `${SESSION_COOKIE}=${adaTok}` } }), params({ id: roomId }))
    expect(ok.status).toBe(200)
    expect((await ok.json()).you).toBe('reader:ada')
    const eveTok = await rooms.createSession(ctx, 'eve')
    const no = await eventsGET(new Request(`${H}/api/rooms/${roomId}/events`, { headers: { cookie: `${SESSION_COOKIE}=${eveTok}` } }), params({ id: roomId }))
    expect(no.status).toBe(404)
    expect(await no.text()).not.toContain('Room')
    const list = await roomsGET(new Request(`${H}/api/rooms`, { headers: { cookie: `${SESSION_COOKIE}=${adaTok}` } }))
    expect((await list.json()).rooms.map((r: { id: string }) => r.id)).toEqual([roomId])
  })
})

describe('the session route', () => {
  it('a verified Google email on this host gets a session cookie; anyone else gets 403', async () => {
    setIdTokenVerifierForTests(async (t) => (t === 'good' ? { email: 'ada@example.com', email_verified: true } : t === 'unverified' ? { email: 'ada@example.com', email_verified: false } : { email: 'nobody@example.com', email_verified: true }))
    const ok = await sessionPOST(new Request(H + '/api/session', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ idToken: 'good' }) }))
    expect(ok.status).toBe(200)
    expect(ok.headers.get('set-cookie')).toMatch(/HttpOnly/i)
    expect((await sessionPOST(new Request(H + '/api/session', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ idToken: 'unverified' }) }))).status).toBe(403)
    expect((await sessionPOST(new Request(H + '/api/session', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ idToken: 'stranger' }) }))).status).toBe(403)
  })
})

describe('the long poll', () => {
  it('a person read ignores wait, so the page refresh never holds a function open', async () => {
    let slept = 0
    ctx.sleep = async (ms) => { slept += ms }
    const token = await rooms.createSession(ctx, 'ada')
    const res = await eventsGET(new Request(`${H}/api/rooms/${roomId}/events?after=99999&wait=25`, { headers: { cookie: `${SESSION_COOKIE}=${token}` } }), params({ id: roomId }))
    expect(res.status).toBe(200)
    expect(slept).toBe(0)
  })
  it('a signed member read with wait holds until the room moves', async () => {
    const seq = (await ctx.store.get(`rooms/${roomId}`))!.seq as number
    let calls = 0
    ctx.sleep = async () => { calls++; if (calls === 2) await postAs(ben, 'message', { text: 'news' }) }
    const req = { v: 1, type: 'read', room: roomId, member: ada.memberId, after: seq, at: iso(), nonce: nonce() }
    const res = await eventsGET(new Request(`${H}/api/rooms/${roomId}/events?after=${seq}&wait=25`, { headers: { 'x-room-request': Buffer.from(canonical(req)).toString('base64url'), 'x-room-signature': ada.s(req) } }), params({ id: roomId }))
    expect(res.status).toBe(200)
    expect(calls).toBe(2)
    expect((await res.json()).events.map((e: { text?: string }) => e.text)).toEqual(['news'])
  })
})

describe('tethers (v0.4)', () => {
  it('a Pluma opens a tether under its suit key, and a bad signature is 401', async () => {
    const suit = newDeviceKey()
    ctx.directory = async (h) => (h === 'ada-lovelace' ? { suit: 's1', keys: [suit.pub] } : null)
    const k = generateKeyPairSync('ed25519')
    const entry = signEntry({ op: 'tether-start', aud: 'https://rooms.supersuit.co', handle: 'ada-lovelace', personName: 'Ada', memberName: "Ada's Pluma", name: 'T', publicKey: publicKeyB64(k.publicKey), at: iso(), nonce: nonce() }, suit.priv)
    const ok = await tethersPOST(new Request(H + '/api/tethers', { method: 'POST', body: JSON.stringify(entry) }))
    expect(ok.status).toBe(200)
    expect((await ok.json()).person).toBe('@ada-lovelace')
    const bad = await tethersPOST(new Request(H + '/api/tethers', { method: 'POST', body: JSON.stringify({ ...entry, nonce: nonce() }) }))
    expect(bad.status).toBe(401)
  })

  it('a reader link opens once on POST, sets the session cookie, and then answers 404', async () => {
    const post = { v: 1, type: 'reader.link', room: roomId, member: ada.memberId, at: iso(), nonce: nonce() }
    const r = await postsPOST(new Request(`${H}/api/rooms/${roomId}/posts`, { method: 'POST', body: JSON.stringify({ post, sig: ada.s(post) }) }), params({ id: roomId }))
    const token = ((await r.json()).path as string).replace('/open/', '')
    const open = () => openPOST(new Request(H + '/api/open', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token }) }))
    const first = await open()
    expect(first.status).toBe(200)
    expect((await first.json()).room).toBe(roomId)
    const cookie = first.headers.get('set-cookie') ?? ''
    expect(cookie).toMatch(/HttpOnly/i)
    const session = cookie.split(';')[0].split('=')[1]
    expect(await rooms.personForSession(ctx, session)).toBe('ada')
    expect((await open()).status).toBe(404)
  })
})

describe('a reader-link session (review finding 1)', () => {
  it('reads only the room its link was for, and lists only that room', async () => {
    const other = await rooms.createRoom(ctx, { person: 'ada', name: 'Other room' })
    await joinMember(ctx, other, "Ada's Pluma", 'ada')
    const post = { v: 1, type: 'reader.link', room: roomId, member: ada.memberId, at: iso(), nonce: nonce() }
    const r = await postsPOST(new Request(`${H}/api/rooms/${roomId}/posts`, { method: 'POST', body: JSON.stringify({ post, sig: ada.s(post) }) }), params({ id: roomId }))
    const token = ((await r.json()).path as string).replace('/open/', '')
    const cookie = (await openPOST(new Request(H + '/api/open', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token }) }))).headers.get('set-cookie')!.split(';')[0]
    const list = await roomsGET(new Request(`${H}/api/rooms`, { headers: { cookie } }))
    expect((await list.json()).rooms.map((x: { id: string }) => x.id)).toEqual([roomId])
    expect((await eventsGET(new Request(`${H}/api/rooms/${other}/events`, { headers: { cookie } }), params({ id: other }))).status).toBe(404)
    expect((await eventsGET(new Request(`${H}/api/rooms/${roomId}/events`, { headers: { cookie } }), params({ id: roomId }))).status).toBe(200)
  })
})

describe('the second review (2026-11-07)', () => {
  it('4. a capped long poll answers at once with retryAfter in the body and a Retry-After header', async () => {
    ctx.sleep = () => new Promise(() => {})
    const seq = (await ctx.store.get(`rooms/${roomId}`))!.seq as number
    const read = () => {
      const req = { v: 1, type: 'read', room: roomId, member: ada.memberId, after: seq, at: iso(), nonce: nonce() }
      return eventsGET(new Request(`${H}/api/rooms/${roomId}/events?after=${seq}&wait=25`, { headers: { 'x-room-request': Buffer.from(canonical(req)).toString('base64url'), 'x-room-signature': ada.s(req) } }), params({ id: roomId }))
    }
    void read(); void read()
    await new Promise((r) => setTimeout(r, 5))
    const capped = await read()
    expect(capped.status).toBe(200)
    expect(Number(capped.headers.get('retry-after'))).toBeGreaterThan(0)
    expect((await capped.json()).retryAfter).toBeGreaterThan(0)
  })

  it('5. /api/open and /api/session take only a JSON body from this site, so another site cannot sign a person in', async () => {
    const open = (headers: Record<string, string>) => openPOST(new Request(H + '/api/open', { method: 'POST', headers, body: JSON.stringify({ token: 'x' }) }))
    expect((await open({})).status).toBe(415)
    expect((await open({ 'content-type': 'text/plain' })).status).toBe(415)
    expect((await open({ 'content-type': 'application/json', 'sec-fetch-site': 'cross-site' })).status).toBe(403)
    expect((await open({ 'content-type': 'application/json', 'sec-fetch-site': 'same-origin' })).status).toBe(404)
    const session = (headers: Record<string, string>) => sessionPOST(new Request(H + '/api/session', { method: 'POST', headers, body: JSON.stringify({ idToken: 'good' }) }))
    expect((await session({})).status).toBe(415)
    expect((await session({ 'content-type': 'application/json', 'sec-fetch-site': 'cross-site' })).status).toBe(403)
  })

  it('6. the audience comes from ROOMS_AUDIENCE, and is the production origin by default', () => {
    expect(audienceFrom({})).toBe('https://rooms.supersuit.co')
    expect(audienceFrom({ ROOMS_AUDIENCE: 'https://rooms.example.org' })).toBe('https://rooms.example.org')
  })
})
