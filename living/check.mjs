// The repository's own check, which the repository defines and the meta-template never does.
// Shared by update.mjs (after taking the parent) and bump.mjs (after taking a module version):
// install exactly what the lockfile says, then `living:check`. Nothing publishes unless it passes.
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'

export function packageManager(dir) {
  if (existsSync(join(dir, 'pnpm-lock.yaml'))) return { pm: 'pnpm', lockfile: 'pnpm-lock.yaml' }
  if (existsSync(join(dir, 'package-lock.json'))) return { pm: 'npm', lockfile: 'package-lock.json' }
  return { pm: 'npm', lockfile: null }
}

export function runCheck(dir) {
  const pkgPath = join(dir, 'package.json')
  const pkg = existsSync(pkgPath) ? JSON.parse(readFileSync(pkgPath, 'utf8')) : null
  if (!pkg?.scripts?.['living:check']) return { ok: false, reason: 'no living:check script', output: '' }
  const { pm, lockfile } = packageManager(dir)
  const install = pm === 'pnpm' ? ['install', '--frozen-lockfile'] : lockfile ? ['ci'] : null
  if (install) {
    const r = run(pm, install, dir)
    if (!r.ok) return { ok: false, reason: 'install failed', output: r.output }
  }
  const r = run(pm, ['run', 'living:check'], dir)
  return r.ok ? { ok: true } : { ok: false, reason: 'check failed', output: r.output }
}

export function run(cmd, args, cwd) {
  const r = spawnSync(cmd, args, { cwd, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, env: { ...process.env, CI: '1' } })
  const output = `${r.stdout ?? ''}${r.stderr ?? ''}`.slice(-4000)
  return { ok: r.status === 0, output }
}
