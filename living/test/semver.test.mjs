import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parse, isStable, compare, parseRange, satisfies } from '../semver.mjs'

test('parse reads X.Y.Z, a prerelease, and refuses anything else', () => {
  assert.deepEqual(parse('1.2.3'), { major: 1, minor: 2, patch: 3, pre: null })
  assert.deepEqual(parse('v0.1.2-beta.1+build'), { major: 0, minor: 1, patch: 2, pre: 'beta.1' })
  assert.equal(parse('1.2'), null)
  assert.equal(parse('latest'), null)
  assert.equal(isStable('1.0.0'), true)
  assert.equal(isStable('1.0.0-rc.1'), false)
  assert.equal(isStable('nope'), false)
})

test('compare orders by number, and a release sorts after its prerelease', () => {
  assert.equal(compare('1.10.0', '1.9.9'), 1)
  assert.equal(compare('0.1.2', '0.1.2'), 0)
  assert.equal(compare('2.0.0-rc.1', '2.0.0'), -1)
  assert.deepEqual(['1.0.0', '0.2.0', '0.10.0', '0.2.1'].sort(compare), ['0.2.0', '0.2.1', '0.10.0', '1.0.0'])
})

test('parseRange manages ^, ~ and exact, and nothing else', () => {
  assert.deepEqual(parseRange('^0.1.2'), { op: '^', base: '0.1.2' })
  assert.deepEqual(parseRange('~1.2.3'), { op: '~', base: '1.2.3' })
  assert.deepEqual(parseRange('1.2.3'), { op: '', base: '1.2.3' })
  for (const s of ['>=1.0.0', '*', 'latest', 'file:../x', 'workspace:*', 'github:a/b', '^1.2', '1.x']) assert.equal(parseRange(s), null, s)
})

test('caret follows npm: the left-most non-zero part is the breaking one', () => {
  const r = parseRange('^1.2.0')
  assert.equal(satisfies(r, '1.2.0'), true)
  assert.equal(satisfies(r, '1.9.3'), true)
  assert.equal(satisfies(r, '2.0.0'), false)
  assert.equal(satisfies(r, '1.1.9'), false)
  const z = parseRange('^0.1.2')
  assert.equal(satisfies(z, '0.1.9'), true)
  assert.equal(satisfies(z, '0.2.0'), false)
  const zz = parseRange('^0.0.3')
  assert.equal(satisfies(zz, '0.0.3'), true)
  assert.equal(satisfies(zz, '0.0.4'), false)
})

test('tilde allows patches, exact allows itself, and no range takes a prerelease', () => {
  const t = parseRange('~1.2.3')
  assert.equal(satisfies(t, '1.2.9'), true)
  assert.equal(satisfies(t, '1.3.0'), false)
  const e = parseRange('1.2.3')
  assert.equal(satisfies(e, '1.2.3'), true)
  assert.equal(satisfies(e, '1.2.4'), false)
  assert.equal(satisfies(parseRange('^1.2.0'), '1.3.0-beta.1'), false)
  assert.equal(satisfies(parseRange('^1.2.0'), 'garbage'), false)
})
