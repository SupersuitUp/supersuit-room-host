import { test } from 'node:test'
import assert from 'node:assert/strict'
import { divergence } from '../divergence.mjs'
import { update } from '../update.mjs'
import { makeChain, commit, sh, cleanup } from './helpers.mjs'

test('a parent file this copy changed is divergent, with what the parent changed there since', async () => {
  const c = makeChain()
  try {
    commit(c.template.work, { 'shared.txt': '1\n2\n3\n4\n5\n6\n7\n' }, 'template: shared')
    sh(c.template.work, 'push', '-q', 'origin', 'main')
    assert.equal((await update({ repo: c.app.work })).status, 'updated')

    commit(c.app.work, { 'shared.txt': 'one\n2\n3\n4\n5\n6\n7\n', 'mine.txt': 'app only\n' }, 'app: own wording')
    commit(c.template.work, { 'shared.txt': '1\n2\n3\n4\n5\n6\nseven\n' }, 'template: line seven')
    sh(c.template.work, 'push', '-q', 'origin', 'main')
    sh(c.app.work, 'fetch', '-q', 'template')

    assert.deepEqual(divergence(c.app.work, 'template/main'), [
      { file: 'shared.txt', parentChanges: ['template: line seven'] },
    ])
  } finally { cleanup(c.base) }
})

test('files only this copy has, tailor/ files, and untouched parent files are not divergent', async () => {
  const c = makeChain()
  try {
    commit(c.app.work, { 'mine.txt': 'app only\n', 'tailor/more.txt': 'x\n' }, 'app: additions')
    // A parent change not merged yet is pending, not divergence: this copy never touched app.txt.
    commit(c.template.work, { 'app.txt': 'template app v2\n' }, 'template: v2')
    sh(c.template.work, 'push', '-q', 'origin', 'main')
    sh(c.app.work, 'fetch', '-q', 'template')
    assert.deepEqual(divergence(c.app.work, 'template/main'), [])
  } finally { cleanup(c.base) }
})

test('the update report carries the divergence', async () => {
  const c = makeChain()
  try {
    commit(c.template.work, { 'shared.txt': '1\n2\n3\n4\n5\n6\n7\n' }, 'template: shared')
    sh(c.template.work, 'push', '-q', 'origin', 'main')
    await update({ repo: c.app.work })
    commit(c.app.work, { 'shared.txt': 'one\n2\n3\n4\n5\n6\n7\n' }, 'app: own wording')
    sh(c.app.work, 'push', '-q', 'origin', 'main')
    commit(c.template.work, { 'shared.txt': '1\n2\n3\n4\n5\n6\nseven\n' }, 'template: line seven')
    sh(c.template.work, 'push', '-q', 'origin', 'main')
    const r = await update({ repo: c.app.work })
    assert.equal(r.status, 'updated', JSON.stringify(r))
    assert.deepEqual(r.divergent.map((d) => d.file), ['shared.txt'])
  } finally { cleanup(c.base) }
})
