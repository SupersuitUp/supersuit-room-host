import { test } from 'node:test'
import assert from 'node:assert/strict'
import { writeFileSync, chmodSync, readdirSync, statSync, existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { bump } from '../bump.mjs'
import { tmp, cleanup, read, sh, head, originMain, commit } from './helpers.mjs'
import { startRegistry, isolateNpm, makeModuleChain, MOD } from './registry.mjs'

// One registry and one family per test, all real: npm, a lockfile, the template's own check.
async function family(t, setup, opts) {
  const base = tmp('bump')
  const reg = await startRegistry(base)
  t.after(() => { reg.close(); cleanup(base) })
  isolateNpm(base, reg)
  setup.before?.(reg)
  const c = makeModuleChain(base, opts)
  setup.after?.(reg)
  return { reg, c }
}
const spec = (repo, name = MOD) => JSON.parse(read(repo, 'package.json')).dependencies[name]
const locked = (repo, name = MOD) => JSON.parse(read(repo, 'package-lock.json')).packages[`node_modules/${name}`].version

test('a newer version inside the range is taken when the template\'s check passes', async (t) => {
  const { c } = await family(t, { before: (r) => r.publish(MOD, '0.1.2'), after: (r) => r.publish(MOD, '0.1.3') })
  const r = await bump({ repo: c.template.work })
  assert.equal(r.status, 'bumped', JSON.stringify(r))
  assert.deepEqual(r.taken, [{ name: MOD, from: '^0.1.2', to: '0.1.3' }])
  assert.equal(spec(c.template.work), '^0.1.3')
  assert.equal(locked(c.template.work), '0.1.3')
  assert.equal(originMain(c.template.work), head(c.template.work))
  assert.equal(sh(c.template.work, 'log', '-1', '--format=%s'), `living: take ${MOD} 0.1.3 (was ^0.1.2)`)
  assert.deepEqual(sh(c.template.work, 'show', '--name-only', '--format=', 'HEAD').split('\n').sort(), ['package-lock.json', 'package.json'])
  assert.equal(sh(c.template.work, 'worktree', 'list').split('\n').length, 1)
})

test('a newer version that fails the check is refused and nothing is published', async (t) => {
  const { c } = await family(t, { before: (r) => r.publish(MOD, '0.1.2'), after: (r) => r.publish(MOD, '0.1.3', { works: false }) })
  const before = head(c.template.work)
  const r = await bump({ repo: c.template.work })
  assert.equal(r.status, 'blocked')
  assert.equal(r.refused.length, 1)
  assert.equal(r.refused[0].name, MOD)
  assert.equal(r.refused[0].to, '0.1.3')
  assert.equal(r.refused[0].reason, 'check failed')
  assert.match(r.refused[0].output, /broke the app/)
  assert.deepEqual(r.taken, [])
  assert.equal(head(c.template.work), before)
  assert.equal(originMain(c.template.work), before)
  assert.equal(spec(c.template.work), '^0.1.2')
})

test('nothing newer: current, and no worktree is left behind', async (t) => {
  const { c } = await family(t, { before: (r) => r.publish(MOD, '0.1.2') })
  const r = await bump({ repo: c.template.work })
  assert.equal(r.status, 'current')
  assert.equal(sh(c.template.work, 'worktree', 'list').split('\n').length, 1)
})

test('a refused bump leaves no worktree behind either', async (t) => {
  const { c } = await family(t, { before: (r) => r.publish(MOD, '0.1.2'), after: (r) => r.publish(MOD, '0.1.3', { works: false }) })
  await bump({ repo: c.template.work })
  assert.equal(sh(c.template.work, 'worktree', 'list').split('\n').length, 1)
})

test('a dirty template is left exactly as it was', async (t) => {
  const { c } = await family(t, { before: (r) => r.publish(MOD, '0.1.2'), after: (r) => r.publish(MOD, '0.1.3') })
  writeFileSync(join(c.template.work, 'scratch.txt'), 'unsaved work\n')
  const before = head(c.template.work)
  const r = await bump({ repo: c.template.work })
  assert.equal(r.status, 'blocked')
  assert.deepEqual(r.blockedBy, { reason: 'dirty', files: ['scratch.txt'] })
  assert.equal(head(c.template.work), before)
  assert.equal(read(c.template.work, 'scratch.txt'), 'unsaved work\n')
})

// git's porcelain marks a modified tracked file " M path"; a reader that trims the line first
// and then drops three characters reports "ackage.json".
test('a dirty template names a modified tracked file by its whole path', async (t) => {
  const { c } = await family(t, { before: (r) => r.publish(MOD, '0.1.2'), after: (r) => r.publish(MOD, '0.1.3') })
  writeFileSync(join(c.template.work, 'check.mjs'), read(c.template.work, 'check.mjs') + '// edited\n')
  const before = head(c.template.work)
  const r = await bump({ repo: c.template.work })
  assert.deepEqual(r.blockedBy, { reason: 'dirty', files: ['check.mjs'] })
  assert.equal(head(c.template.work), before)
})

test('a dry run says what it would take and publishes nothing', async (t) => {
  const { c } = await family(t, { before: (r) => r.publish(MOD, '0.1.2'), after: (r) => r.publish(MOD, '0.1.3') })
  const before = head(c.template.work)
  const r = await bump({ repo: c.template.work, dryRun: true })
  assert.equal(r.status, 'ahead')
  assert.deepEqual(r.taken, [{ name: MOD, from: '^0.1.2', to: '0.1.3' }])
  assert.equal(originMain(c.template.work), before)
  assert.equal(head(c.template.work), before)
  assert.equal(spec(c.template.work), '^0.1.2')
  assert.equal(sh(c.template.work, 'worktree', 'list').split('\n').length, 1)
})

test('a repository with no package.json, or no modules, has nothing to bump', async (t) => {
  const { c } = await family(t, { before: (r) => r.publish(MOD, '0.1.2') })
  assert.equal((await bump({ repo: c.meta.work })).status, 'current')
})

// A git hook in the template checkout: the only way to make a real git step fail mid-take.
function hook(repo, name, body) {
  // absolute: a relative hooksPath resolves inside each worktree, where it does not exist
  sh(repo, 'config', 'core.hooksPath', join(repo, '.git', 'hooks'))
  const file = join(repo, '.git', 'hooks', name)
  writeFileSync(file, `#!/bin/sh\n${body}\n`)
  chmodSync(file, 0o755)
}
const newer = { before: (r) => r.publish(MOD, '0.1.2'), after: (r) => r.publish(MOD, '0.1.3') }

// The take is cut from origin, and only when the checkout IS origin's default branch, exactly.
// Otherwise a bump would publish someone's unpushed commits, or bump a branch nobody ships.
test('a checkout ahead of origin is blocked and its unpushed commit is never published', async (t) => {
  const { c } = await family(t, newer)
  const before = originMain(c.template.work)
  commit(c.template.work, { 'notes.txt': 'not reviewed yet\n' }, 'someone else: work in progress')
  const r = await bump({ repo: c.template.work })
  assert.equal(r.status, 'blocked')
  assert.deepEqual(r.blockedBy, { reason: 'ahead of origin' })
  assert.deepEqual(r.taken, [])
  assert.equal(originMain(c.template.work), before)
})

test('a checkout behind origin is blocked and nothing is published', async (t) => {
  const { c } = await family(t, newer)
  const other = join(c.base, 'other')
  sh(c.base, 'clone', '-q', c.template.bare, other)
  const moved = commit(other, { 'notes.txt': 'from elsewhere\n' }, 'elsewhere: a change')
  sh(other, 'push', '-q', 'origin', 'main')
  const r = await bump({ repo: c.template.work })
  assert.deepEqual(r.blockedBy, { reason: 'behind origin' })
  assert.equal(originMain(c.template.work), moved)
})

test('a checkout diverged from origin is blocked and nothing is published', async (t) => {
  const { c } = await family(t, newer)
  const other = join(c.base, 'other')
  sh(c.base, 'clone', '-q', c.template.bare, other)
  const moved = commit(other, { 'notes.txt': 'from elsewhere\n' }, 'elsewhere: a change')
  sh(other, 'push', '-q', 'origin', 'main')
  commit(c.template.work, { 'mine.txt': 'local\n' }, 'local: unpushed')
  const r = await bump({ repo: c.template.work })
  assert.deepEqual(r.blockedBy, { reason: 'diverged from origin' })
  assert.equal(originMain(c.template.work), moved)
})

test('a checkout on another branch is blocked, and neither branch moves', async (t) => {
  const { c } = await family(t, newer)
  const before = originMain(c.template.work)
  sh(c.template.work, 'checkout', '-q', '-b', 'feature')
  const r = await bump({ repo: c.template.work })
  assert.deepEqual(r.blockedBy, { reason: 'not on main' })
  assert.equal(originMain(c.template.work), before)
  assert.equal(sh(c.template.work, 'ls-remote', '--heads', 'origin', 'feature'), '')
})

test('a detached checkout is blocked and nothing is published', async (t) => {
  const { c } = await family(t, newer)
  const before = originMain(c.template.work)
  sh(c.template.work, 'checkout', '-q', '--detach')
  const r = await bump({ repo: c.template.work })
  assert.deepEqual(r.blockedBy, { reason: 'detached HEAD' })
  assert.equal(originMain(c.template.work), before)
})

// Published is published: once origin has the commit, the module is taken, whatever happens to
// the local checkout afterwards. The next night then sees "behind origin" instead of retrying.
test('a take whose push landed but whose local fast-forward failed is reported taken, with a warning', async (t) => {
  const { c } = await family(t, newer)
  hook(c.template.work, 'pre-push', 'printf " " >> package.json')
  const r = await bump({ repo: c.template.work })
  assert.equal(r.status, 'bumped', JSON.stringify(r))
  assert.equal(r.taken.length, 1)
  assert.equal(r.taken[0].to, '0.1.3')
  assert.match(r.taken[0].warning, /not fast-forwarded/)
  assert.deepEqual(r.refused, [])
  assert.equal(JSON.parse(sh(c.template.work, 'show', 'origin/main:package.json')).dependencies[MOD], '^0.1.3')
  assert.equal(sh(c.template.work, 'worktree', 'list').split('\n').length, 1)
})

// One module's take crashing (here: its commit is rejected) is that module's refusal only.
test('a take that crashes refuses that module and the next module is still taken', async (t) => {
  const CRASH = '@supersuit/a-crash'
  const { c } = await family(t, {
    before: (r) => { r.publish(MOD, '0.1.2'); r.publish(CRASH, '0.1.2') },
    after: (r) => { r.publish(MOD, '0.1.3'); r.publish(CRASH, '0.1.3') },
  }, { deps: { [MOD]: '^0.1.2', [CRASH]: '^0.1.2' } })
  hook(c.template.work, 'pre-commit', `git diff --cached -- package.json | grep -qF '"${CRASH}": "^0.1.3"' && exit 1; exit 0`)
  const r = await bump({ repo: c.template.work })
  assert.equal(r.status, 'blocked')
  assert.deepEqual(r.refused.map((x) => [x.name, x.to, x.reason]), [[CRASH, '0.1.3', 'crashed']])
  assert.deepEqual(r.taken, [{ name: MOD, from: '^0.1.2', to: '0.1.3' }])
  assert.equal(JSON.parse(sh(c.template.work, 'show', 'origin/main:package.json')).dependencies[MOD], '^0.1.3')
  assert.equal(sh(c.template.work, 'worktree', 'list').split('\n').length, 1)
})

test('a checkout whose origin cannot be fetched is blocked and takes nothing', async (t) => {
  const { c } = await family(t, newer)
  const before = head(c.template.work)
  sh(c.template.work, 'remote', 'set-url', 'origin', join(c.base, 'no-such-origin.git'))
  const r = await bump({ repo: c.template.work })
  assert.equal(r.status, 'blocked')
  assert.equal(r.blockedBy.reason, 'fetch failed')
  assert.deepEqual(r.taken, [])
  assert.deepEqual(r.refused, [])
  assert.equal(head(c.template.work), before)
  assert.equal(sh(c.template.work, 'worktree', 'list').split('\n').length, 1)
})

// ---- what is outside the range, which modules move, what cannot be answered, and pnpm ----

test('a version outside the range is held for a person, and the newest inside it is still taken', async (t) => {
  const { c } = await family(t, {
    before: (r) => r.publish(MOD, '1.2.0'),
    after: (r) => { r.publish(MOD, '1.3.0'); r.publish(MOD, '2.0.0') },
  }, { deps: { [MOD]: '^1.2.0' } })
  const r = await bump({ repo: c.template.work })
  assert.equal(r.status, 'bumped', JSON.stringify(r))
  assert.deepEqual(r.taken, [{ name: MOD, from: '^1.2.0', to: '1.3.0' }])
  assert.deepEqual(r.held, [{ name: MOD, range: '^1.2.0', available: '2.0.0' }])
  assert.equal(spec(c.template.work), '^1.3.0')
  assert.equal(locked(c.template.work), '1.3.0')
})

test('under ^0.x a new minor is held, as npm itself reads the range', async (t) => {
  const { c } = await family(t, { before: (r) => r.publish(MOD, '0.1.2'), after: (r) => r.publish(MOD, '0.2.0') })
  const before = head(c.template.work)
  const r = await bump({ repo: c.template.work })
  assert.equal(r.status, 'held')
  assert.deepEqual(r.held, [{ name: MOD, range: '^0.1.2', available: '0.2.0' }])
  assert.equal(originMain(c.template.work), before)
  assert.equal(head(c.template.work), before)
})

test('--allow-major takes a held version through the same check', async (t) => {
  const { c } = await family(t, { before: (r) => r.publish(MOD, '0.1.2'), after: (r) => r.publish(MOD, '0.2.0') })
  const r = await bump({ repo: c.template.work, allowMajor: [MOD] })
  assert.equal(r.status, 'bumped', JSON.stringify(r))
  assert.deepEqual(r.taken, [{ name: MOD, from: '^0.1.2', to: '0.2.0' }])
  assert.deepEqual(r.held, [])
  assert.equal(spec(c.template.work), '^0.2.0')
  assert.equal(originMain(c.template.work), head(c.template.work))
})

test('--allow-major still refuses a held version that breaks the check', async (t) => {
  const { c } = await family(t, { before: (r) => r.publish(MOD, '0.1.2'), after: (r) => r.publish(MOD, '0.2.0', { works: false }) })
  const before = head(c.template.work)
  const r = await bump({ repo: c.template.work, allowMajor: [MOD] })
  assert.equal(r.status, 'blocked')
  assert.equal(r.refused[0].reason, 'check failed')
  assert.equal(originMain(c.template.work), before)
  assert.equal(head(c.template.work), before)
  assert.equal(spec(c.template.work), '^0.1.2')
})

// --allow-major names one module; it is not a licence for the others.
test('--allow-major for one module leaves another module\'s held version held', async (t) => {
  const W = '@acme/widget'
  const { c } = await family(t, {
    before: (r) => { r.publish(W, '0.1.0'); r.publish(MOD, '0.1.2') },
    after: (r) => { r.publish(W, '0.2.0'); r.publish(MOD, '0.2.0') },
  }, { deps: { [W]: '^0.1.0', [MOD]: '^0.1.2' }, living: { modules: [W, MOD] } })
  const r = await bump({ repo: c.template.work, allowMajor: [MOD] })
  assert.equal(r.status, 'bumped', JSON.stringify(r))
  assert.deepEqual(r.taken, [{ name: MOD, from: '^0.1.2', to: '0.2.0' }])
  assert.deepEqual(r.held, [{ name: W, range: '^0.1.0', available: '0.2.0' }])
  assert.equal(spec(c.template.work, W), '^0.1.0')
})

test('only declared modules move; one broken module never blocks another', async (t) => {
  const W = '@acme/widget', O = '@acme/other'
  const { c } = await family(t, {
    before: (r) => { r.publish(W, '1.0.0'); r.publish(O, '1.0.0'); r.publish(MOD, '0.1.2') },
    after: (r) => { r.publish(W, '1.0.1'); r.publish(O, '1.0.1'); r.publish(MOD, '0.1.3', { works: false }) },
  }, { deps: { [W]: '^1.0.0', [O]: '^1.0.0', [MOD]: '^0.1.2' }, living: { modules: [W, MOD] } })
  const r = await bump({ repo: c.template.work })
  assert.equal(r.status, 'blocked')
  assert.deepEqual(r.taken, [{ name: W, from: '^1.0.0', to: '1.0.1' }])
  assert.deepEqual(r.refused.map((x) => [x.name, x.to, x.reason]), [[MOD, '0.1.3', 'check failed']])
  assert.equal(spec(c.template.work, W), '^1.0.1')
  assert.equal(spec(c.template.work, O), '^1.0.0')   // not declared: never touched
  assert.equal(spec(c.template.work, MOD), '^0.1.2')
  assert.equal(originMain(c.template.work), head(c.template.work))
})

test('a range the bump does not manage is skipped and never touched', async (t) => {
  const { c } = await family(t, { before: (r) => r.publish(MOD, '0.1.2'), after: (r) => r.publish(MOD, '0.1.3') }, { deps: { [MOD]: '>=0.1.2' } })
  const before = head(c.template.work)
  const r = await bump({ repo: c.template.work })
  assert.equal(r.status, 'current')
  assert.deepEqual(r.skipped, [{ name: MOD, spec: '>=0.1.2', reason: 'unmanaged range' }])
  assert.equal(head(c.template.work), before)
  assert.equal(originMain(c.template.work), before)
})

test('a module the registry cannot answer for is refused with a reason, and nothing moves', async (t) => {
  const { c } = await family(t, { before: (r) => r.publish(MOD, '0.1.2') })
  const before = head(c.template.work)
  const r = await bump({ repo: c.template.work, versionsOf: () => { throw new Error('ENOTFOUND registry') } })
  assert.equal(r.status, 'blocked')
  assert.deepEqual(r.refused.map((x) => [x.name, x.to, x.reason]), [[MOD, null, 'versions unavailable']])
  assert.equal(head(c.template.work), before)
  assert.equal(originMain(c.template.work), before)
})

const hasPnpm = (() => { try { execFileSync('pnpm', ['--version'], { stdio: 'ignore' }); return true } catch { return false } })()

// A listing of the real machine's npm and pnpm homes: each directory's own mtime plus its
// immediate children's names and mtimes. Anything pnpm or npm wrote there would change it.
function realHomes() {
  const h = homedir()
  const dirs = ['.npm', '.cache/pnpm', '.local/share/pnpm', '.local/state/pnpm', '.pnpm-store', 'Library/pnpm', 'Library/Caches/pnpm']
  const out = {}
  for (const d of dirs) {
    const p = join(h, d)
    if (!existsSync(p)) { out[d] = null; continue }
    out[d] = [statSync(p).mtimeMs, ...readdirSync(p).sort().map((n) => { try { return `${n}:${statSync(join(p, n)).mtimeMs}` } catch { return `${n}:gone` } })]
  }
  return out
}
const filesUnder = (dir) => (existsSync(dir) ? readdirSync(dir, { recursive: true }).length : 0)

test('pnpm: the same bump rewrites pnpm-lock.yaml, the check gates it, and nothing lands outside the temp base', { skip: !hasPnpm && 'pnpm not installed' }, async (t) => {
  const homesBefore = realHomes()
  const { c } = await family(t, { before: (r) => r.publish(MOD, '0.1.2'), after: (r) => r.publish(MOD, '0.1.3') }, { pm: 'pnpm' })
  assert.equal(c.lockfile, 'pnpm-lock.yaml')
  const r = await bump({ repo: c.template.work })
  assert.equal(r.status, 'bumped', JSON.stringify(r))
  assert.equal(spec(c.template.work), '^0.1.3')
  assert.match(read(c.template.work, 'pnpm-lock.yaml'), /living-fixture@0\.1\.3/)
  assert.deepEqual(sh(c.template.work, 'show', '--name-only', '--format=', 'HEAD').split('\n').sort(), ['package.json', 'pnpm-lock.yaml'])
  assert.equal(originMain(c.template.work), head(c.template.work))
  // Isolation proof: pnpm really used the throwaway cache and store, and left the real ones alone.
  assert.ok(filesUnder(join(c.base, 'pnpm-store')) > 0, 'pnpm store is under the temp base')
  assert.ok(filesUnder(join(c.base, 'pnpm-cache')) > 0, 'pnpm metadata cache is under the temp base')
  assert.deepEqual(realHomes(), homesBefore)
})

test('pnpm: a version that fails the check is refused and nothing is published', { skip: !hasPnpm && 'pnpm not installed' }, async (t) => {
  const { c } = await family(t, { before: (r) => r.publish(MOD, '0.1.2'), after: (r) => r.publish(MOD, '0.1.3', { works: false }) }, { pm: 'pnpm' })
  const before = head(c.template.work)
  const r = await bump({ repo: c.template.work })
  assert.equal(r.status, 'blocked')
  assert.equal(r.refused[0].reason, 'check failed')
  assert.equal(originMain(c.template.work), before)
  assert.equal(sh(c.template.work, 'worktree', 'list').split('\n').length, 1)
})
