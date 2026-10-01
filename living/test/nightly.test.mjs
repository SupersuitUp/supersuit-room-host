import { test } from 'node:test'
import assert from 'node:assert/strict'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { orderParentsFirst, nightly, register } from '../nightly.mjs'
import { plist } from '../install-nightly.mjs'
import { makeChain, commit, sh, read, cleanup } from './helpers.mjs'

test('repositories run parents first, whatever order they were registered in', () => {
  const c = makeChain()
  try {
    assert.deepEqual(orderParentsFirst([c.app.work, c.meta.work, c.template.work]), [c.meta.work, c.template.work, c.app.work])
  } finally { cleanup(c.base) }
})

test('one nightly run carries a meta-template change all the way to the app', async () => {
  const c = makeChain()
  try {
    commit(c.meta.work, { 'living/version.txt': '2\n' }, 'meta: v2')
    sh(c.meta.work, 'push', '-q', 'origin', 'main')
    const registry = join(c.base, 'repos.json')
    writeFileSync(registry, JSON.stringify({ repos: [c.app.work, c.template.work, c.meta.work] }))
    const told = []
    const reports = await nightly({ registry, notify: (r) => told.push(r) })
    assert.deepEqual(reports.map((r) => r.status), ['root', 'updated', 'updated'])
    assert.equal(read(c.app.work, 'living/version.txt'), '2\n')
    assert.deepEqual(told.map((r) => r.repo), [c.template.work, c.app.work])
  } finally { cleanup(c.base) }
})

test('a quiet night tells nobody', async () => {
  const c = makeChain()
  try {
    const registry = join(c.base, 'repos.json')
    writeFileSync(registry, JSON.stringify({ repos: [c.template.work, c.app.work] }))
    const told = []
    const reports = await nightly({ registry, notify: (r) => told.push(r) })
    assert.deepEqual(reports.map((r) => r.status), ['current', 'current'])
    assert.equal(told.length, 0)
  } finally { cleanup(c.base) }
})

test('register adds a path once, and a missing registry starts empty', () => {
  const c = makeChain()
  try {
    const registry = join(c.base, 'nested', 'repos.json')
    register(c.app.work, registry)
    register(c.app.work, registry)
    assert.deepEqual(JSON.parse(read(c.base, 'nested/repos.json')).repos, [c.app.work])
  } finally { cleanup(c.base) }
})

test('the LaunchAgent runs nightly.mjs at 03:30 with the notify command in its environment', () => {
  const xml = plist({ node: '/usr/local/bin/node', script: '/r/living/nightly.mjs', path: '/usr/bin:/bin', notify: 'say hi', log: '/tmp/l.log' })
  assert.match(xml, /<key>Hour<\/key>\s*<integer>3<\/integer>/)
  assert.match(xml, /<key>Minute<\/key>\s*<integer>30<\/integer>/)
  assert.match(xml, /<string>\/r\/living\/nightly\.mjs<\/string>/)
  assert.match(xml, /<key>LIVING_NOTIFY_CMD<\/key>\s*<string>say hi<\/string>/)
})

test('the LaunchAgent escapes XML in the notify command', () => {
  const xml = plist({ node: 'n', script: 's', path: 'p', notify: 'a && b < c', log: 'l' })
  assert.match(xml, /a &amp;&amp; b &lt; c/)
})

// A block is told the same way a dirty tree is: the report carries the reason, notify gets it.
test('an update blocked because the checkout is ahead of origin is told, with its reason', async () => {
  const c = makeChain()
  try {
    commit(c.template.work, { 'app.txt': 'v2\n' }, 'template: v2')
    sh(c.template.work, 'push', '-q', 'origin', 'main')
    commit(c.app.work, { 'wip.txt': 'unpushed\n' }, 'someone else: work in progress')
    const registry = join(c.base, 'repos.json')
    writeFileSync(registry, JSON.stringify({ repos: [c.template.work, c.app.work] }))
    const told = []
    const reports = await nightly({ registry, notify: (r) => told.push(r) })
    assert.deepEqual(reports.map((r) => r.status), ['current', 'blocked'])
    assert.deepEqual(told.map((r) => [r.repo, r.status, r.blockedBy?.reason]), [[c.app.work, 'blocked', 'ahead of origin']])
    assert.equal(sh(c.app.work, 'ls-remote', 'origin', 'main').includes(sh(c.app.work, 'rev-parse', 'HEAD')), false)
  } finally { cleanup(c.base) }
})
