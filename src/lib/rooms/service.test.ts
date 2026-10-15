import { describe, it, expect, beforeEach } from 'vitest'
import { createHash } from 'node:crypto'
import { MemoryStore } from './memory-store'
import { Refusal } from './refusal'
import * as rooms from './service'
import type { Actor } from './types'

const digest = (s: string) => createHash('sha256').update(s).digest('hex')

let t = 1_000
let ctx: rooms.Ctx
const ada: Actor = { kind: 'person', person: 'ada' }
const ben: Actor = { kind: 'person', person: 'ben' }

async function refused(p: Promise<unknown>, status: number) {
  const e = await p.then(() => null, (err) => err)
  expect(e).toBeInstanceOf(Refusal)
  expect((e as Refusal).status).toBe(status)
}

async function agentIn(roomId: string, by: Actor, name = "Ada's Pluma", key = 'key-' + name) {
  const { code } = await rooms.createInvite(ctx, by, roomId, { name })
  const j = await rooms.redeemInvite(ctx, { code, keyDigest: digest(key) })
  return { actor: { kind: 'agent', roomId, memberId: j.memberId } as Actor, ...j }
}

beforeEach(async () => {
  t = 1_000
  ctx = { store: new MemoryStore(), now: () => ++t }
  await rooms.addPerson(ctx, { key: 'ada', name: 'Ada', emails: ['ada@example.com'] })
  await rooms.addPerson(ctx, { key: 'ben', name: 'Ben', emails: ['ben@example.com'] })
})

describe('rooms and members', () => {
  it('a person creates a room and is its first member', async () => {
    const id = await rooms.createRoom(ctx, ada, { name: 'The full rebrand' })
    const v = await rooms.read(ctx, ada, id, 0)
    expect(v.room.name).toBe('The full rebrand')
    expect(v.members).toEqual([{ id: 'p-ada', kind: 'person', person: 'ada', name: 'Ada' }])
  })

  it('an agent cannot create a room', async () => {
    const id = await rooms.createRoom(ctx, ada, { name: 'R' })
    const { actor } = await agentIn(id, ada)
    await refused(rooms.createRoom(ctx, actor, { name: 'X' }), 403)
  })

  it('finds a person by the digest of their email, never storing the address', async () => {
    expect(await rooms.personForEmail(ctx, 'ADA@example.com')).toBe('ada')
    expect(await rooms.personForEmail(ctx, 'eve@example.com')).toBeNull()
    expect(JSON.stringify([...(ctx.store as MemoryStore).docs])).not.toContain('ada@example.com')
  })

  it('a non-member and a stranger both get the same 404, and never the name', async () => {
    const id = await rooms.createRoom(ctx, ada, { name: 'Secret name' })
    await refused(rooms.read(ctx, ben, id, 0), 404)
    await refused(rooms.read(ctx, ben, 'no-such-room', 0), 404)
  })

  it('an invite makes an agent member that answers to the inviter, once', async () => {
    const id = await rooms.createRoom(ctx, ada, { name: 'R' })
    const { code } = await rooms.createInvite(ctx, ada, id, { name: "Ada's Pluma" })
    const j = await rooms.redeemInvite(ctx, { code, keyDigest: digest('k1') })
    expect(j.roomId).toBe(id)
    await refused(rooms.redeemInvite(ctx, { code, keyDigest: digest('k2') }), 404)
    const v = await rooms.read(ctx, ada, id, 0)
    expect(v.members.find((m) => m.id === j.memberId)).toMatchObject({ kind: 'agent', name: "Ada's Pluma", answersTo: 'ada' })
  })

  it('a test identity is marked as one', async () => {
    const id = await rooms.createRoom(ctx, ada, { name: 'R' })
    const { code } = await rooms.createInvite(ctx, ada, id, { name: 'Stand-in', test: true })
    const j = await rooms.redeemInvite(ctx, { code, keyDigest: digest('k1') })
    const v = await rooms.read(ctx, ada, id, 0)
    expect(v.members.find((m) => m.id === j.memberId)).toMatchObject({ test: true })
  })

  it('stores only the digest of an agent key and refuses a digest that is not one', async () => {
    const id = await rooms.createRoom(ctx, ada, { name: 'R' })
    const { code } = await rooms.createInvite(ctx, ada, id, { name: 'P' })
    await refused(rooms.redeemInvite(ctx, { code, keyDigest: 'not-a-digest' }), 400)
  })

  it('an expired invite is refused', async () => {
    const id = await rooms.createRoom(ctx, ada, { name: 'R' })
    const { code } = await rooms.createInvite(ctx, ada, id, { name: 'P' })
    t += 8 * 86_400_000
    await refused(rooms.redeemInvite(ctx, { code, keyDigest: digest('k') }), 404)
  })

  it('an agent cannot invite', async () => {
    const id = await rooms.createRoom(ctx, ada, { name: 'R' })
    const { actor } = await agentIn(id, ada)
    await refused(rooms.createInvite(ctx, actor, id, { name: 'X' }), 403)
  })

  it('a room holds at most 8 members', async () => {
    const id = await rooms.createRoom(ctx, ada, { name: 'R' })
    for (let i = 0; i < 7; i++) await agentIn(id, ada, `P${i}`)
    const { code } = await rooms.createInvite(ctx, ada, id, { name: 'P8' })
    await refused(rooms.redeemInvite(ctx, { code, keyDigest: digest('k8') }), 409)
  })

  it('a person is added to a room by a member', async () => {
    const id = await rooms.createRoom(ctx, ada, { name: 'R' })
    await rooms.addPersonToRoom(ctx, ada, id, 'ben')
    expect((await rooms.read(ctx, ben, id, 0)).room.id).toBe(id)
  })

  it('resolves an agent key to its membership', async () => {
    const id = await rooms.createRoom(ctx, ada, { name: 'R' })
    const { memberId } = await agentIn(id, ada, 'P', 'secret')
    expect(await rooms.agentForKeyDigest(ctx, digest('secret'))).toEqual({ kind: 'agent', roomId: id, memberId })
    expect(await rooms.agentForKeyDigest(ctx, digest('other'))).toBeNull()
  })
})

describe('the thread', () => {
  it('reads only what landed after the cursor', async () => {
    const id = await rooms.createRoom(ctx, ada, { name: 'R' })
    const { actor } = await agentIn(id, ada)
    await rooms.postMessage(ctx, actor, id, { text: 'one' })
    const first = await rooms.read(ctx, actor, id, 0)
    await rooms.postMessage(ctx, ada, id, { text: 'two' })
    const next = await rooms.read(ctx, actor, id, first.cursor)
    expect(next.events.map((e) => e.text)).toEqual(['two'])
    expect(next.cursor).toBeGreaterThan(first.cursor)
  })

  it('refuses an empty message and an instruction for someone not in the room', async () => {
    const id = await rooms.createRoom(ctx, ada, { name: 'R' })
    await refused(rooms.postMessage(ctx, ada, id, { text: '  ' }), 400)
    await refused(rooms.postMessage(ctx, ada, id, { text: 'hi', instructionFor: 'a-nobody' }), 400)
  })

  it('records when an agent last checked in', async () => {
    const id = await rooms.createRoom(ctx, ada, { name: 'R' })
    const { actor, memberId } = await agentIn(id, ada)
    await rooms.read(ctx, actor, id, 0)
    const v = await rooms.read(ctx, ada, id, 0)
    const m = v.members.find((x) => x.id === memberId)
    expect(m && m.kind === 'agent' && m.lastSeenAt).toBeGreaterThan(0)
  })

  it('a closed room refuses writes', async () => {
    const id = await rooms.createRoom(ctx, ada, { name: 'R' })
    await rooms.closeRoom(ctx, ada, id)
    await refused(rooms.postMessage(ctx, ada, id, { text: 'hi' }), 409)
  })
})

describe('objectives', () => {
  it('a person pins one; an agent cannot', async () => {
    const id = await rooms.createRoom(ctx, ada, { name: 'R' })
    const { actor } = await agentIn(id, ada)
    const oid = await rooms.createObjective(ctx, ada, id, { title: 'Shared lines', owner: 'ada', done: 'Both approve' })
    await refused(rooms.createObjective(ctx, actor, id, { title: 'x', owner: 'ada', done: 'y' }), 403)
    const v = await rooms.read(ctx, actor, id, 0)
    expect(v.objectives).toMatchObject([{ id: oid, title: 'Shared lines', owner: 'ada', status: 'open' }])
  })

  it('the owner must be a person in the room', async () => {
    const id = await rooms.createRoom(ctx, ada, { name: 'R' })
    await refused(rooms.createObjective(ctx, ada, id, { title: 't', owner: 'ben', done: 'd' }), 400)
  })

  it('an agent moves an objective, and claiming records who', async () => {
    const id = await rooms.createRoom(ctx, ada, { name: 'R' })
    const { actor, memberId } = await agentIn(id, ada)
    const oid = await rooms.createObjective(ctx, ada, id, { title: 't', owner: 'ada', done: 'd' })
    await rooms.moveObjective(ctx, actor, id, oid, { status: 'claimed' })
    const v = await rooms.read(ctx, ada, id, 0)
    expect(v.objectives[0]).toMatchObject({ status: 'claimed', claimedBy: memberId })
    await refused(rooms.moveObjective(ctx, actor, id, oid, { status: 'finished' as never }), 400)
  })
})

describe('drafts and approvals', () => {
  async function setup() {
    const id = await rooms.createRoom(ctx, ada, { name: 'R' })
    await rooms.addPersonToRoom(ctx, ada, id, 'ben')
    const pluma = await agentIn(id, ada)
    const did = await rooms.createDraft(ctx, pluma.actor, id, { title: 'Headline', owner: 'ada', text: 'v1 words' })
    return { id, pluma, did }
  }

  it('fingerprints each version by its exact text', async () => {
    const { id, did } = await setup()
    const v = await rooms.read(ctx, ada, id, 0)
    expect(v.drafts[0].versions[0].fingerprint).toBe(rooms.fingerprint('v1 words'))
    expect(rooms.fingerprint('v1 words')).not.toBe(rooms.fingerprint('v1 words '))
    expect(did).toBe(v.drafts[0].id)
  })

  it('an agent drafts only under the name of the person it answers to', async () => {
    const { id, pluma } = await setup()
    await refused(rooms.createDraft(ctx, pluma.actor, id, { title: 'x', owner: 'ben', text: 't' }), 403)
  })

  it('the owner approves the latest version by its fingerprint', async () => {
    const { id, did } = await setup()
    await rooms.approve(ctx, ada, id, did, { version: 1, fingerprint: rooms.fingerprint('v1 words'), verdict: 'approve' })
    const v = await rooms.read(ctx, ada, id, 0)
    expect(v.drafts[0].approvals).toMatchObject([{ by: 'ada', version: 1, verdict: 'approve' }])
  })

  it('NO AGENT CAN APPROVE, not even the owner\'s own', async () => {
    const { id, did, pluma } = await setup()
    await refused(rooms.approve(ctx, pluma.actor, id, did, { version: 1, fingerprint: rooms.fingerprint('v1 words'), verdict: 'approve' }), 403)
    expect((await rooms.read(ctx, ada, id, 0)).drafts[0].approvals).toEqual([])
  })

  it('another person cannot approve a draft that is not theirs', async () => {
    const { id, did } = await setup()
    await refused(rooms.approve(ctx, ben, id, did, { version: 1, fingerprint: rooms.fingerprint('v1 words'), verdict: 'approve' }), 403)
  })

  it('refuses a wrong fingerprint and a version that is no longer the latest', async () => {
    const { id, did, pluma } = await setup()
    await refused(rooms.approve(ctx, ada, id, did, { version: 1, fingerprint: rooms.fingerprint('other'), verdict: 'approve' }), 409)
    await rooms.addDraftVersion(ctx, pluma.actor, id, did, { text: 'v2 words' })
    await refused(rooms.approve(ctx, ada, id, did, { version: 1, fingerprint: rooms.fingerprint('v1 words'), verdict: 'approve' }), 409)
    await rooms.approve(ctx, ada, id, did, { version: 2, fingerprint: rooms.fingerprint('v2 words'), verdict: 'approve' })
  })

  it('an approval names one version, so a new version stands unapproved', async () => {
    const { id, did, pluma } = await setup()
    await rooms.approve(ctx, ada, id, did, { version: 1, fingerprint: rooms.fingerprint('v1 words'), verdict: 'approve' })
    await rooms.addDraftVersion(ctx, pluma.actor, id, did, { text: 'v2 words' })
    const d = (await rooms.read(ctx, ada, id, 0)).drafts[0]
    expect(rooms.isApproved(d)).toBe(false)
  })

  it('asking for changes is recorded and is not an approval', async () => {
    const { id, did } = await setup()
    await rooms.approve(ctx, ada, id, did, { version: 1, fingerprint: rooms.fingerprint('v1 words'), verdict: 'changes' })
    const d = (await rooms.read(ctx, ada, id, 0)).drafts[0]
    expect(rooms.isApproved(d)).toBe(false)
    expect(d.approvals[0].verdict).toBe('changes')
  })
})
