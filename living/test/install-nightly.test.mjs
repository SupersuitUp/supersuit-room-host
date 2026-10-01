// install-nightly against throwaway plists and registries only: every test passes its own
// registry, plist path and loader, so nothing here can touch ~/.living-template or the LaunchAgent.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { plist, parseArgs, readJob, planJob, install } from '../install-nightly.mjs'
import { tmp, cleanup } from './helpers.mjs'

const LIVE = '/live/living/nightly.mjs'
const job = (over = {}) => plist({ node: '/n', script: LIVE, path: '/usr/bin', notify: 'notify && say', log: '/l', ...over })
const always = () => true
const never = () => false

test('parseArgs reads every flag in any order, and takes notify from the environment when no flag is given', () => {
  assert.deepEqual(parseArgs(['/r', '--template', '--notify', 'say hi'], {}), { repo: '/r', notify: 'say hi', template: true, registerOnly: false, noNotify: false, moveJob: false })
  assert.deepEqual(parseArgs(['--notify', 'x', '/r'], {}), { repo: '/r', notify: 'x', template: false, registerOnly: false, noNotify: false, moveJob: false })
  assert.deepEqual(parseArgs(['--register-only', '/r', '--template'], {}), { repo: '/r', notify: undefined, template: true, registerOnly: true, noNotify: false, moveJob: false })
  assert.deepEqual(parseArgs(['/r', '--no-notify', '--move-job'], { LIVING_NOTIFY_CMD: 'env' }), { repo: '/r', notify: 'env', template: false, registerOnly: false, noNotify: true, moveJob: true })
  assert.equal(parseArgs(['/r'], { LIVING_NOTIFY_CMD: 'from env' }).notify, 'from env')
  assert.equal(parseArgs(['/r'], {}).notify, undefined)
})

test('readJob reads the script and the notify command back out of a plist, unescaped', () => {
  assert.deepEqual(readJob(job()), { script: LIVE, notify: 'notify && say' })
  assert.deepEqual(readJob(job({ notify: null })), { script: LIVE, notify: null })
  assert.equal(readJob('not a plist'), null)
})

test('a re-run with no notify given keeps the notify command already in the plist', () => {
  const p = planJob({ existing: readJob(job()), notify: undefined, script: LIVE, exists: always })
  assert.equal(p.error, undefined)
  assert.equal(p.notify, 'notify && say')
})

test('a re-run never drops the notify command silently: an explicitly empty one is refused, --no-notify removes it', () => {
  const existing = readJob(job())
  assert.match(planJob({ existing, notify: '', script: LIVE, exists: always }).error, /--no-notify/)
  assert.equal(planJob({ existing, notify: undefined, noNotify: true, script: LIVE, exists: always }).notify, null)
  assert.equal(planJob({ existing, notify: 'new', script: LIVE, exists: always }).notify, 'new')
  assert.match(planJob({ existing, notify: 'new', noNotify: true, script: LIVE, exists: always }).error, /both/)
})

test('a re-run from another copy of the framework keeps the job on the copy it already runs, unless --move-job', () => {
  const existing = readJob(job())
  const other = '/us-template/living/nightly.mjs'
  const kept = planJob({ existing, script: other, exists: always })
  assert.equal(kept.script, LIVE)
  assert.match(kept.notes.join('\n'), /--move-job/)
  assert.equal(planJob({ existing, script: other, moveJob: true, exists: always }).script, other)
})

test('a job whose script no longer exists is refused, naming both paths, unless --move-job', () => {
  const existing = readJob(job())
  const other = '/us-template/living/nightly.mjs'
  const r = planJob({ existing, script: other, exists: never })
  assert.match(r.error, new RegExp(LIVE.replace(/[/.]/g, '\\$&')))
  assert.match(r.error, /us-template/)
  assert.equal(planJob({ existing, script: other, moveJob: true, exists: never }).script, other)
})

test('a plist that cannot be read is never overwritten on a guess', () => {
  assert.match(planJob({ existing: undefined, unreadable: true, script: LIVE, exists: always }).error, /cannot read/)
  const p = planJob({ existing: undefined, unreadable: true, script: LIVE, moveJob: true, noNotify: true, exists: always })
  assert.equal(p.error, undefined)
})

test('a first install, with no plist yet, uses this copy and whatever notify was given', () => {
  assert.deepEqual(planJob({ existing: null, notify: 'n', script: LIVE, exists: always }), { notify: 'n', script: LIVE, notes: [] })
  assert.deepEqual(planJob({ existing: null, notify: undefined, script: LIVE, exists: always }), { notify: null, script: LIVE, notes: [] })
})

function sandbox() {
  const base = tmp('install')
  const registry = join(base, 'home', 'repos.json')
  const plistFile = join(base, 'LaunchAgents', 'job.plist')
  mkdirSync(join(base, 'LaunchAgents'), { recursive: true })
  const loads = []
  const opts = { env: {}, registry, plistFile, script: LIVE, load: (f) => { loads.push(f); return { ok: true } }, exists: always, log: join(base, 'home', 'nightly.log') }
  return { base, registry, plistFile, loads, opts }
}

test('--register-only adds the template to the registry and never touches the plist or the job', () => {
  const s = sandbox()
  try {
    writeFileSync(s.plistFile, job())
    const before = readFileSync(s.plistFile, 'utf8')
    const r = install({ ...s.opts, argv: ['/a/template', '--template', '--register-only'] })
    assert.equal(r.code, 0)
    assert.deepEqual(JSON.parse(readFileSync(s.registry, 'utf8')), { repos: ['/a/template'], templates: ['/a/template'] })
    assert.equal(readFileSync(s.plistFile, 'utf8'), before)
    assert.deepEqual(s.loads, [])
  } finally { cleanup(s.base) }
})

test('--register-only with no plist at all still writes none', () => {
  const s = sandbox()
  try {
    assert.equal(install({ ...s.opts, argv: ['/a/app', '--register-only'] }).code, 0)
    assert.equal(existsSync(s.plistFile), false)
  } finally { cleanup(s.base) }
})

test('a plain re-run keeps the live notify command and script, and reloads', () => {
  const s = sandbox()
  try {
    writeFileSync(s.plistFile, job())
    const r = install({ ...s.opts, script: '/elsewhere/living/nightly.mjs', argv: ['/a/template', '--template'] })
    assert.equal(r.code, 0)
    assert.deepEqual(readJob(readFileSync(s.plistFile, 'utf8')), { script: LIVE, notify: 'notify && say' })
    assert.deepEqual(s.loads, [s.plistFile])
  } finally { cleanup(s.base) }
})

test('a refused re-run exits 2 and leaves the registry, the plist and the job as they were', () => {
  const s = sandbox()
  try {
    writeFileSync(s.plistFile, job())
    const before = readFileSync(s.plistFile, 'utf8')
    const r = install({ ...s.opts, argv: ['/a/template', '--notify', ''] })
    assert.equal(r.code, 2)
    assert.equal(readFileSync(s.plistFile, 'utf8'), before)
    assert.equal(existsSync(s.registry), false)
    assert.deepEqual(s.loads, [])
  } finally { cleanup(s.base) }
})
