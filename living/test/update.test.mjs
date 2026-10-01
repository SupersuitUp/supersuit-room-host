import { test } from 'node:test'
import assert from 'node:assert/strict'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { update } from '../update.mjs'
import { makeChain, commit, sh, read, head, originMain, cleanup, checkScript, tmp, makeRepo, metaFiles } from './helpers.mjs'

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
