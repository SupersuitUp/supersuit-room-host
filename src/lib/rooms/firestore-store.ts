import type { DocumentData, Firestore, Query, Transaction } from 'firebase-admin/firestore'
import type { Data, Doc, ListOptions, Store, Tx } from './store'

// The production store. Paths map one to one onto Firestore document paths. It is handed its
// database, so the server (src/lib/server/ctx.ts) and the operator script (scripts/admin.ts) share it.
export class FirestoreStore implements Store {
  constructor(private db: Firestore) {}

  async get(path: string): Promise<Data | null> {
    const s = await this.db.doc(path).get()
    return s.exists ? (s.data() as Data) : null
  }

  async list(collection: string, opts: ListOptions = {}): Promise<Doc[]> {
    let q: Query<DocumentData> = this.db.collection(collection)
    if (opts.after) q = q.where(opts.after.field, '>', opts.after.value)
    if (opts.orderBy) q = q.orderBy(opts.orderBy)
    if (opts.limit) q = q.limit(opts.limit)
    const s = await q.get()
    return s.docs.map((d) => ({ id: d.id, data: d.data() as Data }))
  }

  transaction<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
    return this.db.runTransaction(async (t: Transaction) => {
      const tx: Tx = {
        get: async (p) => { const s = await t.get(this.db.doc(p)); return s.exists ? (s.data() as Data) : null },
        set: (p, d) => { t.set(this.db.doc(p), d) },
        update: (p, d) => { t.update(this.db.doc(p), d) },
      }
      return fn(tx)
    })
  }
}
