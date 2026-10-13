// Every living/ command line refuses what it does not know. Each case runs the real script in a
// child process with HOME pointed at a throwaway folder and a throwaway cwd, so nothing here can
// reach ~/.living-template or ~/Library/LaunchAgents, and `nightly` is only ever run against
// that empty HOME (its registry is empty, so it has nothing to touch).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { readdirSync, existsSync, mkdirSync, readFileSync, writeFileSync, chmodSync } from 'node:fs'
import { join } from 'node:path'
import { tmp, cleanup, ROOT, sh } from './helpers.mjs'
import { install } from '../install-nightly.mjs'

const CLIS = ['install-nightly', 'new-template', 'new-app', 'update', 'bump', 'nightly']

function run(script, args, { home, cwd }) {
  const env = { ...process.env, HOME: home }
  delete env.LIVING_NOTIFY_CMD
  delete env.LIVING_HEARTBEAT_CMD
  const r = spawnSync(process.execPath, [join(ROOT, 'living', `${script}.mjs`), ...args], { cwd, env, encoding: 'utf8' })
  return { code: r.status, out: r.stdout, err: r.stderr }
}

function sandbox() {
  const base = tmp('cli')
  const home = join(base, 'home')
  const cwd = join(base, 'cwd')
  mkdirSync(home); mkdirSync(cwd)
  return { base, home, cwd }
}
const listing = (s) => [readdirSync(s.home, { recursive: true }), readdirSync(s.cwd, { recursive: true })]

for (const cli of CLIS) {
  for (const flag of ['--help', '-h']) {
    test(`${cli} ${flag} prints usage, exits 0 and touches nothing`, () => {
      const s = sandbox()
      try {
        const r = run(cli, [flag], s)
        assert.equal(r.code, 0, r.err)
        assert.match(r.out, /usage/i)
        assert.deepEqual(listing(s), [[], []])
      } finally { cleanup(s.base) }
    })
  }

  test(`${cli} refuses an unknown flag with exit 2, naming it, and touches nothing`, () => {
    const s = sandbox()
    try {
      const args = cli === 'new-template' || cli === 'new-app' ? [join(s.cwd, 'x'), '--bogus-flag'] : cli === 'install-nightly' ? [s.cwd, '--bogus-flag'] : ['--bogus-flag']
      const r = run(cli, args, s)
      assert.equal(r.code, 2, r.out + r.err)
      assert.match(r.err, /--bogus-flag/)
      assert.deepEqual(listing(s), [[], []])
    } finally { cleanup(s.base) }
  })
}

test('install-nightly <repo> --help does not register <repo>/--help, and writes no registry or plist', () => {
  const s = sandbox()
  try {
    const repo = join(s.base, 'repo')
    mkdirSync(repo)
    sh(repo, 'init', '-q')
    const r = run('install-nightly', [repo, '--help'], s)
    assert.equal(r.code, 0)
    assert.deepEqual(readdirSync(s.home, { recursive: true }), [])
  } finally { cleanup(s.base) }
})

test('install-nightly refuses a path that is not an existing git repo, before writing anything', () => {
  const s = sandbox()
  try {
    const plain = join(s.base, 'plain')
    mkdirSync(plain)
    for (const target of [join(s.base, 'missing'), plain]) {
      const r = run('install-nightly', [target, '--register-only'], s)
      assert.equal(r.code, 2, r.err)
      assert.match(r.err, /not a git repo/)
      assert.deepEqual(readdirSync(s.home, { recursive: true }), [])
    }
    const full = run('install-nightly', [join(s.base, 'missing')], s)
    assert.equal(full.code, 2)
    assert.deepEqual(readdirSync(s.home, { recursive: true }), [])
  } finally { cleanup(s.base) }
})

test('install() with a real repo registers it; with a non-repo it refuses and writes neither registry nor plist', () => {
  const s = sandbox()
  try {
    const repo = join(s.base, 'repo')
    mkdirSync(repo)
    sh(repo, 'init', '-q')
    const registry = join(s.home, 'repos.json')
    const plistFile = join(s.home, 'job.plist')
    const opts = { env: {}, registry, plistFile, load: () => { throw new Error('must not load') }, log: join(s.home, 'l.log') }
    const bad = install({ ...opts, argv: [join(s.base, 'nope')] })
    assert.equal(bad.code, 2)
    assert.equal(existsSync(registry) || existsSync(plistFile), false)
    const good = install({ ...opts, argv: [repo, '--register-only'] })
    assert.equal(good.code, 0)
    assert.deepEqual(JSON.parse(readFileSync(registry, 'utf8')), { repos: [repo] })
  } finally { cleanup(s.base) }
})

// The real script, a real repository, a throwaway HOME: everything a full install needs. `launchctl`
// on PATH is a stand-in that only records its arguments, so this can never reach the real job, and
// the assertion is that the script never called it.
test('install-nightly <repo> under a throwaway HOME refuses, writes nothing there and never calls launchctl', () => {
  const s = sandbox()
  try {
    const repo = join(s.base, 'repo')
    const fake = join(s.base, 'fakebin')
    const calls = join(s.base, 'launchctl-calls')
    mkdirSync(repo); mkdirSync(fake)
    sh(repo, 'init', '-q')
    writeFileSync(join(fake, 'launchctl'), `#!/bin/sh\necho "$@" >> "${calls}"\n`)
    chmodSync(join(fake, 'launchctl'), 0o755)
    const env = { ...process.env, HOME: s.home, PATH: `${fake}:${process.env.PATH}` }
    delete env.LIVING_NOTIFY_CMD
    delete env.LIVING_HEARTBEAT_CMD
    const r = spawnSync(process.execPath, [join(ROOT, 'living', 'install-nightly.mjs'), repo, '--notify', 'true'], { cwd: s.cwd, env, encoding: 'utf8' })
    assert.equal(r.status, 2, r.stdout + r.stderr)
    assert.match(r.stderr, /HOME/)
    assert.equal(existsSync(calls), false, 'launchctl was called')
    assert.deepEqual(readdirSync(s.home, { recursive: true }), [])
  } finally { cleanup(s.base) }
})
