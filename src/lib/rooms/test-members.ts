// src/lib/rooms/test-members.ts
// A Pluma on its own machine, for tests: a key made here, a join through a real invite, and signed posts.
import { generateKeyPairSync, randomBytes, sign } from 'node:crypto'
import { canonical, publicKeyB64 } from './signing'
import * as rooms from './service'

export type P = { pub: string; s: (o: object) => string; memberId: string; roomId: string }

export function pluma() {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519')
  return { pub: publicKeyB64(publicKey), s: (o: object) => sign(null, Buffer.from(canonical(o)), privateKey).toString('base64url') }
}

export const nonce = () => randomBytes(12).toString('base64url')

export async function join(ctx: rooms.Ctx, roomId: string, name: string, answersTo: string): Promise<P> {
  const { code } = await rooms.createInvite(ctx, 'operator', roomId, { name, answersTo })
  const k = pluma()
  const req = { v: 1, type: 'join', code, publicKey: k.pub, at: new Date(ctx.now()).toISOString(), nonce: nonce() }
  const r = await rooms.redeemInvite(ctx, req, k.s(req))
  return { ...k, memberId: r.memberId, roomId }
}

export function post(ctx: rooms.Ctx, p: P, type: string, fields: Record<string, unknown>) {
  const body = { v: 1, type, room: p.roomId, member: p.memberId, at: new Date(ctx.now()).toISOString(), nonce: nonce(), ...fields }
  return rooms.submitPost(ctx, p.roomId, body, p.s(body))
}

export const asAgent = (p: P) => ({ kind: 'agent', roomId: p.roomId, memberId: p.memberId }) as const
