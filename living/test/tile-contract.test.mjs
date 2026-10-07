import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { checkTileNews, checkNewsLines, checkRouteCoverage } from '../tile-contract.mjs'

const NEWS = { photos: { announces: ['upload', 'heart'] }, agenda: { privateToOwner: 'own list' } }

test('every tile has a decision, and no decision names a tile that does not exist', () => {
  assert.deepEqual(checkTileNews({ tiles: ['photos', 'agenda'], tileNews: NEWS, kinds: ['upload', 'heart'] }), [])
  assert.match(checkTileNews({ tiles: ['photos', 'agenda', 'links'], tileNews: NEWS, kinds: ['upload', 'heart'] })[0], /links/)
  assert.match(checkTileNews({ tiles: ['photos'], tileNews: NEWS, kinds: ['upload', 'heart'] })[0], /agenda/)
})

test('a private or no-writes tile must say why', () => {
  const r = checkTileNews({ tiles: ['agenda'], tileNews: { agenda: { privateToOwner: '' } }, kinds: [] })
  assert.match(r[0], /agenda.*reason/)
  const r2 = checkTileNews({ tiles: ['t'], tileNews: { t: { noMemberWrites: ' ' } }, kinds: [] })
  assert.match(r2[0], /t.*reason/)
  assert.deepEqual(checkTileNews({ tiles: ['t'], tileNews: { t: { noMemberWrites: 'read only' } }, kinds: [] }), [])
})

test('every news kind belongs to a tile, and every announced kind exists', () => {
  assert.match(checkTileNews({ tiles: ['photos', 'agenda'], tileNews: NEWS, kinds: ['upload', 'heart', 'orphan'] })[0], /orphan/)
  assert.match(checkTileNews({ tiles: ['photos', 'agenda'], tileNews: NEWS, kinds: ['upload'] })[0], /heart/)
})

test('every news line starts with the person', () => {
  assert.deepEqual(checkNewsLines({ kinds: ['a'], lineFor: () => 'Ana shared', name: 'Ana' }), [])
  assert.match(checkNewsLines({ kinds: ['a'], lineFor: () => 'Links: new', name: 'Ana' })[0], /a/)
  // startsWith must be exact on the word: a longer name is not the person
  assert.equal(checkNewsLines({ kinds: ['a'], lineFor: () => 'Anaïs shared', name: 'Ana' }).length, 1)
})

function app(extra = {}) {
  const root = mkdtempSync(join(tmpdir(), 'tile-contract-'))
  const put = (p, s) => { mkdirSync(dirname(join(root, p)), { recursive: true }); writeFileSync(join(root, p), s) }
  put('src/app/api/photos/route.ts', "import { save } from '@/lib/photos'\nexport async function POST() { return save() }")
  put('src/lib/photos.ts', 'export function save() { announcePhoto(); }')
  put('src/app/api/photos/upload-url/route.ts', 'export async function POST() {}')
  put('src/app/api/photos/[id]/route.ts', 'export async function PATCH() {}')
  put('src/app/api/agenda/route.ts', 'export async function POST() {}')
  put('src/app/api/photos/list/route.ts', 'export async function GET() {}')
  for (const [p, s] of Object.entries(extra)) put(p, s)
  return root
}
const tileForPath = (p) => (p.startsWith('/api/photos') ? 'photos' : p.startsWith('/api/agenda') ? 'agenda' : null)
const opts = (root) => ({ appDir: join(root, 'src/app'), apiRoot: join(root, 'src/app/api'), libDirs: { '@/lib/': join(root, 'src/lib/') }, tileForPath, tileNews: NEWS })

test('a write route that neither announces nor is quiet for a reason is caught', () => {
  const root = app()
  try {
    const r = checkRouteCoverage({ ...opts(root), quietRoutes: {} })
    assert.deepEqual(r.silent, ['/api/photos/[id]'])
    assert.equal(r.checked.length, 4) // GET-only route is not a write
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('a quiet route with a reason passes; a quiet route that no longer exists is stale', () => {
  const root = app()
  try {
    const r = checkRouteCoverage({ ...opts(root),
      quietRoutes: { '/api/photos/[id]': 'hiding tidies', '/api/photos/gone': 'old' } })
    assert.deepEqual(r.silent, [])
    assert.deepEqual(r.stale, ['/api/photos/gone'])
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('an upload-url ticket route is exempt by default, and the exemption can be replaced', () => {
  const root = app()
  try {
    const base = { ...opts(root), quietRoutes: { '/api/photos/[id]': 'x' } }
    assert.deepEqual(checkRouteCoverage(base).silent, [])
    assert.deepEqual(checkRouteCoverage({ ...base, exempt: () => false }).silent, ['/api/photos/upload-url'])
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('a module that only DEFINES an announce function does not make a route announce (ignoreLibs)', () => {
  const root = app({
    'src/lib/us/announce.ts': 'export function announceThing() {}',
    'src/app/api/photos/thing/route.ts': "import { announceThing } from '@/lib/us/announce'\nexport async function POST() { return 1 }",
  })
  try {
    const base = { ...opts(root), quietRoutes: { '/api/photos/[id]': 'x' } }
    // without ignoreLibs the definition is mistaken for a call
    assert.deepEqual(checkRouteCoverage(base).silent, [])
    const r = checkRouteCoverage({ ...base, ignoreLibs: ['/lib/us/announce.ts'] })
    assert.deepEqual(r.silent, ['/api/photos/thing'])
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('a route in a private or unknown tile is not held to announcing', () => {
  const root = app()
  try {
    const r = checkRouteCoverage({ ...opts(root), quietRoutes: { '/api/photos/[id]': 'x' } })
    assert.ok(r.checked.includes('/api/agenda'))
    assert.deepEqual(r.silent, [])
  } finally { rmSync(root, { recursive: true, force: true }) }
})
