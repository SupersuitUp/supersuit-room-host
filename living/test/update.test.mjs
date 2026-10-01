import { test } from 'node:test'
import assert from 'node:assert/strict'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { update } from '../update.mjs'
import { makeChain, commit, sh, read, head, originMain, cleanup, checkScript, tmp, makeRepo, metaFiles, failLocalFastForward } from './helpers.mjs'

test('parent ahead: merges, checks, publishes', async () => {
  const c = makeChain()
  try {
    const sha = commit(c.template.work, { 'app.txt': 'template app v2\n' }, 'template: v2')
    sh(c.template.work, 'push', '-q', 'origin', 'main')
    const r = await update({ repo: c.app.work })
    assert.equal(r.status, 'updated', JSON.stringify(r))
    assert.ok(r.merged.some((m) => m.startsWith(sha.slice(0, 7))))
    assert.equal(read(c.app.work, 'app.txt'), 'template app v2\n')
    assert.equal(originMain(c.app.work), head(c.app.work))
    assert.equal(sh(c.app.work, 'log', '-1', '--format=%s'), 'living: take 1 change from template (template: v2)')
  } finally { cleanup(c.base) }
})

test('parent not ahead: current, nothing published', async () => {
  const c = makeChain()
  try {
    const before = originMain(c.app.work)
    const r = await update({ repo: c.app.work })
    assert.equal(r.status, 'current')
    assert.equal(originMain(c.app.work), before)
  } finally { cleanup(c.base) }
})

test('tailor/ is never overwritten by the parent', async () => {
  const c = makeChain()
  try {
    commit(c.template.work, { 'tailor/settings.txt': 'name=new-sample\n', 'app.txt': 'v2\n' }, 'template: sample')
    sh(c.template.work, 'push', '-q', 'origin', 'main')
    const r = await update({ repo: c.app.work })
    assert.equal(r.status, 'updated', JSON.stringify(r))
    assert.equal(read(c.app.work, 'tailor/settings.txt'), 'name=real\n')
    assert.equal(read(c.app.work, 'app.txt'), 'v2\n')
  } finally { cleanup(c.base) }
})

test('a tailor/ file only the parent changed still keeps the child version', async () => {
  const c = makeChain()
  try {
    commit(c.template.work, { 'tailor/README.md': 'new sample docs\n', 'tailor/added.txt': 'new\n', 'README.md': 'template readme v2\n' }, 'template: sample docs')
    sh(c.template.work, 'push', '-q', 'origin', 'main')
    const r = await update({ repo: c.app.work })
    assert.equal(r.status, 'updated', JSON.stringify(r))
    assert.equal(read(c.app.work, 'tailor/README.md'), 'sample settings\n')
    assert.equal(read(c.app.work, 'README.md'), 'meta\n')
    assert.deepEqual(r.parentTailorOnly, ['tailor/added.txt'])
    assert.throws(() => read(c.app.work, 'tailor/added.txt'))
  } finally { cleanup(c.base) }
})

test('a conflict publishes nothing and names the files', async () => {
  const c = makeChain()
  try {
    commit(c.app.work, { 'app.txt': 'app edit\n' }, 'app: own edit')
    sh(c.app.work, 'push', '-q', 'origin', 'main')
    commit(c.template.work, { 'app.txt': 'template edit\n' }, 'template: edit')
    sh(c.template.work, 'push', '-q', 'origin', 'main')
    const before = head(c.app.work)
    const r = await update({ repo: c.app.work })
    assert.equal(r.status, 'blocked')
    assert.equal(r.blockedBy.reason, 'conflict')
    assert.deepEqual(r.blockedBy.files, ['app.txt'])
    assert.equal(head(c.app.work), before)
    assert.equal(originMain(c.app.work), before)
    assert.equal(read(c.app.work, 'app.txt'), 'app edit\n')
  } finally { cleanup(c.base) }
})

test('a failing check publishes nothing', async () => {
  const c = makeChain()
  try {
    commit(c.template.work, { 'package.json': checkScript(false) }, 'template: breaks the check')
    sh(c.template.work, 'push', '-q', 'origin', 'main')
    const before = head(c.app.work)
    const r = await update({ repo: c.app.work })
    assert.equal(r.status, 'blocked')
    assert.equal(r.blockedBy.reason, 'check failed')
    assert.equal(head(c.app.work), before)
    assert.equal(originMain(c.app.work), before)
  } finally { cleanup(c.base) }
})

test('a dirty checkout is skipped and left exactly as it was', async () => {
  const c = makeChain()
  try {
    commit(c.template.work, { 'app.txt': 'v2\n' }, 'template: v2')
    sh(c.template.work, 'push', '-q', 'origin', 'main')
    writeFileSync(join(c.app.work, 'scratch.txt'), 'unsaved work\n')
    const r = await update({ repo: c.app.work })
    assert.equal(r.status, 'blocked')
    assert.equal(r.blockedBy.reason, 'dirty')
    assert.equal(read(c.app.work, 'scratch.txt'), 'unsaved work\n')
    assert.equal(read(c.app.work, 'app.txt'), 'template app\n')
  } finally { cleanup(c.base) }
})

test('no template remote is refused with a reason', async () => {
  const base = tmp('noremote')
  try {
    const r0 = makeRepo(base, 'solo', metaFiles())
    const r = await update({ repo: r0.work })
    assert.equal(r.status, 'blocked')
    assert.equal(r.blockedBy.reason, 'no template remote')
  } finally { cleanup(base) }
})

test('a repo without a living:check script is refused', async () => {
  const c = makeChain()
  try {
    commit(c.template.work, { 'package.json': '{"name":"x","private":true}\n' }, 'template: no check')
    sh(c.template.work, 'push', '-q', 'origin', 'main')
    const r = await update({ repo: c.app.work })
    assert.equal(r.status, 'blocked')
    assert.equal(r.blockedBy.reason, 'no living:check script')
  } finally { cleanup(c.base) }
})

test('dry run reports what would merge and publishes nothing', async () => {
  const c = makeChain()
  try {
    commit(c.template.work, { 'app.txt': 'v2\n' }, 'template: v2')
    sh(c.template.work, 'push', '-q', 'origin', 'main')
    const before = head(c.app.work)
    const r = await update({ repo: c.app.work, dryRun: true })
    assert.equal(r.status, 'ahead')
    assert.equal(r.merged.length, 1)
    assert.equal(head(c.app.work), before)
  } finally { cleanup(c.base) }
})

// An update publishes to origin's default branch, so the checkout must be that branch exactly as
// origin has it. Anything else is blocked and reported; nothing is pushed.
const templateV2 = (c) => { commit(c.template.work, { 'app.txt': 'v2\n' }, 'template: v2'); sh(c.template.work, 'push', '-q', 'origin', 'main') }
const elsewhere = (c) => {
  const other = join(c.base, 'other')
  sh(c.base, 'clone', '-q', c.app.bare, other)
  const sha = commit(other, { 'notes.txt': 'from elsewhere\n' }, 'elsewhere: a change')
  sh(other, 'push', '-q', 'origin', 'main')
  return sha
}

test('a checkout ahead of origin is blocked and its unpushed commit is never published', async () => {
  const c = makeChain()
  try {
    templateV2(c)
    const before = originMain(c.app.work)
    commit(c.app.work, { 'wip.txt': 'not reviewed yet\n' }, 'someone else: work in progress')
    const r = await update({ repo: c.app.work })
    assert.equal(r.status, 'blocked')
    assert.equal(r.blockedBy.reason, 'ahead of origin')
    assert.equal(originMain(c.app.work), before)
    assert.equal(read(c.app.work, 'app.txt'), 'template app\n')
  } finally { cleanup(c.base) }
})

test('a checkout diverged from origin is blocked and nothing is published', async () => {
  const c = makeChain()
  try {
    templateV2(c)
    const moved = elsewhere(c)
    commit(c.app.work, { 'wip.txt': 'local\n' }, 'local: unpushed')
    const r = await update({ repo: c.app.work })
    assert.equal(r.blockedBy?.reason, 'diverged from origin')
    assert.equal(originMain(c.app.work), moved)
  } finally { cleanup(c.base) }
})

test('a checkout on another branch is blocked, and neither branch moves', async () => {
  const c = makeChain()
  try {
    templateV2(c)
    const before = originMain(c.app.work)
    sh(c.app.work, 'checkout', '-q', '-b', 'feature')
    const r = await update({ repo: c.app.work })
    assert.equal(r.blockedBy?.reason, 'not on main')
    assert.equal(originMain(c.app.work), before)
    assert.equal(sh(c.app.work, 'ls-remote', '--heads', 'origin', 'feature'), '')
  } finally { cleanup(c.base) }
})

test('a detached checkout is blocked and nothing is published', async () => {
  const c = makeChain()
  try {
    templateV2(c)
    const before = originMain(c.app.work)
    sh(c.app.work, 'checkout', '-q', '--detach')
    const r = await update({ repo: c.app.work })
    assert.equal(r.blockedBy?.reason, 'detached HEAD')
    assert.equal(originMain(c.app.work), before)
  } finally { cleanup(c.base) }
})

test('a checkout whose origin cannot be fetched is blocked and nothing is published', async () => {
  const c = makeChain()
  try {
    templateV2(c)
    const before = head(c.app.work)
    sh(c.app.work, 'remote', 'set-url', 'origin', join(c.base, 'no-such-origin.git'))
    const r = await update({ repo: c.app.work })
    assert.equal(r.status, 'blocked')
    assert.equal(r.blockedBy.reason, 'fetch failed')
    assert.equal(head(c.app.work), before)
  } finally { cleanup(c.base) }
})

// Behind with a clean tree and no local commits is exactly what `git pull --ff-only` exists for:
// the checkout catches up to what origin already published, then the update runs as usual.
test('a clean checkout behind origin is fast-forwarded first, then updated on top', async () => {
  const c = makeChain()
  try {
    templateV2(c)
    const moved = elsewhere(c)
    const r = await update({ repo: c.app.work })
    assert.equal(r.status, 'updated', JSON.stringify(r))
    assert.deepEqual(r.fastForwarded, [`${moved.slice(0, 7)} elsewhere: a change`])
    assert.equal(originMain(c.app.work), head(c.app.work))
    assert.equal(sh(c.app.work, 'merge-base', '--is-ancestor', moved, 'HEAD'), '')
    assert.equal(read(c.app.work, 'notes.txt'), 'from elsewhere\n')
    assert.equal(read(c.app.work, 'app.txt'), 'v2\n')
  } finally { cleanup(c.base) }
})

test('a dry run behind origin moves nothing and says so', async () => {
  const c = makeChain()
  try {
    templateV2(c)
    elsewhere(c)
    const before = head(c.app.work)
    const published = originMain(c.app.work)
    const r = await update({ repo: c.app.work, dryRun: true })
    assert.equal(r.blockedBy?.reason, 'behind origin')
    assert.equal(head(c.app.work), before)
    assert.equal(originMain(c.app.work), published)
  } finally { cleanup(c.base) }
})

// git's porcelain marks a modified tracked file " M path"; trimmed, slicing three characters
// reported "pp.txt".
test('a dirty checkout names a modified tracked file by its whole path', async () => {
  const c = makeChain()
  try {
    templateV2(c)
    writeFileSync(join(c.app.work, 'app.txt'), 'edited\n')
    const r = await update({ repo: c.app.work })
    assert.deepEqual(r.blockedBy, { reason: 'dirty', files: ['app.txt'] })
  } finally { cleanup(c.base) }
})

// Published is published: once origin has the merge, the update is reported updated, whatever
// happens to the local checkout afterwards (here a pre-push hook dirties the file the merge
// changes, so the local fast-forward refuses). The next run sees "behind origin" and catches up.
test('an update whose push landed but whose local fast-forward failed is reported updated, with a warning', async () => {
  const c = makeChain()
  try {
    templateV2(c)
    failLocalFastForward(c.app.work)
    const r = await update({ repo: c.app.work })
    assert.equal(r.status, 'updated', JSON.stringify(r))
    assert.equal(r.blockedBy, null)
    assert.equal(r.merged.length, 1)
    assert.match(r.warning, /published; local checkout did not fast-forward/)
    assert.equal(sh(c.app.work, 'show', 'origin/main:app.txt'), 'v2')
    assert.equal(sh(c.app.work, 'log', '-1', '--format=%s', 'origin/main'), 'living: take 1 change from template (template: v2)')
  } finally { cleanup(c.base) }
})
