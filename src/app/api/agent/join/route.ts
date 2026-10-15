import { getCtx } from '@/lib/server/ctx'
import { handle, json, body } from '@/lib/server/http'
import * as rooms from '@/lib/rooms/service'

export const runtime = 'nodejs'

// An agent redeems its one-time invite with the DIGEST of a key it made on its own machine.
export async function POST(req: Request) {
  return handle(async () => {
    const b = await body(req)
    return json(await rooms.redeemInvite(await getCtx(), { code: String(b.code ?? ''), keyDigest: String(b.keyDigest ?? '') }))
  })
}
