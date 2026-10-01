// Throwaway repositories for the living/ tests. Every test builds its own family of repos
// under the OS temp folder: a bare "origin" for each level (what GitHub is in real life) and a
// working clone that the updater runs in.
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')

const ENV = {
  ...process.env,
  GIT_AUTHOR_NAME: 'Test', GIT_AUTHOR_EMAIL: 'test@example.invalid',
  GIT_COMMITTER_NAME: 'Test', GIT_COMMITTER_EMAIL: 'test@example.invalid',
  GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1',
}

// The updater runs git in this process, so its commits need an identity here too.
for (const k of ['GIT_AUTHOR_NAME', 'GIT_AUTHOR_EMAIL', 'GIT_COMMITTER_NAME', 'GIT_COMMITTER_EMAIL']) process.env[k] = ENV[k]

export const sh = (cwd, ...args) =>
  execFileSync('git', args, { cwd, env: ENV, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()

export function tmp(label = 'living') {
  return mkdtempSync(join(tmpdir(), `${label}-`))
}

export function write(repo, files) {
  for (const [path, body] of Object.entries(files)) {
    const full = join(repo, path)
    mkdirSync(dirname(full), { recursive: true })
    writeFileSync(full, body)
  }
}

export const read = (repo, path) => readFileSync(join(repo, path), 'utf8')

export function commit(repo, files, message = 'change') {
  write(repo, files)
  sh(repo, 'add', '--', ...Object.keys(files))
  sh(repo, 'commit', '-q', '-m', message)
  return sh(repo, 'rev-parse', 'HEAD')
}

// A working repo with a bare origin, seeded with `files`.
export function makeRepo(base, name, files) {
  const bare = join(base, `${name}.git`)
  const work = join(base, name)
  sh(base, 'init', '-q', '--bare', '-b', 'main', bare)
  sh(base, 'clone', '-q', bare, work)
  sh(work, 'checkout', '-q', '-b', 'main')
  commit(work, files, `${name}: first`)
  sh(work, 'push', '-q', '-u', 'origin', 'main')
  return { work, bare }
}

// A clone of `parent` (by its bare) that keeps the parent as `template` and gets its own bare origin.
export function makeChild(base, name, parent) {
  const bare = join(base, `${name}.git`)
  const work = join(base, name)
  sh(base, 'clone', '-q', parent.bare, work)
  sh(work, 'remote', 'rename', 'origin', 'template')
  sh(base, 'init', '-q', '--bare', '-b', 'main', bare)
  sh(work, 'remote', 'add', 'origin', bare)
  sh(work, 'push', '-q', '-u', 'origin', 'main')
  return { work, bare }
}

// The meta-template's real machinery, copied into a throwaway repo so the tests run the code
// under test as a child repo would carry it.
export function metaFiles(extra = {}) {
  return {
    '.gitattributes': read(ROOT, '.gitattributes'),
    'README.md': 'meta\n',
    'tailor/README.md': 'sample settings\n',
    'tailor/settings.txt': 'name=sample\n',
    ...extra,
  }
}

export function checkScript(pass) {
  return JSON.stringify({
    name: 'fixture', private: true,
    scripts: { 'living:check': `node -e "process.exit(${pass ? 0 : 1})"` },
  }, null, 2) + '\n'
}

// meta -> template -> app, each with a passing check.
export function makeChain(base = tmp('chain')) {
  const meta = makeRepo(base, 'meta', metaFiles({ 'living/version.txt': '1\n' }))
  const template = makeChild(base, 'template', meta)
  commit(template.work, { 'package.json': checkScript(true), 'app.txt': 'template app\n' }, 'template: app')
  sh(template.work, 'push', '-q', 'origin', 'main')
  const app = makeChild(base, 'app', template)
  commit(app.work, { 'tailor/settings.txt': 'name=real\n' }, 'app: tailor')
  sh(app.work, 'push', '-q', 'origin', 'main')
  return { base, meta, template, app }
}

export const cleanup = (base) => rmSync(base, { recursive: true, force: true })
export const head = (repo, ref = 'HEAD') => sh(repo, 'rev-parse', ref)
export const originMain = (repo) => { sh(repo, 'fetch', '-q', 'origin'); return head(repo, 'origin/main') }
export { ENV }
