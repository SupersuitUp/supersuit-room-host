import { test } from 'node:test'
import assert from 'node:assert/strict'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { packageManager, runCheck } from '../check.mjs'
import { tmp, cleanup, checkScript } from './helpers.mjs'

test('the lockfile decides the package manager', () => {
  const base = tmp('pm')
  try {
    assert.deepEqual(packageManager(base), { pm: 'npm', lockfile: null })
    writeFileSync(join(base, 'package-lock.json'), '{}')
    assert.deepEqual(packageManager(base), { pm: 'npm', lockfile: 'package-lock.json' })
    writeFileSync(join(base, 'pnpm-lock.yaml'), 'lockfileVersion: 9.0\n')
    assert.deepEqual(packageManager(base), { pm: 'pnpm', lockfile: 'pnpm-lock.yaml' })
  } finally { cleanup(base) }
})

test('runCheck runs the repository\'s own living:check and reports its result', () => {
  const base = tmp('check')
  try {
    assert.deepEqual(runCheck(base), { ok: false, reason: 'no living:check script', output: '' })
    writeFileSync(join(base, 'package.json'), checkScript(true))
    assert.deepEqual(runCheck(base), { ok: true })
    writeFileSync(join(base, 'package.json'), checkScript(false))
    assert.equal(runCheck(base).reason, 'check failed')
  } finally { cleanup(base) }
})
