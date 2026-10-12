// THE SEARCH CONTRACT. A tile/content source cannot quietly be omitted from search, and an
// `indexed` declaration earns its name only through the app's actual list/load/index/search.
// No package dependency: adapters run in the app's test runner, with external IO replaced by
// local fixtures. Decisions, review references and integration rules: living/SEARCH.md.
const reason = (s) => typeof s === 'string' && s.trim().length > 0
const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k)

export function checkSearchDecisions({ tiles, sources, decisions, reviewedDebt = {} }) {
  const problems = [], notSearched = [], debt = []
  const ids = new Set(), represented = new Set()
  for (const source of sources) {
    if (!reason(source.id)) problems.push('search source has no id')
    if (ids.has(source.id)) problems.push(`source "${source.id}" is listed twice`)
    ids.add(source.id)
    represented.add(source.tile)
    if (!tiles.includes(source.tile)) problems.push(`source "${source.id}" names unknown tile "${source.tile}"`)
    if (!own(decisions, source.id)) problems.push(`source "${source.id}" has no search decision`)
  }
  for (const tile of tiles) if (!represented.has(tile)) problems.push(`tile "${tile}" has no content source/search decision`)
  for (const [id, d] of Object.entries(decisions)) {
    if (!ids.has(id)) problems.push(`search decision "${id}" has no content source`)
    const states = ['indexed', 'notSearched', 'gap'].filter((k) => own(d ?? {}, k))
    if (states.length !== 1) { problems.push(`source "${id}" must have exactly one search decision`); continue }
    const state = states[0]
    const keys = Object.keys(d)
    if (keys.some((k) => !['indexed', 'notSearched', 'gap', ...(state === 'indexed' ? ['access'] : [])].includes(k))) problems.push(`source "${id}" has an unknown search decision field`)
    if (state === 'indexed') {
      if (d.indexed !== true) problems.push(`source "${id}" must say indexed: true`)
      if (d.access !== undefined && d.access !== 'restricted') problems.push(`source "${id}" has unknown search access; use restricted for private content`)
    } else if (!reason(d[state])) problems.push(`source "${id}" needs a nonempty ${state} reason`)
    else if (state === 'notSearched') notSearched.push([id, d[state]])
    else {
      const reviewed = reviewedDebt[id]
      if (!reviewed || !reason(reviewed.reason) || !reason(reviewed.review)) problems.push(`source "${id}" is a search gap; it fails until indexed or explicit reviewed debt names a reason and review reference`)
      else debt.push([id, reviewed])
    }
  }
  for (const id of Object.keys(reviewedDebt)) if (!ids.has(id) || !own(decisions[id] ?? {}, 'gap')) problems.push(`reviewed search debt "${id}" is stale: the source is not a gap`)
  return { ok: problems.length === 0, problems, notSearched, debt }
}

/**
 * Execute real app behavior for every indexed source, including sources whose tile defaults OFF.
 * The app supplies isolated fixtures and adapters to production list/load/index/search functions;
 * declarations alone, a second INDEXED_TILES list, and mocked search results do not earn coverage.
 * Search adapters must go through the app's authentication boundary for null/unknown readers.
 */
export async function checkSearchCoverage(options) {
  const { tiles, sources, decisions, members = [], probes = [], list, load, index, search, setTileEnabled } = options
  const result = checkSearchDecisions(options)
  const { problems } = result
  for (const [name, fn] of Object.entries({ list, load, index, search, setTileEnabled })) {
    if (typeof fn !== 'function') problems.push(`search coverage needs the real ${name} adapter`)
  }
  if (!members.length || members.some((m) => !reason(m)) || new Set(members).size !== members.length) problems.push('search coverage needs distinct enrolled member ids')
  for (const source of sources) {
    if (decisions[source.id]?.indexed === true && !probes.some((p) => p.source === source.id)) problems.push(`indexed source "${source.id}" has no behavioral probe`)
  }
  for (const p of probes) {
    const prefix = `source "${p.source}"`
    if (!sources.some((s) => s.id === p.source) || decisions[p.source]?.indexed !== true) problems.push(`${prefix} has a probe but is not indexed`)
    if (![p.id, p.query, p.href].every(reason) || !p.href?.startsWith('/') || p.href === '/') problems.push(`${prefix} probe needs an id, a query from its content, and its exact item href`)
    if (!Array.isArray(p.readers) || !p.readers.length || p.readers.some((m) => !members.includes(m))) problems.push(`${prefix} probe needs permitted enrolled readers`)
    if (decisions[p.source]?.access === 'restricted') {
      if (!members.some((m) => !p.readers?.includes(m))) problems.push(`${prefix} private probe needs a denied member`)
      if (typeof p.revoke !== 'function' || !p.revokedReaders?.length || p.revokedReaders.some((m) => !p.readers?.includes(m))) problems.push(`${prefix} private probe needs a revocation and previously permitted readers, leaving the old index in place`)
    }
  }
  // Never run a partly declared adapter against fixtures: its errors can hide the actual gap.
  if (problems.length) return { ...result, ok: false }
  let outsider = '__search_contract_outsider__'
  while (members.includes(outsider)) outsider += '_'
  const isHit = (hits, p) => hits.some((h) => h.id === p.id && h.href === p.href)
  for (const p of probes) {
    const source = sources.find((s) => s.id === p.source)
    const prefix = `source "${p.source}"`
    let phase = 'enable'
    try {
      await setTileEnabled(source.tile, true)
      phase = 'backfill'
      if (!(await list()).includes(p.id)) problems.push(`${prefix} backfill never lists its fixture`)
      phase = 'load'
      const asset = await load(p.id)
      if (!asset || asset.id !== p.id || asset.href !== p.href) problems.push(`${prefix} loader never returns its fixture at the exact item href`)
      if (decisions[p.source].access === 'restricted' && (!asset?.visibleTo?.length || p.readers.some((m) => !asset.visibleTo.includes(m)) || asset.visibleTo.some((m) => !p.readers.includes(m)))) problems.push(`${prefix} private loader has wider or missing reader permissions`)
      phase = 'index'
      await index(p.id)
      phase = 'search'
      for (const reader of p.readers) if (!isHit(await search(reader, p.query), p)) problems.push(`${prefix} search never finds its indexed fixture for ${reader} at the exact item href`)
      for (const reader of members.filter((m) => !p.readers.includes(m))) if ((await search(reader, p.query)).some((h) => h.id === p.id)) problems.push(`${prefix} private fixture leaks to denied member ${reader}`)
      for (const reader of [null, outsider]) if ((await search(reader, p.query)).length) problems.push(`${prefix} search returns content to a signed-out or unknown reader`)
      phase = 'disabled'
      await setTileEnabled(source.tile, false)
      if ((await list()).includes(p.id)) problems.push(`${prefix} disabled tile still appears in backfill`)
      if (await load(p.id)) problems.push(`${prefix} disabled tile still loads an asset`)
      for (const reader of p.readers) if ((await search(reader, p.query)).some((h) => h.id === p.id)) problems.push(`${prefix} disabled tile still returns a search hit`)
      await setTileEnabled(source.tile, true)
      if (p.revoke) {
        phase = 'revocation'
        await p.revoke()
        // Deliberately do not re-index/forget: the live authorization boundary must refuse stale entries.
        for (const reader of p.revokedReaders) if ((await search(reader, p.query)).some((h) => h.id === p.id)) problems.push(`${prefix} search leaks a stale entry to revoked reader ${reader}`)
      }
    } catch (e) { problems.push(`${prefix} ${phase} probe threw ${e?.name ?? 'an error'}`) }
    finally { await setTileEnabled(source.tile, true) }
  }
  return { ...result, ok: problems.length === 0 }
}
