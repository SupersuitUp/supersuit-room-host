// The one place living/ runs git. Synchronous on purpose: every step depends on the last.
import { spawnSync } from 'node:child_process'

export function tryGit(cwd, ...args) {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
  return { ok: r.status === 0, out: (r.stdout ?? '').trim(), err: (r.stderr ?? '').trim() }
}

export function git(cwd, ...args) {
  const r = tryGit(cwd, ...args)
  if (!r.ok) throw new Error(`git ${args.join(' ')} failed in ${cwd}: ${r.err || r.out}`)
  return r.out
}

export const lines = (s) => s.split('\n').map((l) => l.trim()).filter(Boolean)

// Paths an update never takes from the parent, at any level: whatever makes a copy someone's
// own (tailor/), and the README every child rewrites. .gitattributes says the same thing for
// the case where both sides changed a file; this list covers the case it cannot, a file only
// the parent changed, which git would otherwise take silently.
export const KEPT = [/^tailor\//, /^README\.md$/]
export const isKept = (path) => KEPT.some((re) => re.test(path))

// Every path git status reports as changed or untracked. Not through git(): git() trims its
// output, and porcelain's " M path" loses its leading column when trimmed, so slicing three
// characters off would report "ackage.json".
export function changedFiles(dir) {
  const r = spawnSync('git', ['status', '--porcelain', '-z', '--untracked-files=all'], { cwd: dir, encoding: 'utf8' })
  if (r.status !== 0) throw new Error(`git status failed in ${dir}: ${(r.stderr ?? '').trim()}`)
  const out = []
  const parts = r.stdout.split('\0').filter(Boolean)
  for (let i = 0; i < parts.length; i++) {
    out.push(parts[i].slice(3))
    if (/^[RC]/.test(parts[i])) i++ // a rename or copy carries its source path as the next entry
  }
  return out
}

// Whatever living/ publishes goes to origin's default branch, so the checkout must BE that branch,
// exactly as origin has it. Ahead would publish someone's unpushed commits along with ours; behind
// or diverged would build on a stale tree; another branch would publish something that never
// ships. Returns { branch } when in sync, else { blocked: reason } (plus output for a failed
// fetch, and the default branch when the block is ahead, behind or diverged). It never changes anything but the remote-tracking refs a fetch updates; what to do
// about a block is the caller's decision.
export function inSyncWithOrigin(repo) {
  const branch = tryGit(repo, 'symbolic-ref', '--quiet', '--short', 'HEAD')
  if (!branch.ok) return { blocked: 'detached HEAD' }
  const fetched = tryGit(repo, 'fetch', '--quiet', 'origin')
  if (!fetched.ok) return { blocked: 'fetch failed', output: fetched.err }
  const sym = tryGit(repo, 'ls-remote', '--symref', 'origin', 'HEAD')
  const def = /^ref: refs\/heads\/(\S+)\s+HEAD/m.exec(sym.out)?.[1]
  if (!def) return { blocked: 'no default branch on origin' }
  if (branch.out !== def) return { blocked: `not on ${def}` }
  const local = git(repo, 'rev-parse', 'HEAD')
  const remote = tryGit(repo, 'rev-parse', '--verify', '--quiet', `refs/remotes/origin/${def}`)
  if (!remote.ok) return { blocked: `no origin/${def}` }
  if (local === remote.out) return { branch: def }
  const isAncestor = (a, b) => tryGit(repo, 'merge-base', '--is-ancestor', a, b).ok
  if (isAncestor(local, remote.out)) return { blocked: 'behind origin', branch: def }
  if (isAncestor(remote.out, local)) return { blocked: 'ahead of origin', branch: def }
  return { blocked: 'diverged from origin', branch: def }
}
