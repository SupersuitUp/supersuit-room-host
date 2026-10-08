import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { checkAssetIndexing } from '../asset-contract.mjs'

const CLI = join(dirname(fileURLToPath(import.meta.url)), '..', 'asset-contract.mjs')
const WRITER = "export async function put(b, buf) { await b.file('x.png').save(buf) }\n"
const PKG = (deps = {}) => JSON.stringify({ name: 'app', dependencies: deps })

function repo(files) {
  const root = mkdtempSync(join(tmpdir(), 'asset-contract-'))
  for (const [p, s] of Object.entries(files)) {
    mkdirSync(dirname(join(root, p)), { recursive: true })
    writeFileSync(join(root, p), s)
  }
  return root
}
function withRepo(files, fn) {
  const root = repo(files)
  try { return fn(root) } finally { rmSync(root, { recursive: true, force: true }) }
}

test('no writers is ok', () => withRepo({ 'package.json': PKG(), 'src/lib/a.ts': 'export const a = 1\n' }, (r) => {
  assert.deepEqual(checkAssetIndexing({ repo: r }), { ok: true, problems: [] })
}))

test('a writer with no package names the file and the dependency', () => withRepo({ 'package.json': PKG(), 'src/lib/photos.ts': WRITER }, (r) => {
  const res = checkAssetIndexing({ repo: r })
  assert.equal(res.ok, false)
  assert.ok(res.problems.some((p) => p.includes('src/lib/photos.ts')))
  assert.ok(res.problems.some((p) => /dependenc/.test(p) && p.includes('@supersuit/asset-index')))
}))

test('a writer importing a relative module that imports the package is ok', () => withRepo({
  'package.json': PKG({ '@supersuit/asset-index': '^0.1.0' }),
  'src/lib/photos.ts': "import { track } from './asset-index'\n" + WRITER,
  'src/lib/asset-index.ts': "import { indexAsset } from '@supersuit/asset-index'\nexport const track = indexAsset\n",
}, (r) => assert.deepEqual(checkAssetIndexing({ repo: r }), { ok: true, problems: [] })))

test('one hop resolves through /index.ts', () => withRepo({
  'package.json': PKG({ '@supersuit/asset-index': '^0.1.0' }),
  'src/lib/photos.ts': "import { track } from './indexing'\n" + WRITER,
  'src/lib/indexing/index.ts': "import { indexAsset } from '@supersuit/asset-index/server'\nexport const track = indexAsset\n",
}, (r) => assert.deepEqual(checkAssetIndexing({ repo: r }), { ok: true, problems: [] })))

test('a second hop does not count', () => withRepo({
  'package.json': PKG({ '@supersuit/asset-index': '^0.1.0' }),
  'src/lib/photos.ts': "import './a'\n" + WRITER,
  'src/lib/a.ts': "import './b'\n",
  'src/lib/b.ts': "import { indexAsset } from '@supersuit/asset-index'\n",
}, (r) => assert.ok(checkAssetIndexing({ repo: r }).problems.some((p) => p.includes('src/lib/photos.ts')))))

test('a writer that imports the package itself is ok', () => withRepo({
  'package.json': PKG({ '@supersuit/asset-index': '^0.1.0' }),
  'src/lib/photos.ts': "import { indexAsset } from '@supersuit/asset-index'\n" + WRITER,
}, (r) => assert.equal(checkAssetIndexing({ repo: r }).ok, true)))

test('an exempt comment with a reason is ok, and needs no dependency', () => withRepo({
  'package.json': PKG(),
  'src/lib/photos.ts': '// asset-index: exempt thumbnails are derived, the original is indexed\n' + WRITER,
}, (r) => assert.deepEqual(checkAssetIndexing({ repo: r }), { ok: true, problems: [] })))

test('an exempt comment with no reason is still a problem', () => withRepo({
  'package.json': PKG(),
  'src/lib/photos.ts': '// asset-index: exempt   \n' + WRITER,
}, (r) => assert.ok(checkAssetIndexing({ repo: r }).problems.some((p) => p.includes('src/lib/photos.ts')))))

test('a multi-line getSignedUrl write is a writer', () => withRepo({
  'package.json': PKG(),
  'src/app/api/upload-url/route.ts': "const [url] = await f.getSignedUrl({\n  version: 'v4',\n  action: 'write',\n  expires: 1,\n})\n",
}, (r) => assert.ok(checkAssetIndexing({ repo: r }).problems.some((p) => p.includes('src/app/api/upload-url/route.ts')))))

test('a read-only getSignedUrl is not a writer', () => withRepo({
  'package.json': PKG(),
  'src/lib/read.ts': "const [url] = await f.getSignedUrl({ action: 'read', expires: 1 })\n",
}, (r) => assert.equal(checkAssetIndexing({ repo: r }).ok, true)))

test('test files, fixtures and node_modules are ignored', () => withRepo({
  'package.json': PKG(),
  'src/lib/photos.test.ts': WRITER,
  'src/lib/photos.spec.tsx': WRITER,
  'src/lib/__fixtures__/w.ts': WRITER,
  'src/node_modules/x/w.js': WRITER,
}, (r) => assert.equal(checkAssetIndexing({ repo: r }).ok, true)))

const NODEP = (r) => checkAssetIndexing({ repo: r }).problems.filter((p) => p.startsWith('package.json'))

test('a writer that imports the package but has no dependency is a problem', () => withRepo({
  'package.json': PKG(),
  'src/lib/photos.ts': "import { indexAsset } from '@supersuit/asset-index'\n" + WRITER,
}, (r) => { assert.equal(checkAssetIndexing({ repo: r }).ok, false); assert.equal(NODEP(r).length, 1) }))

test('a one-hop writer with no dependency is a problem', () => withRepo({
  'package.json': PKG(),
  'src/lib/photos.ts': "import { track } from './asset-index'\n" + WRITER,
  'src/lib/asset-index.ts': "import { indexAsset } from '@supersuit/asset-index'\n",
}, (r) => { assert.equal(checkAssetIndexing({ repo: r }).ok, false); assert.equal(NODEP(r).length, 1) }))

test('all writers exempt with no dependency is ok; one non-exempt writer brings the requirement back', () => {
  const ex = '// asset-index: exempt derived file\n' + WRITER
  withRepo({ 'package.json': PKG(), 'src/a.ts': ex, 'src/b.ts': ex }, (r) => assert.equal(checkAssetIndexing({ repo: r }).ok, true))
  withRepo({ 'package.json': PKG(), 'src/a.ts': ex, 'src/b.ts': "import 'x'\nimport { i } from '@supersuit/asset-index'\n" + WRITER },
    (r) => assert.equal(NODEP(r).length, 1))
})

test('CLI exits 0 clean, 1 with problems, 2 on bad args', () => {
  const bad = repo({ 'package.json': PKG(), 'src/lib/photos.ts': WRITER })
  const good = repo({ 'package.json': PKG(), 'src/a.ts': 'export {}\n' })
  try {
    const run = (...a) => spawnSync(process.execPath, [CLI, ...a], { encoding: 'utf8' })
    const b = run('--repo', bad)
    assert.equal(b.status, 1)
    assert.match(b.stdout + b.stderr, /src\/lib\/photos\.ts/)
    assert.equal(run('--repo', good).status, 0)
    assert.equal(run('--nope').status, 2)
  } finally { rmSync(bad, { recursive: true, force: true }); rmSync(good, { recursive: true, force: true }) }
})
