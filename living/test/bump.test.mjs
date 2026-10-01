import { test } from 'node:test'
import assert from 'node:assert/strict'
import { writeFileSync, chmodSync } from 'node:fs'
import { join } from 'node:path'
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
