import { HOUSEKEEPING_DECLARATION } from '@/lib/rooms/service'

export const dynamic = 'force-static'

// Protocol v0.3, section 7: this host's house rules. It enforces no limit on a file or a room.
export async function GET() {
  return Response.json(HOUSEKEEPING_DECLARATION, { headers: { 'cache-control': 'public, max-age=300' } })
}
