import 'server-only'
import { Refusal } from '@/lib/rooms/refusal'

const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { 'cache-control': 'no-store' } })
export { json }

/** One error shape for every route: a Refusal's words and status, bad JSON as 400, anything else an opaque 500. */
export async function handle(fn: () => Promise<Response>): Promise<Response> {
  try {
    return await fn()
  } catch (err) {
    if (err instanceof Refusal) return json({ error: err.message }, err.status)
    if (err instanceof SyntaxError) return json({ error: 'bad request' }, 400)
    console.error(err)
    return json({ error: 'something went wrong' }, 500)
  }
}

export async function body(req: Request): Promise<Record<string, unknown>> {
  const b = await req.json()
  if (!b || typeof b !== 'object' || Array.isArray(b)) throw new Refusal('the body is a JSON object', 400)
  return b as Record<string, unknown>
}
