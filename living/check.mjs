// The repository's own check, which the repository defines and the meta-template never does.
// Shared by update.mjs (after taking the parent) and bump.mjs (after taking a module version):
// install exactly what the lockfile says, then `living:check`. Nothing publishes unless it passes.
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { tryGit, lines } from './git.mjs'

export function packageManager(dir) {
  if (existsSync(join(dir, 'pnpm-lock.yaml'))) return { pm: 'pnpm', lockfile: 'pnpm-lock.yaml' }
  if (existsSync(join(dir, 'package-lock.json'))) return { pm: 'npm', lockfile: 'package-lock.json' }
  return { pm: 'npm', lockfile: null }
}

export function runCheck(dir) {
  const pkgPath = join(dir, 'package.json')
  const pkg = existsSync(pkgPath) ? JSON.parse(readFileSync(pkgPath, 'utf8')) : null
  if (!pkg?.scripts?.['living:check']) return { ok: false, reason: 'no living:check script', output: '' }
  const inst = installFrozen(dir)
  if (!inst.ok) return { ok: false, reason: 'install failed', output: inst.output }
  const r = run(packageManager(dir).pm, ['run', 'living:check'], dir)
  return r.ok ? { ok: true } : { ok: false, reason: 'check failed', output: r.output }
}

// Install exactly what the lockfile says, in `dir`. No lockfile, nothing to install.
export function installFrozen(dir) {
  const { pm, lockfile } = packageManager(dir)
  const install = pm === 'pnpm' ? ['install', '--frozen-lockfile'] : lockfile ? ['ci'] : null
  if (!install) return { ok: true, ran: false, output: '' }
  const r = run(pm, install, dir)
  return { ok: r.ok, ran: true, output: r.output }
}

// The checkout that just moved from `from` to `to` (a fast-forward onto commits that already
// passed their check in a throwaway worktree) keeps its own node_modules. Left alone they are the
// OLD program: a later `living:check` here would test something other than what ships. So when the
// move touched package.json or a lockfile, install frozen here too. Cheap to detect, so an update
// that touches no dependency never installs. The commits are published by now, so a failure here
// cannot block; it is reported.
export function syncCheckout(repo, from, to) {
  if (from === to) return { status: 'skipped' }
  const changed = tryGit(repo, 'diff', '--name-only', from, to)
  if (!changed.ok) return { status: 'failed', output: changed.err }
  const touchesDeps = lines(changed.out).some((f) => /(^|\/)(package\.json|package-lock\.json|pnpm-lock\.yaml|npm-shrinkwrap\.json|yarn\.lock)$/.test(f))
  if (!touchesDeps) return { status: 'skipped' }
  const r = installFrozen(repo)
  return r.ok ? { status: r.ran ? 'installed' : 'skipped' } : { status: 'failed', output: r.output }
}

export function run(cmd, args, cwd) {
  const r = spawnSync(cmd, args, { cwd, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, env: { ...process.env, CI: '1' } })
  const output = `${r.stdout ?? ''}${r.stderr ?? ''}`.slice(-4000)
  return { ok: r.status === 0, output }
}
