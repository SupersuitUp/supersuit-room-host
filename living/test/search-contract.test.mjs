import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as contract from '../search-contract.mjs'

// Removing a source from the real loader/list/search, widening private access, or letting a
// disabled tile leak a stale entry must fail these tests. Expectations are literal fixtures.
const declarations = () => ({
  tiles: ['photos', 'notes'],
  sources: [{ id: 'photos', tile: 'photos' }, { id: 'notes', tile: 'notes' }],
  decisions: { photos: { indexed: true }, notes: { indexed: true, access: 'restricted' } },
})

test('every tile and content source must decide, with no stale or ambiguous decisions', () => {
  assert.equal(typeof contract.checkSearchDecisions, 'function')
  const base = declarations()
  assert.deepEqual(contract.checkSearchDecisions(base).problems, [])
  assert.match(contract.checkSearchDecisions({ ...base, tiles: [...base.tiles, 'calls'] }).problems.join('\n'), /calls.*source/)
  assert.match(contract.checkSearchDecisions({ ...base, sources: [...base.sources, { id: 'replies', tile: 'notes' }] }).problems.join('\n'), /replies.*decision/)
  assert.match(contract.checkSearchDecisions({ ...base, decisions: { ...base.decisions, gone: { indexed: true } } }).problems.join('\n'), /gone.*source/)
  assert.match(contract.checkSearchDecisions({ ...base, decisions: { ...base.decisions, notes: { indexed: true, notSearched: 'private' } } }).problems.join('\n'), /notes.*exactly one/)
  assert.match(contract.checkSearchDecisions({ ...base, decisions: { ...base.decisions, notes: { notSearched: ' ' } } }).problems.join('\n'), /notes.*reason/)
})

test('gaps fail by default and only explicit, reasoned reviewed debt can allow them', () => {
  assert.equal(typeof contract.checkSearchDecisions, 'function')
  const base = declarations()
  base.decisions.notes = { gap: 'Private notes need owner-only indexing' }
  assert.match(contract.checkSearchDecisions(base).problems.join('\n'), /notes.*gap/)
  const reviewedDebt = { notes: { reason: 'Existing release debt', review: 'review/2026-10-12-notes' } }
  assert.deepEqual(contract.checkSearchDecisions({ ...base, reviewedDebt }).problems, [])
  assert.equal(contract.checkSearchDecisions({ ...base, reviewedDebt }).debt.length, 1)
  assert.match(contract.checkSearchDecisions({ ...base, reviewedDebt: { notes: { reason: 'existing', review: ' ' } } }).problems.join('\n'), /notes.*review/)
  assert.match(contract.checkSearchDecisions({ ...declarations(), reviewedDebt }).problems.join('\n'), /notes.*stale/)
})

function app(broken = '') {
  const enabled = { photos: true, notes: true }
  const assets = {
    p1: { id: 'p1', href: '/photos/p1', visibleTo: [], tile: 'photos', text: 'amber kite' },
    n1: { id: 'n1', href: '/notes/n1', visibleTo: ['ana'], tile: 'notes', text: 'cobalt lantern' },
  }
  const index = new Map()
  return {
    ...declarations(), members: ['ana', 'ben'],
    probes: [
      { source: 'photos', id: 'p1', query: 'amber kite', href: '/photos/p1', readers: ['ana', 'ben'] },
      { source: 'notes', id: 'n1', query: 'cobalt lantern', href: '/notes/n1', readers: ['ana'],
        revoke: async () => { delete assets.n1 }, revokedReaders: ['ana'] },
    ],
    setTileEnabled: async (tile, on) => { enabled[tile] = on },
    list: async () => Object.values(assets).filter((a) => enabled[a.tile] && !(broken === 'list' && a.id === 'n1')).map((a) => a.id),
    load: async (id) => {
      const a = assets[id]
      return a && !(broken === 'load' && id === 'n1') && (enabled[a.tile] || broken === 'disabled-load') ? a : null
    },
    index: async (id) => {
      if (broken !== 'index') index.set(id, { ...assets[id] })
    },
    search: async (reader, query) => {
      if (!['ana', 'ben'].includes(reader) && broken !== 'stranger') return []
      return [...index.values()].filter((a) => a.text.includes(query)
        && (enabled[a.tile] || broken === 'disabled-search')
        && (assets[a.id] || broken === 'stale')
        && (!a.visibleTo.length || a.visibleTo.includes(reader) || broken === 'private'))
    },
  }
}

test('indexed means the real listing, loader and search return the fixture to permitted readers', async () => {
  assert.equal(typeof contract.checkSearchCoverage, 'function')
  assert.deepEqual((await contract.checkSearchCoverage(app())).problems, [])
})

for (const [broken, why] of [
  ['list', /notes.*backfill/], ['load', /notes.*loader/], ['index', /photos.*search/], ['private', /notes.*ben/],
  ['stranger', /photos.*signed.out/], ['disabled-search', /photos.*disabled.*search/],
  ['disabled-load', /photos.*disabled.*load/], ['stale', /notes.*revoked/],
]) {
  test(`behavioral proof rejects ${broken}`, async () => {
    assert.equal(typeof contract.checkSearchCoverage, 'function')
    const r = await contract.checkSearchCoverage(app(broken))
    assert.match(r.problems.join('\n'), why)
  })
}

test('an indexed declaration without a behavioral probe is refused', async () => {
  assert.equal(typeof contract.checkSearchCoverage, 'function')
  const base = app()
  base.probes = base.probes.filter((p) => p.source !== 'notes')
  assert.match((await contract.checkSearchCoverage(base)).problems.join('\n'), /notes.*probe/)
})

test('restricted content needs a denied enrolled reader and a stale-permission revocation probe', async () => {
  assert.equal(typeof contract.checkSearchCoverage, 'function')
  const base = app()
  base.probes[1].readers = ['ana', 'ben']
  delete base.probes[1].revoke
  assert.match((await contract.checkSearchCoverage(base)).problems.join('\n'), /notes.*denied member/)
  assert.match((await contract.checkSearchCoverage(base)).problems.join('\n'), /notes.*revocation/)
})


test('unknown sources, duplicate sources and invalid indexed flags cannot escape coverage', () => {
  const base = declarations()
  assert.match(contract.checkSearchDecisions({ ...base, sources: [...base.sources, { id: 'photos', tile: 'gone' }] }).problems.join('\n'), /photos.*twice/)
  assert.match(contract.checkSearchDecisions({ ...base, sources: [{ id: 'photos', tile: 'gone' }, base.sources[1]] }).problems.join('\n'), /unknown tile/)
  assert.match(contract.checkSearchDecisions({ ...base, decisions: { ...base.decisions, photos: { indexed: false } } }).problems.join('\n'), /indexed: true/)
})

test('missing adapters fail rather than accepting a declarations-only proof', async () => {
  const result = await contract.checkSearchCoverage({ ...declarations(), members: ['ana', 'ben'] })
  assert.match(result.problems.join('\n'), /real search adapter/)
  assert.match(result.problems.join('\n'), /photos.*probe/)
})

test('a restricted source can also prove a shared record before revoking one reader', async () => {
  const base = app()
  // The source already has an owner-only probe; a shared subtype should not make that source
  // impossible to test. Its stale entry must be denied after a live unshare as well.
  const index = new Map()
  let allowed = ['ana', 'ben']
  base.probes.push({ source: 'notes', id: 'n2', query: 'shared parchment', href: '/notes/n2', readers: ['ana', 'ben'],
    revoke: async () => { allowed = ['ben'] }, revokedReaders: ['ana'] })
  const prior = { list: base.list, load: base.load, index: base.index, search: base.search, set: base.setTileEnabled }
  let enabled = true
  base.list = async () => [...await prior.list(), ...(enabled ? ['n2'] : [])]
  base.load = async (id) => id === 'n2' ? enabled ? { id, href: '/notes/n2', visibleTo: [...allowed] } : null : prior.load(id)
  base.index = async (id) => id === 'n2' ? index.set(id, true) : prior.index(id)
  base.setTileEnabled = async (tile, on) => { if (tile === 'notes') enabled = on; await prior.set(tile, on) }
  base.search = async (reader, query) => query === 'shared parchment'
    ? enabled && allowed.includes(reader) && index.has('n2') ? [{ id: 'n2', href: '/notes/n2' }] : []
    : prior.search(reader, query)
  assert.deepEqual((await contract.checkSearchCoverage(base)).problems, [])
})
