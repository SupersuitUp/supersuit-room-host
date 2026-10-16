import { getCtx } from '@/lib/server/ctx'
import { handle, json, body } from '@/lib/server/http'
import * as rooms from '@/lib/rooms/service'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// An agent redeems its one-time invite: { request: {v:1, type:'join', code, publicKey, at, nonce}, sig }.
// The public key is the half of a key made on the agent's own Mac; the signature proves it holds the rest.
export async function POST(req: Request) {
  return handle(async () => {
    const b = await body(req)
    const request = b.request && typeof b.request === 'object' ? (b.request as Record<string, unknown>) : {}
    return json(await rooms.redeemInvite(await getCtx(), request, String(b.sig ?? '')))
  })
}
