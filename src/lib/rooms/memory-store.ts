import type { Firestore } from 'firebase-admin/firestore'
import { createFirestore } from '../vendor/firestore-double/src/index.mjs'
import { FirestoreStore } from './firestore-store'
import type { Data } from './store'

// The test store: the production FirestoreStore, running on @supersuit/firestore-double (vendored by
// scripts/vendor-firestore-double.mjs). The double refuses what Firestore refuses (a read after a
// write in one transaction, update of a missing document, undefined values) with Firestore's own
// errors, and commits a transaction's writes together or not at all, so the tests exercise the
// production adapter against production's rules rather than a laxer copy of them (2026-10-15:
// retireMember read after writing and only production noticed).
export class MemoryStore extends FirestoreStore {
  /** Every stored document, keyed by full path ("rooms/r1/members/m1"). */
  readonly docs: Map<string, Data>

  constructor() {
    const db = createFirestore()
    super(db as unknown as Firestore)
    this.docs = db.docs
  }
}
