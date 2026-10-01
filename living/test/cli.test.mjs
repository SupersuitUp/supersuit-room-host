import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseCli } from '../cli.mjs'

const spec = { bool: ['--dry-run'], value: ['--repo'], multi: ['--word'], positionals: 1 }

test('parseCli reads declared flags, values, repeats and positionals in any order', () => {
  const r = parseCli(['--word', 'a', 'dir', '--dry-run', '--repo', '/r', '--word', 'b'], spec)
  assert.deepEqual([...r.flags], ['--dry-run'])
  assert.deepEqual(r.values, { '--repo': '/r' })
  assert.deepEqual(r.multi, { '--word': ['a', 'b'] })
  assert.deepEqual(r.positionals, ['dir'])
})

test('--help and -h win over everything else', () => {
  assert.deepEqual(parseCli(['dir', '--help'], spec), { help: true })
  assert.deepEqual(parseCli(['--bogus', '-h'], spec), { help: true })
})

test('an unknown flag, a missing value and an extra positional are refused by name', () => {
  assert.match(parseCli(['--nope'], spec).error, /--nope/)
  assert.match(parseCli(['-x'], spec).error, /-x/)
  assert.match(parseCli(['--repo'], spec).error, /--repo needs a value/)
  assert.match(parseCli(['--repo', '--dry-run'], spec).error, /--repo needs a value/)
  assert.match(parseCli(['a', 'b'], spec).error, /unexpected argument b/)
  assert.match(parseCli(['a'], { positionals: 0 }).error, /unexpected argument a/)
})

test('-- ends flag parsing', () => {
  assert.deepEqual(parseCli(['--', '--odd'], spec).positionals, ['--odd'])
})
