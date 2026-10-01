// The npm side of the bump tests: a real registry process, real `npm pack` tarballs, and a
// meta -> template -> app family whose template depends on a module from that registry.
import { spawn, execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { makeRepo, makeChild, metaFiles, commit, write, sh } from './helpers.mjs'

const SERVER = join(dirname(fileURLToPath(import.meta.url)), 'registry-server.mjs')
export const MOD = '@supersuit/living-fixture'

export async function startRegistry(base) {
  const dir = join(base, 'registry')
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'index.json'), '{}\n')
  const child = spawn(process.execPath, [SERVER, dir], { stdio: ['ignore', 'pipe', 'inherit'] })
  // Never leave the server running if the test process dies before close() is reached.
  process.once('exit', () => child.kill())
  const port = await new Promise((ok, fail) => {
    child.stdout.once('data', (d) => ok(String(d).trim()))
    child.once('exit', (code) => fail(new Error(`registry exited ${code}`)))
  })
  let n = 0
  return {
    url: `http://127.0.0.1:${port}/`,
    // A version whose module says it works, or (works: false) one that breaks the app's check.
    publish(name, version, { works = true } = {}) {
      const src = join(base, `pkg-src-${n++}`)
      mkdirSync(src, { recursive: true })
      writeFileSync(join(src, 'package.json'), JSON.stringify({ name, version, main: 'index.js' }) + '\n')
      writeFileSync(join(src, 'index.js'), `module.exports = { works: ${works} }\n`)
      const file = execFileSync('npm', ['pack', '--silent', '--pack-destination', dir], { cwd: src, encoding: 'utf8', env: process.env }).trim().split('\n').pop()
      const index = JSON.parse(readFileSync(join(dir, 'index.json'), 'utf8'))
      ;(index[name] ??= {})[version] = file
      writeFileSync(join(dir, 'index.json'), JSON.stringify(index, null, 2) + '\n')
    },
    close: () => child.kill(),
  }
}

// Point every npm and pnpm this process starts at the throwaway registry, with nothing from the
// real machine's ~/.npmrc (a scoped registry line there would send @supersuit to npmjs.org) and
// no cache or store of the real machine's touched (pnpm's metadata cache is cache_dir).
export function isolateNpm(base, reg) {
  writeFileSync(join(base, 'npmrc'), '')
  Object.assign(process.env, {
    npm_config_registry: reg.url,
    npm_config_userconfig: join(base, 'npmrc'),
    npm_config_cache: join(base, 'npm-cache'),
    npm_config_cache_dir: join(base, 'pnpm-cache'),
    npm_config_store_dir: join(base, 'pnpm-store'),
    npm_config_audit: 'false',
    npm_config_fund: 'false',
    npm_config_update_notifier: 'false',
  })
}

const CHECK = `// The fixture template's own check: every dependency must load and say it works.
import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
const require = createRequire(import.meta.url)
const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'))
for (const name of Object.keys(pkg.dependencies ?? {})) {
  if (require(name).works !== true) { console.error(name + ' broke the app'); process.exit(1) }
}
`

export function makeModuleChain(base, { pm = 'npm', deps = { [MOD]: '^0.1.2' }, living } = {}) {
  const meta = makeRepo(base, 'meta', metaFiles({ 'living/version.txt': '1\n' }))
  const template = makeChild(base, 'template', meta)
  const pkg = { name: 'fixture-template', private: true, scripts: { 'living:check': 'node check.mjs' }, dependencies: deps, ...(living ? { living } : {}) }
  write(template.work, { 'package.json': JSON.stringify(pkg, null, 2) + '\n', 'check.mjs': CHECK, '.gitignore': 'node_modules\n' })
  execFileSync(pm, ['install'], { cwd: template.work, env: process.env, stdio: 'pipe' })
  const lockfile = pm === 'pnpm' ? 'pnpm-lock.yaml' : 'package-lock.json'
  sh(template.work, 'add', '--', 'package.json', 'check.mjs', '.gitignore', lockfile)
  sh(template.work, 'commit', '-q', '-m', 'template: an app on a module')
  sh(template.work, 'push', '-q', 'origin', 'main')
  const app = makeChild(base, 'app', template)
  commit(app.work, { 'tailor/settings.txt': 'name=real\n' }, 'app: tailor')
  sh(app.work, 'push', '-q', 'origin', 'main')
  return { base, meta, template, app, lockfile }
}
