// The storage contract. The room service is written against this and nothing else, so every rule
// is tested on the memory store and production swaps in Firestore without the rules changing.
// Paths are slash-separated document paths ("rooms/r1/members/m1"); a collection path has an odd
// number of segments.
export type Data = Record<string, unknown>
export type Doc = { id: string; data: Data }

export interface Tx {
  get(path: string): Promise<Data | null>
  set(path: string, data: Data): void
  update(path: string, data: Data): void
}

export interface ListOptions {
  /** Only documents whose numeric field is strictly greater than this value. */
  after?: { field: string; value: number }
  orderBy?: string
  limit?: number
}

export interface Store {
  get(path: string): Promise<Data | null>
  list(collection: string, opts?: ListOptions): Promise<Doc[]>
  /** All reads first, then writes; the writes land together or not at all. */
  transaction<T>(fn: (tx: Tx) => Promise<T>): Promise<T>
}
