export type SearchDecision =
  | { indexed: true; access?: 'restricted' }
  | { notSearched: string }
  | { gap: string }

export interface SearchSource { id: string; tile: string }
/** A review reference identifies an actual accepted decision. Never invent a human approval. */
export interface ReviewedSearchDebt { reason: string; review: string }
export interface SearchDecisions {
  /** The authoritative tile registry, including tiles which default OFF. */
  tiles: readonly string[]
  /** Every content source, including multiple stores/streams under the same tile. */
  sources: readonly SearchSource[]
  decisions: Record<string, SearchDecision>
  reviewedDebt?: Record<string, ReviewedSearchDebt>
}
export interface SearchCoverageResult {
  ok: boolean
  problems: string[]
  notSearched: [string, string][]
  debt: [string, ReviewedSearchDebt][]
}
export function checkSearchDecisions(options: SearchDecisions): SearchCoverageResult
export interface SearchProbe {
  source: string
  id: string
  /** A query from this fixture's content, not an id or unrelated model-only words. */
  query: string
  href: string
  readers: readonly string[]
  /** Narrow the live permissions, leaving its previous search index entry in place. */
  revoke?: () => void | Promise<void>
  revokedReaders?: readonly string[]
}
export interface SearchCoverage extends SearchDecisions {
  members: readonly string[]
  probes: readonly SearchProbe[]
  /** Read the real backfill, paging until its end. */
  list: () => Promise<readonly string[]>
  load: (id: string) => Promise<{ id: string; href: string; visibleTo?: readonly string[] } | null>
  /** Run the production indexer, replacing only network/model IO with deterministic fixtures. */
  index: (id: string) => Promise<unknown>
  /** Use the app's actual authenticated search route, including null and unknown reader checks. */
  search: (reader: string | null, query: string) => Promise<readonly { id: string; href: string }[]>
  /** Mutate only isolated test configuration; the contract checks both enabled and disabled. */
  setTileEnabled: (tile: string, enabled: boolean) => void | Promise<void>
}
export function checkSearchCoverage(options: SearchCoverage): Promise<SearchCoverageResult>
