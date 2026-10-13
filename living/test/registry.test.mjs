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
  try {
    isolateNpm(base, reg)
    reg.close()
    await new Promise((r) => setTimeout(r, 300))
    await assert.rejects(fetch(reg.url + MOD))
  } finally { reg.close(); cleanup(base) }
  assert.equal(existsSync(join(homedir(), '.living-template', 'registry')), false)
})

test('isolateNpm points npm\'s global config at a throwaway file too', async () => {
  const base = tmp('registry')
  const reg = await startRegistry(base)
  try {
    isolateNpm(base, reg)
    assert.equal(process.env.npm_config_globalconfig, join(base, 'npmrc-global'))
    assert.equal(existsSync(join(base, 'npmrc-global')), true)
  } finally { reg.close(); cleanup(base) }
})

// publish packs a real tarball; it must never run while npm could reach a real registry.
test('publish refuses unless npm is pointed at this throwaway registry', async () => {
  const base = tmp('registry')
  const reg = await startRegistry(base)
  const saved = { ...process.env }
  try {
    for (const k of ['npm_config_registry', 'npm_config_userconfig', 'npm_config_globalconfig']) delete process.env[k]
    assert.throws(() => reg.publish(MOD, '0.1.2'), /throwaway registry/)
    process.env.npm_config_registry = 'https://registry.npmjs.org/'
    assert.throws(() => reg.publish(MOD, '0.1.2'), /throwaway registry/)
    isolateNpm(base, reg)
    process.env.npm_config_globalconfig = join(homedir(), '.npmrc')
    assert.throws(() => reg.publish(MOD, '0.1.2'), /throwaway registry/)
    isolateNpm(base, reg)
    reg.publish(MOD, '0.1.2')
  } finally {
    for (const k of Object.keys(process.env)) if (!(k in saved)) delete process.env[k]
    Object.assign(process.env, saved)
    reg.close(); cleanup(base)
  }
})

// `pnpm run` and `npm run` export the calling repository's own .npmrc to every script as
// npm_config_* variables, and those outrank the throwaway config files. A template whose .npmrc
// sets minimum-release-age made every pnpm install against the throwaway registry fail
// (ERR_PNPM_MISSING_TIME: the fixture registry serves no publish times) the moment these tests
// ran from inside `pnpm run living:check`, while they passed run by hand.
test('isolateNpm drops config the calling package manager exported, so a run inside `pnpm run` is isolated too', async () => {
  const base = tmp('registry')
  const reg = await startRegistry(base)
  const saved = { ...process.env }
  try {
    process.env.npm_config_minimum_release_age = '10080'
    process.env.pnpm_config_verify_deps_before_run = 'false'
    isolateNpm(base, reg)
    assert.equal(process.env.npm_config_minimum_release_age, undefined)
    assert.equal(process.env.pnpm_config_verify_deps_before_run, undefined)
    assert.equal(process.env.npm_config_registry, reg.url)
  } finally {
    for (const k of Object.keys(process.env)) if (!(k in saved)) delete process.env[k]
    Object.assign(process.env, saved)
    reg.close(); cleanup(base)
  }
})
