import 'server-only'
import { Refusal } from '@/lib/rooms/refusal'

const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { 'cache-control': 'no-store' } })
export { json }

/** One error shape for every route: a Refusal's words and status, bad JSON as 400, anything else an opaque 500. */
export async function handle(fn: () => Promise<Response>): Promise<Response> {
  try {
    return await fn()
  } catch (err) {
    if (err instanceof Refusal) {
      const res = json(err.retryAfter ? { error: err.message, retryAfter: err.retryAfter } : { error: err.message }, err.status)
      if (err.retryAfter) res.headers.set('retry-after', String(err.retryAfter))
      return res
    }
    if (err instanceof SyntaxError) return json({ error: 'bad request' }, 400)
    console.error(err)
    return json({ error: 'something went wrong' }, 500)
  }
}

/**
 * The body of a request that signs a person in (/api/open, /api/session). It must be JSON, which a
 * form on another site cannot send without a preflight, and a browser that says the request came
 * from another site is refused (second review, finding 5).
 */
export async function sameSiteBody(req: Request): Promise<Record<string, unknown>> {
  const site = req.headers.get('sec-fetch-site')
  if (site && site !== 'same-origin' && site !== 'none') throw new Refusal('this request must come from this site', 403)
  if (!/^application\/json\b/i.test(req.headers.get('content-type') ?? '')) throw new Refusal('the body must be application/json', 415)
  return body(req)
}

export async function body(req: Request): Promise<Record<string, unknown>> {
  const b = await req.json()
  if (!b || typeof b !== 'object' || Array.isArray(b)) throw new Refusal('the body is a JSON object', 400)
  return b as Record<string, unknown>
}
