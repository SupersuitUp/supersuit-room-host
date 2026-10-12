# Search coverage

Every tile and every content source must decide its search coverage. Private content is
searchable by its permitted readers; privacy is a permission boundary, not a reason to leave
content unfindable. The shared checks are [search-contract.mjs](search-contract.mjs).

A template puts an integration test calling `checkSearchCoverage` in the tests its `living:check`
runs. It passes the authoritative tile registry, including default-OFF tiles, and the complete
content-source inventory. A tile may contain several sources: a recording, its transcript and
comments can each need a separate probe, even when several sources share one resulting entry.
An entry linking to a tile's home does not prove the item can be reopened; each probe names its
exact item address. Keep the test in the template so every tailored copy inherits it.

Each source declares exactly one state:

- `{ indexed: true }`: shared content reaches actual indexing and search.
- `{ indexed: true, access: 'restricted' }`: private content reaches search for its permitted
  readers and is denied to another enrolled member. Include a live-permission revocation probe.
- `{ notSearched: '<reason>' }`: an intentional product decision, such as an ephemeral status
  indicator with no retained content. Write the reason. Do not call missing implementation an
  intentional exclusion, and do not use privacy as a shortcut.
- `{ gap: '<missing implementation>' }`: debt. It **fails by default**. An existing gap can be
  allowed only by an explicit `reviewedDebt` entry with a nonempty `reason` and `review` reference
  identifying the accepted decision (a review, issue, or committed design). Never invent human
  approval or add a new gap to the allowance just to make a check green. The allowance is stale,
  and fails, as soon as the source is indexed or removed. Print `result.debt` and
  `result.notSearched` in the integration test so accepted debt and exclusions remain visible.

`checkSearchDecisions` checks declarations independently. `checkSearchCoverage` also refuses an
indexed source with no probe or a missing adapter, then executes these behaviors per fixture:

1. The production backfill lists it; the production loader returns it at the expected item URL.
2. The production indexer indexes it; the authenticated search route returns it for each reader.
3. Another enrolled member cannot find restricted content; signed-out and unknown readers get
   no results for any source.
4. Switching its tile OFF removes it from backfill, loading and search, even with an old entry.
5. For restricted content, narrow live permissions **without** updating/forgetting its old index.
   Previously permitted readers must stop finding it. Stale stored permissions never grant access.

Use isolated fixture storage and deterministic model responses; keep the production loader,
backfill, indexing, search, presentation, authentication boundary and live authorization code.
Never mock search results, return a declared list from the `list` adapter, or compare a coverage
map only to another `INDEXED_TILES` array. Those assertions stay green when the real path breaks.
Production app mutations are not allowed: `setTileEnabled` and `revoke` act only on test state.
The contract restores each test tile to enabled after its probe; dispose of fixture state after
that integration test.

## Wiring a template

Import `checkSearchCoverage` and `SearchDecision` from `living/search-contract`. Use a
`Record<ContentSource, SearchDecision>` where `ContentSource` includes the tile union plus every
additional source. A newly added tile or source then needs a decision before typechecking.

Call the checker with:

```ts
const result = await checkSearchCoverage({
  tiles: TILES,
  sources: CONTENT_SOURCES, // exhaustive inventory, including sources not searched yet
  decisions: SOURCE_SEARCH,
  reviewedDebt: ACCEPTED_SEARCH_DEBT, // omit unless a real review accepted existing debt
  members: MEMBERS,
  probes: [{
    source: 'notes', id: 'note-fixture', query: 'cobalt lantern', href: '/notes/note-fixture',
    readers: ['member-a'],
    revoke: async () => { /* remove member-a's live permission in the fixture store */ },
    revokedReaders: ['member-a'],
  }], // at least one probe for every indexed source, not just this private example
  list: listEveryRealBackfillPage,
  load: loadAsset,
  index: (id) => indexById(fixtureHost, id),
  search: searchThroughTheRealAuthenticatedRoute,
  setTileEnabled: (tile, enabled) => { fixtureTileFlags[tile] = enabled },
})
console.info({ searchDebt: result.debt, notSearched: result.notSearched })
expect(result.problems).toEqual([])
```

The exact host and request wiring belongs to the template. This library intentionally knows no
Firestore collection, media model or package API. Add fixtures for distinct record shapes and
permissions; one token fixture does not prove every subtype is searchable. External storage and
model calls can be replaced, but the program that turns the stored record into a hit must run.

Run the shared proofs with `node --test living/test/search-contract.test.mjs`. Run the template's
own integration tests and its complete `living:check` before publishing a template update. A new
copy's check must include this integration test; adding only this document or a decision map does
not satisfy the contract.

## Migrating an existing template with unapproved gaps

Do not invent a review reference, relabel debt as `notSearched`, or leave the ordinary update gate
permanently red just to inventory existing omissions. A partial adoption may keep an explicit,
frozen baseline of the legacy gaps, report their names/reasons on every ordinary check, reject
new gaps and malformed/stale decisions, and run `checkSearchCoverage` for every already indexed
source. Add a separate strict adoption command that runs `checkSearchDecisions` over the complete
inventory and fails on every unapproved gap. Mark the template **partially adopted**, not fully
compliant, until that strict command passes. The baseline is an inventory, never reviewed debt.
Indexing a source removes it from the baseline; do not expand it to accommodate new work.
