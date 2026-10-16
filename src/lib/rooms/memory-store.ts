import type { Data, Doc, ListOptions, Store, Tx } from './store'

// The test store. Transactions apply their writes only when the function returns, so a refusal
// thrown halfway leaves nothing behind, as Firestore does.
export class MemoryStore implements Store {
  docs = new Map<string, Data>()

  async get(path: string) { const d = this.docs.get(path); return d ? structuredClone(d) : null }

  async list(collection: string, opts: ListOptions = {}): Promise<Doc[]> {
    const depth = collection.split('/').length + 1
    let out: Doc[] = []
    for (const [path, data] of this.docs) {
      if (!path.startsWith(collection + '/') || path.split('/').length !== depth) continue
      if (opts.after && !((data[opts.after.field] as number) > opts.after.value)) continue
      out.push({ id: path.split('/').pop()!, data: structuredClone(data) })
    }
    if (opts.orderBy) { const f = opts.orderBy; out.sort((a, b) => ((a.data[f] as number) > (b.data[f] as number) ? 1 : -1)) }
    if (opts.limit) out = out.slice(0, opts.limit)
    return out
  }

  async transaction<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
    const writes: [string, Data, boolean][] = []
    const tx: Tx = {
      // Firestore refuses a read after any write in the same transaction; so does this, so the
      // tests catch it rather than production (2026-10-15: retireMember did exactly that).
      get: (p) => {
        if (writes.length) return Promise.reject(new Error('Firestore transactions require all reads to be executed before all writes.'))
        return this.get(p)
      },
      set: (p, d) => { writes.push([p, d, false]) },
      update: (p, d) => { writes.push([p, d, true]) },
    }
    const result = await fn(tx)
    for (const [p, d, merge] of writes) {
      if (merge && !this.docs.has(p)) throw new Error(`update of a missing document: ${p}`)
      this.docs.set(p, merge ? { ...this.docs.get(p), ...structuredClone(d) } : structuredClone(d))
    }
    return result
  }
}
