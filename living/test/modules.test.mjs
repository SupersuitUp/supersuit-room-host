import { test } from 'node:test'
import assert from 'node:assert/strict'
import { declaredModules, planModule, DEFAULT_MODULES } from '../modules.mjs'

test('by default the @supersuit scope is a module, in any install field, never in peers', () => {
  assert.deepEqual(DEFAULT_MODULES, ['@supersuit/*'])
  const pkg = {
    dependencies: { '@supersuit/cowitness': '^0.1.2', next: '16.3.4' },
    devDependencies: { '@supersuit/bring-up': '^0.1.2' },
    peerDependencies: { '@supersuit/peer': '^1.0.0' },
  }
  assert.deepEqual(declaredModules(pkg), [
    { name: '@supersuit/bring-up', field: 'devDependencies', spec: '^0.1.2' },
    { name: '@supersuit/cowitness', field: 'dependencies', spec: '^0.1.2' },
  ])
})

test('living.modules replaces the default with exact names or scopes', () => {
  const pkg = { living: { modules: ['@acme/widget', '@tools/*'] }, dependencies: { '@acme/widget': '^1.0.0', '@acme/other': '^1.0.0', '@tools/a': '~2.0.0', '@supersuit/x': '^0.1.0' } }
  assert.deepEqual(declaredModules(pkg).map((m) => m.name), ['@acme/widget', '@tools/a'])
})

test('a package with no dependencies, or no package at all, has no modules', () => {
  assert.deepEqual(declaredModules({}), [])
  assert.deepEqual(declaredModules(null), [])
})

test('the newest version inside the range is taken, and the range is raised to it', () => {
  assert.deepEqual(planModule('^0.1.2', ['0.1.0', '0.1.2', '0.1.3', '0.1.4']), { take: { to: '0.1.4', spec: '^0.1.4' }, held: null, skip: null })
  assert.deepEqual(planModule('~1.2.0', ['1.2.0', '1.2.5', '1.3.0']), { take: { to: '1.2.5', spec: '~1.2.5' }, held: '1.3.0', skip: null })
})

test('a version outside the range is held, and the newest inside it is still taken', () => {
  assert.deepEqual(planModule('^1.2.0', ['1.2.0', '1.3.0', '2.0.0', '2.1.0']), { take: { to: '1.3.0', spec: '^1.3.0' }, held: '2.1.0', skip: null })
  assert.deepEqual(planModule('^0.1.2', ['0.1.2', '0.2.0']), { take: null, held: '0.2.0', skip: null })
  assert.deepEqual(planModule('1.2.3', ['1.2.3', '1.2.4']), { take: null, held: '1.2.4', skip: null })
})

test('allowMajor takes the newest version of all, through the same path', () => {
  assert.deepEqual(planModule('^0.1.2', ['0.1.2', '0.1.3', '0.2.0'], { allowMajor: true }), { take: { to: '0.2.0', spec: '^0.2.0' }, held: null, skip: null })
  assert.deepEqual(planModule('^0.1.2', ['0.1.2', '0.1.3'], { allowMajor: true }), { take: { to: '0.1.3', spec: '^0.1.3' }, held: null, skip: null })
})

test('nothing newer, prereleases and older versions are all nothing to do', () => {
  assert.deepEqual(planModule('^0.1.2', ['0.1.0', '0.1.2', '0.1.3-beta.1', '1.0.0-rc.1']), { take: null, held: null, skip: null })
})

test('a range the bump does not manage is skipped with a reason', () => {
  for (const spec of ['>=0.1.0', 'latest', 'file:../x', 'workspace:*']) {
    assert.deepEqual(planModule(spec, ['9.9.9']), { take: null, held: null, skip: 'unmanaged range' }, spec)
  }
})

test('an unparseable declared range or junk in the version list never crashes the plan', () => {
  for (const spec of ['', undefined, null, '^x.y.z', '1.2', '^1.2.3-beta.1']) {
    assert.doesNotThrow(() => planModule(spec, ['1.2.4']), String(spec))
    assert.equal(planModule(spec, ['1.2.4']).skip, 'unmanaged range', String(spec))
  }
  assert.deepEqual(planModule('^1.2.0', ['garbage', '', '1.2.1', 'v1.3.x']), { take: { to: '1.2.1', spec: '^1.2.1' }, held: null, skip: null })
  assert.deepEqual(planModule('^1.2.0', undefined), { take: null, held: null, skip: null })
})
