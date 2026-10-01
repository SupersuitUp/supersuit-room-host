import { test } from 'node:test'
import assert from 'node:assert/strict'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { bump } from '../bump.mjs'
import { tmp, cleanup, read, sh, head, originMain } from './helpers.mjs'
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
