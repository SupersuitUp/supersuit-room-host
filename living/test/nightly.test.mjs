import { test } from 'node:test'
import assert from 'node:assert/strict'
import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { execFileSync, spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { orderParentsFirst, nightly, register, freshNews, remember } from '../nightly.mjs'
import { plist } from '../install-nightly.mjs'
import { makeChain, commit, sh, read, cleanup, failLocalFastForward, tmp } from './helpers.mjs'
import { startRegistry, isolateNpm, makeModuleChain, MOD } from './registry.mjs'

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

test('an update that published but could not move the local checkout is told as updated, with the warning', async () => {
  const c = makeChain()
  try {
    commit(c.template.work, { 'app.txt': 'v2\n' }, 'template: v2')
    sh(c.template.work, 'push', '-q', 'origin', 'main')
    failLocalFastForward(c.app.work)
    const registry = join(c.base, 'repos.json')
    writeFileSync(registry, JSON.stringify({ repos: [c.template.work, c.app.work] }))
    const told = []
    const reports = await nightly({ registry, notify: (r) => told.push(r) })
    assert.deepEqual(reports.map((r) => r.status), ['current', 'updated'])
    assert.deepEqual(told.map((r) => [r.status, r.merged.length, /did not fast-forward/.test(r.warning ?? '')]), [['updated', 1, true]])
  } finally { cleanup(c.base) }
})
const modulesReport = (repo, over = {}) => ({ repo, kind: 'modules', status: 'current', taken: [], refused: [], held: [], skipped: [], blockedBy: null, ...over })

test('register remembers a template separately, and leaves the file as it was until one exists', () => {
  const base = tmp('reg')
  try {
    const file = join(base, 'repos.json')
    register('/a/app', file)
    assert.deepEqual(JSON.parse(readFileSync(file, 'utf8')), { repos: ['/a/app'] })
    register('/a/template', file, { template: true })
    register('/a/template', file, { template: true })
    register('/a/other', file)
    assert.deepEqual(JSON.parse(readFileSync(file, 'utf8')), { repos: ['/a/app', '/a/template', '/a/other'], templates: ['/a/template'] })
  } finally { cleanup(base) }
})

test('only a repository registered as a template is bumped, right after its own update', async () => {
  const c = makeChain()
  try {
    const registry = join(c.base, 'repos.json')
    writeFileSync(registry, JSON.stringify({ repos: [c.app.work, c.template.work], templates: [c.template.work] }))
    const asked = []
    const reports = await nightly({ registry, bumpModules: async ({ repo }) => { asked.push(repo); return modulesReport(repo) } })
    assert.deepEqual(asked, [c.template.work])
    assert.deepEqual(reports.map((r) => [r.repo, r.kind ?? 'update', r.status]), [
      [c.template.work, 'update', 'current'], [c.template.work, 'modules', 'current'], [c.app.work, 'update', 'current'],
    ])
  } finally { cleanup(c.base) }
})

test('a registry with no templates runs exactly as before: no module step at all', async () => {
  const c = makeChain()
  try {
    const registry = join(c.base, 'repos.json')
    writeFileSync(registry, JSON.stringify({ repos: [c.template.work, c.app.work] }))
    let asked = 0
    const reports = await nightly({ registry, bumpModules: async () => { asked++; return modulesReport('x') } })
    assert.equal(asked, 0)
    assert.equal(reports.length, 2)
    assert.equal(existsSync(join(c.base, 'modules-seen.json')), false)
  } finally { cleanup(c.base) }
})

test('a held version is told once, not every night, and a newer one is told again', async () => {
  const c = makeChain()
  try {
    const registry = join(c.base, 'repos.json')
    writeFileSync(registry, JSON.stringify({ repos: [c.template.work], templates: [c.template.work] }))
    let available = '2.0.0'
    const bumpModules = async ({ repo }) => modulesReport(repo, { status: 'held', held: [{ name: '@supersuit/x', range: '^1.0.0', available }] })
    const told = []
    await nightly({ registry, bumpModules, notify: (r) => told.push(r) })
    await nightly({ registry, bumpModules, notify: (r) => told.push(r) })
    available = '3.0.0'
    await nightly({ registry, bumpModules, notify: (r) => told.push(r) })
    assert.deepEqual(told.map((r) => r.held.map((h) => h.available)), [['2.0.0'], ['3.0.0']])
  } finally { cleanup(c.base) }
})

test('a dirty template is reported once, by its update, and never bumped', async () => {
  const c = makeChain()
  try {
    writeFileSync(join(c.template.work, 'scratch.txt'), 'unsaved\n')
    const registry = join(c.base, 'repos.json')
    writeFileSync(registry, JSON.stringify({ repos: [c.template.work], templates: [c.template.work] }))
    commit(c.meta.work, { 'living/version.txt': '2\n' }, 'meta: v2')
    sh(c.meta.work, 'push', '-q', 'origin', 'main')
    let asked = 0
    const told = []
    await nightly({ registry, bumpModules: async () => { asked++; return modulesReport('x') }, notify: (r) => told.push(r) })
    assert.equal(asked, 0)
    assert.deepEqual(told.map((r) => r.blockedBy?.reason), ['dirty'])
  } finally { cleanup(c.base) }
})

test('freshNews keeps what is new and recomputes the status', () => {
  const r = modulesReport('/t', { taken: [{ name: 'a', from: '^1.0.0', to: '1.0.1' }], refused: [{ name: 'b', to: '0.1.4', reason: 'check failed' }], held: [{ name: 'c', range: '^1.0.0', available: '2.0.0' }] })
  const prev = remember(r)
  assert.deepEqual(prev, { held: { c: '2.0.0' }, refused: { b: '0.1.4' }, skipped: {}, blocked: null })
  const again = freshNews(r, prev)
  assert.equal(again.status, 'bumped')
  assert.deepEqual([again.refused, again.held], [[], []])
  assert.equal(freshNews(modulesReport('/t', { held: r.held }), prev), null)
  assert.equal(freshNews(r, undefined).status, 'blocked')
})

test('one night, for real: a template takes a module version and its app gets the same pin', async () => {
  const base = tmp('night')
  const reg = await startRegistry(base)
  try {
    isolateNpm(base, reg)
    reg.publish(MOD, '0.1.2')
    const c = makeModuleChain(base)
    reg.publish(MOD, '0.1.3')
    const registry = join(base, 'repos.json')
    writeFileSync(registry, JSON.stringify({ repos: [c.app.work, c.template.work], templates: [c.template.work] }))
    const told = []
    const reports = await nightly({ registry, notify: (r) => told.push(r) })
    assert.deepEqual(reports.map((r) => [r.kind ?? 'update', r.status]), [['update', 'current'], ['modules', 'bumped'], ['update', 'updated']])
    const appPkg = JSON.parse(read(c.app.work, 'package.json'))
    const appLock = JSON.parse(read(c.app.work, 'package-lock.json'))
    assert.equal(appPkg.dependencies[MOD], '^0.1.3')
    assert.equal(appLock.packages[`node_modules/${MOD}`].version, '0.1.3')
    assert.equal(read(c.app.work, 'tailor/settings.txt'), 'name=real\n')
    assert.deepEqual(told.map((r) => r.kind ?? 'update'), ['modules', 'update'])
  } finally { reg.close(); cleanup(base) }
})

test('an app is never bumped, even with a newer module waiting', async () => {
  const base = tmp('appnobump')
  const reg = await startRegistry(base)
  try {
    isolateNpm(base, reg)
    reg.publish(MOD, '0.1.2')
    const c = makeModuleChain(base)
    reg.publish(MOD, '0.1.3')
    const registry = join(base, 'repos.json')
    writeFileSync(registry, JSON.stringify({ repos: [c.app.work] }))
    const reports = await nightly({ registry })
    assert.deepEqual(reports.map((r) => r.kind ?? 'update'), ['update'])
    assert.equal(JSON.parse(read(c.app.work, 'package.json')).dependencies[MOD], '^0.1.2')
  } finally { reg.close(); cleanup(base) }
})

// Ruling: a blocked template is not bumped, whatever blocked it, so it is told once, by its update.
test('a template whose update is blocked for any reason is never bumped', async () => {
  const c = makeChain()
  try {
    commit(c.template.work, { 'wip.txt': 'unpushed\n' }, 'someone else: work in progress')
    const registry = join(c.base, 'repos.json')
    writeFileSync(registry, JSON.stringify({ repos: [c.template.work], templates: [c.template.work] }))
    let asked = 0
    const told = []
    const reports = await nightly({ registry, bumpModules: async () => { asked++; return modulesReport('x') }, notify: (r) => told.push(r) })
    assert.equal(asked, 0)
    assert.deepEqual(reports.map((r) => [r.kind ?? 'update', r.status]), [['update', 'blocked']])
    assert.deepEqual(told.map((r) => r.blockedBy?.reason), ['ahead of origin'])
  } finally { cleanup(c.base) }
})

// Ruling F11: a bump that returns early (blockedBy) has no held list; that must not erase the
// one already told, or the same held version is texted again the night it recovers.
test('a held version told before a blocked night is not told again after it', async () => {
  const c = makeChain()
  try {
    const registry = join(c.base, 'repos.json')
    writeFileSync(registry, JSON.stringify({ repos: [c.template.work], templates: [c.template.work] }))
    const held = (repo) => modulesReport(repo, { status: 'held', held: [{ name: '@supersuit/x', range: '^1.0.0', available: '2.0.0' }] })
    const nights = [held, (repo) => modulesReport(repo, { status: 'blocked', blockedBy: { reason: 'behind origin' } }), held]
    const told = []
    for (const night of nights) await nightly({ registry, bumpModules: async ({ repo }) => night(repo), notify: (r) => told.push(r) })
    assert.deepEqual(told.map((r) => [r.status, r.held.length, r.blockedBy?.reason ?? null]), [['held', 1, null], ['blocked', 0, 'behind origin']])
  } finally { cleanup(c.base) }
})

test('remember carries the previous held and refused lists through a blocked report', () => {
  const prev = { held: { c: '2.0.0' }, refused: { b: '0.1.4' }, skipped: { d: '~1.2.0|unmanaged range' }, blocked: null }
  assert.deepEqual(remember(modulesReport('/t', { blockedBy: { reason: 'dirty' } }), prev), { held: { c: '2.0.0' }, refused: { b: '0.1.4' }, skipped: { d: '~1.2.0|unmanaged range' }, blocked: 'dirty' })
  assert.deepEqual(remember(modulesReport('/t'), prev), { held: {}, refused: {}, skipped: {}, blocked: null })
})

// M1: a module the nightly will never move, because of how it is declared, is told once.
test('a skipped module is news the first night and silent after, until its declaration changes', () => {
  const skipped = [{ name: 'd', spec: '~1.2.0', reason: 'unmanaged range' }, { name: '42', spec: null, reason: 'not a package name' }]
  const r = modulesReport('/t', { skipped })
  const first = freshNews(r, undefined)
  assert.deepEqual(first.skipped, skipped)
  assert.equal(first.status, 'current')
  const prev = remember(r)
  assert.deepEqual(prev.skipped, { d: '~1.2.0|unmanaged range', 42: 'null|not a package name' })
  assert.equal(freshNews(r, prev), null)
  const changed = freshNews(modulesReport('/t', { skipped: [{ name: 'd', spec: '*', reason: 'unmanaged range' }] }), prev)
  assert.deepEqual(changed.skipped.map((x) => x.spec), ['*'])
})

test('a module report from before skipped existed is still read', () => {
  const old = { repo: '/t', kind: 'modules', status: 'current', taken: [], refused: [], held: [], blockedBy: null }
  assert.equal(freshNews(old, undefined), null)
  assert.deepEqual(remember(old).skipped, {})
})

test('the nightly tells a skipped module once across nights', async () => {
  const c = makeChain()
  try {
    const registry = join(c.base, 'repos.json')
    writeFileSync(registry, JSON.stringify({ repos: [c.template.work], templates: [c.template.work] }))
    const skipped = [{ name: '@supersuit/x', spec: '0.1.x', reason: 'unmanaged range' }]
    const bumpModules = async ({ repo }) => modulesReport(repo, { skipped })
    const told = []
    await nightly({ registry, bumpModules, notify: (r) => told.push(r) })
    await nightly({ registry, bumpModules, notify: (r) => told.push(r) })
    assert.deepEqual(told.map((r) => [r.kind, r.skipped]), [['modules', skipped]])
  } finally { cleanup(c.base) }
})

test('the CLI writes last-run.json beside the registry it was given, never in the real home', () => {
  const base = tmp('cli')
  try {
    const registry = join(base, 'reg', 'repos.json')
    mkdirSync(dirname(registry))
    writeFileSync(registry, JSON.stringify({ repos: [] }))
    const home = join(base, 'home')
    const script = join(dirname(fileURLToPath(import.meta.url)), '..', 'nightly.mjs')
    execFileSync(process.execPath, [script, '--registry', registry], { env: { ...process.env, HOME: home, LIVING_NOTIFY_CMD: '', LIVING_HEARTBEAT_CMD: '' }, encoding: 'utf8' })
    const run = JSON.parse(readFileSync(join(base, 'reg', 'last-run.json'), 'utf8'))
    assert.deepEqual(run.reports, [])
    assert.equal(existsSync(join(home, '.living-template')), false)
  } finally { cleanup(base) }
})

// launchd shows the job's last exit code. A blocked repository is told through the notify command;
// if it also failed the job, every ordinary night would look broken and a broken job would not.
test('the CLI exits 0 when a run finished with a blocked repository, and runs the heartbeat with the count', () => {
  const base = tmp('cli')
  try {
    const registry = join(base, 'reg', 'repos.json')
    mkdirSync(dirname(registry))
    const repo = join(base, 'app')
    mkdirSync(repo)
    sh(repo, 'init', '-q')
    sh(repo, 'remote', 'add', 'template', join(base, 'no-such-template'))
    writeFileSync(registry, JSON.stringify({ repos: [repo] }))
    const beat = join(base, 'beat.json')
    const script = join(dirname(fileURLToPath(import.meta.url)), '..', 'nightly.mjs')
    const r = spawnSync(process.execPath, [script, '--registry', registry], { env: { ...process.env, HOME: join(base, 'home'), LIVING_NOTIFY_CMD: '', LIVING_HEARTBEAT_CMD: `cat > "${beat}"` }, encoding: 'utf8' })
    assert.match(r.stdout, /blocked/)
    assert.equal(r.status, 0, r.stderr)
    const run = JSON.parse(readFileSync(join(base, 'reg', 'last-run.json'), 'utf8'))
    assert.deepEqual(JSON.parse(readFileSync(beat, 'utf8')), { at: run.at, repos: 1, blocked: 1 })
  } finally { cleanup(base) }
})

test('a heartbeat command that fails is said in the log and does not fail the run', () => {
  const base = tmp('cli')
  try {
    const registry = join(base, 'reg', 'repos.json')
    mkdirSync(dirname(registry))
    writeFileSync(registry, JSON.stringify({ repos: [] }))
    const script = join(dirname(fileURLToPath(import.meta.url)), '..', 'nightly.mjs')
    const r = spawnSync(process.execPath, [script, '--registry', registry], { env: { ...process.env, HOME: join(base, 'home'), LIVING_NOTIFY_CMD: '', LIVING_HEARTBEAT_CMD: 'echo no-such-timer >&2; exit 3' }, encoding: 'utf8' })
    assert.equal(r.status, 0)
    assert.match(r.stderr, /heartbeat failed: no-such-timer/)
  } finally { cleanup(base) }
})

// A bad told-once memo must never stop the updates: it is set aside, said once, and rewritten.
test('a garbage seen file still updates every repository, is warned about once, and is rewritten valid', async () => {
  const c = makeChain()
  try {
    const registry = join(c.base, 'repos.json')
    const seenFile = join(c.base, 'modules-seen.json')
    writeFileSync(registry, JSON.stringify({ repos: [c.app.work, c.template.work], templates: [c.template.work] }))
    const held = async ({ repo }) => modulesReport(repo, { status: 'held', held: [{ name: '@supersuit/x', range: '^1.0.0', available: '2.0.0' }] })
    for (const garbage of ['{"half": ', '[1, 2]', 'null']) {
      writeFileSync(seenFile, garbage)
      const warned = []
      const told = []
      const reports = await nightly({ registry, bumpModules: held, notify: (r) => told.push(r), warn: (m) => warned.push(m) })
      assert.deepEqual(reports.map((r) => [r.repo, r.kind ?? 'update']), [[c.template.work, 'update'], [c.template.work, 'modules'], [c.app.work, 'update']], garbage)
      assert.equal(warned.length, 1, garbage)
      assert.match(warned[0], /modules-seen\.json/)
      assert.deepEqual(told.map((r) => r.kind), ['modules'], garbage)
      assert.deepEqual(JSON.parse(readFileSync(seenFile, 'utf8'))[c.template.work].held, { '@supersuit/x': '2.0.0' })
      assert.equal(existsSync(seenFile + '.tmp'), false)
      const quiet = []
      await nightly({ registry, bumpModules: held, notify: (r) => quiet.push(r), warn: (m) => warned.push(m) })
      assert.equal(quiet.length, 0, garbage)
      assert.equal(warned.length, 1, garbage)
    }
  } finally { cleanup(c.base) }
})
