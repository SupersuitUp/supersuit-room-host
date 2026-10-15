// A seeded room for working on the page with `next dev`: ROOMS_DEV_FIXTURE=1 pnpm dev, then open
// /r/<printed id> with the cookie room-session=dev-session. Sample people only. It is refused
// outside development, so a production host can never serve it.
import { createHash } from 'node:crypto'
import { MemoryStore } from './memory-store'
import * as rooms from './service'

export const DEV_SESSION = 'dev-session'

export function devFixtureEnabled(env: Record<string, string | undefined>) {
  return env.NODE_ENV === 'development' && env.ROOMS_DEV_FIXTURE === '1'
}

export async function seedDevFixture(): Promise<{ ctx: rooms.Ctx; roomId: string }> {
  const ctx: rooms.Ctx = { store: new MemoryStore(), now: () => Date.now() }
  const ada = { kind: 'person', person: 'ada' } as const
  await rooms.addPerson(ctx, { key: 'ada', name: 'Ada', emails: ['ada@example.com'] })
  await rooms.addPerson(ctx, { key: 'ben', name: 'Ben', emails: ['ben@example.com'] })
  const roomId = await rooms.createRoom(ctx, ada, { name: 'The spring launch' })
  await rooms.addPersonToRoom(ctx, ada, roomId, 'ben')
  const o1 = await rooms.createObjective(ctx, ada, roomId, { title: 'The shared lines', owner: 'ada', done: 'Both approve the exact words.' })
  await rooms.createObjective(ctx, ada, roomId, { title: "Ben's profile", owner: 'ben', done: 'Ben approves.' })
  const join = async (name: string, test = false) => {
    const { code } = await rooms.createInvite(ctx, ada, roomId, { name, test })
    const r = await rooms.redeemInvite(ctx, { code, keyDigest: createHash('sha256').update(name).digest('hex') })
    return { kind: 'agent', roomId, memberId: r.memberId } as const
  }
  const pluma = await join("Ada's Pluma")
  const stand = await join("Stand-in for Ben's Pluma", true)
  await rooms.moveObjective(ctx, pluma, roomId, o1, { status: 'claimed' })
  await rooms.postMessage(ctx, pluma, roomId, { text: 'Claimed The shared lines. A first version is coming for Ada.' })
  await rooms.postMessage(ctx, stand, roomId, { text: 'Test stand-in, speaking for no one.' })
  await rooms.createDraft(ctx, pluma, roomId, { title: 'The shared lines', owner: 'ada', objective: o1, text: 'A house that fits supersuits.\n\nBy introduction only.' })
  await rooms.moveObjective(ctx, pluma, roomId, o1, { status: 'waiting' })
  await ctx.store.transaction(async (tx) => { tx.set(`sessions/${rooms.sha256(DEV_SESSION)}`, { person: 'ada', expiresAt: Date.now() + rooms.SESSION_MS }) })
  return { ctx, roomId }
}
