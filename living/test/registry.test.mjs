import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { tmp, cleanup, read, sh } from './helpers.mjs'
import { startRegistry, isolateNpm, makeModuleChain, MOD } from './registry.mjs'

test('the throwaway registry serves what was published to npm view and npm install', async () => {
  const base = tmp('registry')
  const reg = await startRegistry(base)
  try {
    isolateNpm(base, reg)
    assert.equal(process.env.npm_config_cache_dir, join(base, 'pnpm-cache'))
    reg.publish(MOD, '0.1.2')
    const c = makeModuleChain(base)
    // published after the chain, as the bump tests do: ^0.1.2 would take it at install time
    reg.publish(MOD, '0.1.3', { works: false })
    const versions = JSON.parse(execFileSync('npm', ['view', MOD, 'versions', '--json'], { cwd: base, encoding: 'utf8', env: process.env }))
    assert.deepEqual(versions, ['0.1.2', '0.1.3'])
    assert.equal(c.lockfile, 'package-lock.json')
    const lock = JSON.parse(read(c.template.work, 'package-lock.json'))
    assert.equal(lock.packages[`node_modules/${MOD}`].version, '0.1.2')
    assert.match(sh(c.template.work, 'ls-files'), /package-lock\.json/)
    assert.equal(JSON.parse(readFileSync(join(c.template.work, 'node_modules', MOD, 'package.json'), 'utf8')).version, '0.1.2')
    assert.equal(sh(c.app.work, 'remote', 'get-url', 'template'), c.template.bare)
  } finally { reg.close(); cleanup(base) }
})

test('the registry process is gone after close, and nothing was written under the real home', async () => {
  const base = tmp('registry')
  const reg = await startRegistry(base)
  isolateNpm(base, reg)
  reg.close()
  await new Promise((r) => setTimeout(r, 300))
  await assert.rejects(fetch(reg.url + MOD))
  cleanup(base)
  assert.equal(existsSync(join(homedir(), '.living-template', 'registry')), false)
})
