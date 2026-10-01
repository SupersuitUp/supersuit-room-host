#!/usr/bin/env node
// The updater. Same job at every level of the family: is my parent (the `template` remote)
// ahead of me? Then merge it in a throwaway worktree, keep my tailor/ and README, run my own
// `living:check`, and publish only if every step passed. Anything that goes wrong publishes
// nothing and says what blocked it; the checkout is never touched unless the result is green.
//
//   node living/update.mjs [--repo <path>] [--dry-run] [--json]
//   exit 0 updated / current / ahead (dry run), 2 blocked, 1 crashed
import { existsSync, readFileSync, mkdtempSync, rmSync, unlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'
import { git, tryGit, lines, isKept } from './git.mjs'
import { divergence } from './divergence.mjs'

const PARENT = 'template'

export async function update({ repo = process.cwd(), dryRun = false } = {}) {
  repo = resolve(repo)
  const report = { repo, parent: null, status: 'current', merged: [], divergent: [], parentTailorOnly: [], blockedBy: null }
  const blocked = (reason, extra = {}) => ({ ...report, status: 'blocked', blockedBy: { reason, ...extra } })

  const parentUrl = tryGit(repo, 'remote', 'get-url', PARENT)
  if (!parentUrl.ok) return blocked('no template remote')
  report.parent = parentUrl.out

  const dirty = git(repo, 'status', '--porcelain')
  if (dirty) return blocked('dirty', { files: lines(dirty).map((l) => l.slice(3)) })

  const fetched = tryGit(repo, 'fetch', '--quiet', PARENT)
  if (!fetched.ok) return blocked('fetch failed', { output: fetched.err })
  tryGit(repo, 'fetch', '--quiet', 'origin')

  const branch = git(repo, 'rev-parse', '--abbrev-ref', 'HEAD')
  const parentRef = `${PARENT}/main`
  report.merged = lines(git(repo, 'log', '--format=%h %s', `HEAD..${parentRef}`))
  if (report.merged.length === 0) return { ...report, divergent: divergence(repo, parentRef) }
  if (dryRun) return { ...report, status: 'ahead', divergent: divergence(repo, parentRef) }

  const wt = mkdtempSync(join(tmpdir(), 'living-update-'))
  rmSync(wt, { recursive: true, force: true })
  git(repo, 'worktree', 'add', '--quiet', '--detach', wt, 'HEAD')
  try {
    git(wt, 'config', 'merge.ours.driver', 'true')
    const merge = tryGit(wt, 'merge', '--no-commit', '--no-ff', parentRef)
    if (!merge.ok && !existsSync(join(git(wt, 'rev-parse', '--git-dir'), 'MERGE_HEAD'))) {
      return blocked('merge failed', { output: merge.err || merge.out })
    }

    // Keep this copy's own files, whatever the merge did to them.
    const touched = new Set([
      ...lines(git(wt, 'diff', '--name-only', 'HEAD')),
      ...lines(git(wt, 'diff', '--name-only', '--cached', 'HEAD')),
      ...lines(git(wt, 'diff', '--name-only', '--diff-filter=U')),
    ])
    for (const path of touched) {
      if (!isKept(path)) continue
      if (tryGit(wt, 'cat-file', '-e', `HEAD:${path}`).ok) {
        git(wt, 'checkout', 'HEAD', '--', path)
      } else {
        git(wt, 'rm', '--quiet', '--cached', '--force', '--', path)
        if (existsSync(join(wt, path))) unlinkSync(join(wt, path))
        if (path.startsWith('tailor/')) report.parentTailorOnly.push(path)
      }
    }

    const conflicts = lines(git(wt, 'diff', '--name-only', '--diff-filter=U'))
    if (conflicts.length) {
      tryGit(wt, 'merge', '--abort')
      return blocked('conflict', { files: conflicts })
    }
    git(wt, 'commit', '--quiet', '--no-edit')
    const mergeSha = git(wt, 'rev-parse', 'HEAD')

    const check = runCheck(wt)
    if (!check.ok) return blocked(check.reason, { output: check.output })

    const push = tryGit(repo, 'push', '--quiet', 'origin', `${mergeSha}:${branch}`)
    if (!push.ok) return blocked('push failed', { output: push.err })
    git(repo, 'merge', '--quiet', '--ff-only', mergeSha)
    return { ...report, status: 'updated', divergent: divergence(repo, parentRef) }
  } finally {
    tryGit(repo, 'worktree', 'remove', '--force', wt)
    rmSync(wt, { recursive: true, force: true })
  }
}

// The repository's own check, which the repository defines and the meta-template never does.
function runCheck(dir) {
  const pkgPath = join(dir, 'package.json')
  const pkg = existsSync(pkgPath) ? JSON.parse(readFileSync(pkgPath, 'utf8')) : null
  if (!pkg?.scripts?.['living:check']) return { ok: false, reason: 'no living:check script', output: '' }
  const pm = existsSync(join(dir, 'pnpm-lock.yaml')) ? 'pnpm' : 'npm'
  const install = pm === 'pnpm' ? ['install', '--frozen-lockfile'] : existsSync(join(dir, 'package-lock.json')) ? ['ci'] : null
  if (install) {
    const r = run(pm, install, dir)
    if (!r.ok) return { ok: false, reason: 'install failed', output: r.output }
  }
  const r = run(pm, ['run', 'living:check'], dir)
  return r.ok ? { ok: true } : { ok: false, reason: 'check failed', output: r.output }
}

function run(cmd, args, cwd) {
  const r = spawnSync(cmd, args, { cwd, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, env: { ...process.env, CI: '1' } })
  const output = `${r.stdout ?? ''}${r.stderr ?? ''}`.slice(-4000)
  return { ok: r.status === 0, output }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const args = process.argv.slice(2)
  const opt = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined }
  try {
    const r = await update({ repo: opt('--repo') ?? process.cwd(), dryRun: args.includes('--dry-run') })
    if (args.includes('--json')) console.log(JSON.stringify(r, null, 2))
    else {
      console.log(`${r.repo}: ${r.status}${r.blockedBy ? ` (${r.blockedBy.reason})` : ''}`)
      for (const m of r.merged) console.log(`  ${r.status === 'updated' ? 'merged' : 'pending'} ${m}`)
      for (const f of r.blockedBy?.files ?? []) console.log(`  blocked by ${f}`)
      for (const d of r.divergent) console.log(`  diverges: ${d.file}${d.parentChanges.length ? ` (parent since: ${d.parentChanges.join('; ')})` : ''}`)
      for (const t of r.parentTailorOnly) console.log(`  parent has tailor file you do not: ${t}`)
    }
    process.exit(r.status === 'blocked' ? 2 : 0)
  } catch (e) {
    console.error(e.message)
    process.exit(1)
  }
}
