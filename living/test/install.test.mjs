import { test } from 'node:test'
import assert from 'node:assert/strict'
import { writeFileSync, mkdirSync, chmodSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { update } from '../update.mjs'
import { runCheck, syncCheckout } from '../check.mjs'
import { makeChain, commit, sh, originMain, head, cleanup, tmp, checkScript } from './helpers.mjs'

// A stand-in `npm` first on PATH. It logs "<where> <args>" and exits 0, except that FAKE_FAIL_IN
// makes `ci` fail in the throwaway worktree ("worktree") or in the real checkout ("checkout").
// The worktree is the only place whose folder name starts with living-update-.
function fakeNpm(t, base) {
  const bin = join(base, 'fakebin'), log = join(base, 'npm.log')
  mkdirSync(bin)
  writeFileSync(join(bin, 'npm'), `#!/bin/sh
where=checkout; case "$PWD" in *living-update-*) where=worktree;; esac
echo "$where $*" >> "${log}"
if [ "$1" = ci ] && [ "$FAKE_FAIL_IN" = "$where" ]; then echo "ci exploded" >&2; exit 1; fi
exit 0
`)
  chmodSync(join(bin, 'npm'), 0o755)
  const old = { PATH: process.env.PATH, FAKE_FAIL_IN: process.env.FAKE_FAIL_IN }
  process.env.PATH = `${bin}:${old.PATH}`
  delete process.env.FAKE_FAIL_IN
  t.after(() => { process.env.PATH = old.PATH; if (old.FAKE_FAIL_IN === undefined) delete process.env.FAKE_FAIL_IN; else process.env.FAKE_FAIL_IN = old.FAKE_FAIL_IN })
  return { calls: () => (existsSync(log) ? readFileSync(log, 'utf8').trim().split('\n').filter(Boolean) : []), reset: () => writeFileSync(log, '') }
}
const pkgWithCheck = checkScript(true)
const push = (c) => sh(c.template.work, 'push', '-q', 'origin', 'main')

test('a merge that changes the lockfile installs frozen before the check, then installs in the checkout', async (t) => {
  const c = makeChain(); t.after(() => cleanup(c.base))
  const npm = fakeNpm(t, c.base)
  commit(c.template.work, { 'package-lock.json': '{"v":2}\n' }, 'template: bump a dependency'); push(c)
  const r = await update({ repo: c.app.work })
  assert.equal(r.status, 'updated', JSON.stringify(r))
  assert.deepEqual(npm.calls(), ['worktree ci', 'worktree run living:check', 'checkout ci'])
  assert.deepEqual(r.install, { status: 'installed' })
  assert.equal(originMain(c.app.work), head(c.app.work))
})

test('a merge that touches no dependency never installs in the checkout (the gate still installs in its fresh worktree)', async (t) => {
  const c = makeChain(); t.after(() => cleanup(c.base))
  const npm = fakeNpm(t, c.base)
  commit(c.template.work, { 'package-lock.json': '{"v":2}\n' }, 'template: lock'); push(c)
  assert.equal((await update({ repo: c.app.work })).status, 'updated')
  npm.reset()
  commit(c.template.work, { 'app.txt': 'template app v3\n' }, 'template: copy only'); push(c)
  const r = await update({ repo: c.app.work })
  assert.equal(r.status, 'updated', JSON.stringify(r))
  assert.deepEqual(npm.calls(), ['worktree ci', 'worktree run living:check'])
  assert.deepEqual(r.install, { status: 'skipped' })
})

test('an install failure in the gate blocks: nothing published, the check never runs', async (t) => {
  const c = makeChain(); t.after(() => cleanup(c.base))
  const npm = fakeNpm(t, c.base)
  process.env.FAKE_FAIL_IN = 'worktree'
  commit(c.template.work, { 'package-lock.json': '{"v":2}\n' }, 'template: bump'); push(c)
  const before = originMain(c.app.work)
  const r = await update({ repo: c.app.work })
  assert.equal(r.status, 'blocked')
  assert.equal(r.blockedBy.reason, 'install failed')
  assert.match(r.blockedBy.output, /ci exploded/)
  assert.equal(originMain(c.app.work), before)
  assert.deepEqual(npm.calls(), ['worktree ci'])
})

test('a failed install in the checkout after publishing is reported, not silent', async (t) => {
  const c = makeChain(); t.after(() => cleanup(c.base))
  fakeNpm(t, c.base)
  process.env.FAKE_FAIL_IN = 'checkout'
  commit(c.template.work, { 'package-lock.json': '{"v":2}\n' }, 'template: bump'); push(c)
  const r = await update({ repo: c.app.work })
  assert.equal(r.status, 'updated')
  assert.equal(r.install.status, 'failed')
  assert.match(r.warning, /node_modules are stale/)
})

test('a checkout that was behind origin and catches up installs when the catch-up changed dependencies', async (t) => {
  const c = makeChain(); t.after(() => cleanup(c.base))
  const npm = fakeNpm(t, c.base)
  // Someone else pushes a lockfile to the app's origin; this checkout is behind it.
  const other = join(c.base, 'other')
  sh(c.base, 'clone', '-q', join(c.base, 'app.git'), other)
  commit(other, { 'package-lock.json': '{"v":2}\n' }, 'app: lock'); sh(other, 'push', '-q', 'origin', 'main')
  commit(c.template.work, { 'app.txt': 'v2\n' }, 'template: v2'); push(c)
  const r = await update({ repo: c.app.work })
  assert.equal(r.status, 'updated', JSON.stringify(r))
  assert.ok(npm.calls().includes('checkout ci'), npm.calls().join('|'))
})

test('syncCheckout: only a move that touches package.json or a lockfile installs', async (t) => {
  const c = makeChain(); t.after(() => cleanup(c.base))
  const npm = fakeNpm(t, c.base)
  const repo = c.app.work
  writeFileSync(join(repo, 'package-lock.json'), '{}\n')
  sh(repo, 'add', 'package-lock.json'); sh(repo, 'commit', '-q', '-m', 'lock')
  const a = head(repo)
  const b = commit(repo, { 'x.txt': 'x\n' }, 'x')
  const d = commit(repo, { 'package.json': pkgWithCheck.replace('fixture', 'fixture2') }, 'pkg')
  assert.deepEqual(syncCheckout(repo, a, b), { status: 'skipped' })
  assert.deepEqual(syncCheckout(repo, b, d), { status: 'installed' })
  assert.deepEqual(syncCheckout(repo, d, d), { status: 'skipped' })
  assert.deepEqual(npm.calls(), ['checkout ci'])
})

test('runCheck installs frozen before it runs the check, and an install failure stops it', async (t) => {
  const base = tmp('rc'); t.after(() => cleanup(base))
  const npm = fakeNpm(t, base)
  const dir = join(base, 'repo'); mkdirSync(dir)
  writeFileSync(join(dir, 'package.json'), pkgWithCheck)
  writeFileSync(join(dir, 'package-lock.json'), '{}\n')
  assert.deepEqual(runCheck(dir), { ok: true })
  assert.deepEqual(npm.calls(), ['checkout ci', 'checkout run living:check'])
  npm.reset(); process.env.FAKE_FAIL_IN = 'checkout'
  assert.equal(runCheck(dir).reason, 'install failed')
  assert.deepEqual(npm.calls(), ['checkout ci'])
})
