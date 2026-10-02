#!/usr/bin/env node
// The updater. Same job at every level of the family: is my parent (the `template` remote)
// ahead of me? Then merge it in a throwaway worktree, keep my tailor/ and README, run my own
// `living:check`, and publish only if every step passed. Anything that goes wrong publishes
// nothing and says what blocked it. The checkout itself moves only by fast-forward: to catch up
// with origin when it is clean and behind, and to the merge once it is published.
//
//   node living/update.mjs [--repo <path>] [--dry-run] [--json]
//   exit 0 updated / current / ahead (dry run), 2 blocked, 1 crashed
import { existsSync, mkdtempSync, rmSync, unlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { git, tryGit, lines, isKept, changedFiles, inSyncWithOrigin } from './git.mjs'
import { divergence } from './divergence.mjs'
import { runCheck, syncCheckout } from './check.mjs'
import { cliArgs } from './cli.mjs'

const PARENT = 'template'

export async function update({ repo = process.cwd(), dryRun = false } = {}) {
  repo = resolve(repo)
  const report = { repo, parent: null, status: 'current', merged: [], divergent: [], parentTailorOnly: [], blockedBy: null }
  const blocked = (reason, extra = {}) => ({ ...report, status: 'blocked', blockedBy: { reason, ...extra } })

  const parentUrl = tryGit(repo, 'remote', 'get-url', PARENT)
  if (!parentUrl.ok) return blocked('no template remote')
  report.parent = parentUrl.out

  const dirty = changedFiles(repo)
  if (dirty.length) return blocked('dirty', { files: dirty })

  const fetched = tryGit(repo, 'fetch', '--quiet', PARENT)
  if (!fetched.ok) return blocked('fetch failed', { output: fetched.err })

  // Publish only from a checkout that is exactly origin's default branch. Behind is the one block
  // an update resolves itself: the tree is clean (checked above) and no local commit exists, so a
  // fast-forward to what origin already published loses nothing, which is all `git pull` does.
  // Ahead, diverged, another branch, detached or unfetchable are reported and nothing is pushed.
  let sync = inSyncWithOrigin(repo)
  if (sync.blocked === 'behind origin' && !dryRun) {
    const upstream = `refs/remotes/origin/${sync.branch}`
    const pulled = lines(git(repo, 'log', '--format=%h %s', `HEAD..${upstream}`))
    const was = git(repo, 'rev-parse', 'HEAD')
    const ff = tryGit(repo, 'merge', '--quiet', '--ff-only', upstream)
    if (!ff.ok) return blocked('behind origin', { output: ff.err || ff.out })
    report.fastForwarded = pulled
    report.install = syncCheckout(repo, was, git(repo, 'rev-parse', 'HEAD'))
    sync = inSyncWithOrigin(repo)
  }
  if (sync.blocked) return blocked(sync.blocked, sync.output ? { output: sync.output } : {})
  const { branch } = sync
  const parentRef = `${PARENT}/main`
  report.merged = lines(git(repo, 'log', '--format=%h %s', `HEAD..${parentRef}`))
  if (report.merged.length === 0) return { ...report, divergent: divergence(repo, parentRef) }
  if (dryRun) return { ...report, status: 'ahead', divergent: divergence(repo, parentRef) }

  const wt = mkdtempSync(join(tmpdir(), 'living-update-'))
  rmSync(wt, { recursive: true, force: true })
  git(repo, 'worktree', 'add', '--quiet', '--detach', wt, `refs/remotes/origin/${branch}`)
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
    const name = (report.parent.split('/').pop() ?? 'template').replace(/\.git$/, '')
    const n = report.merged.length
    const subjects = report.merged.map((m) => m.slice(m.indexOf(' ') + 1))
    const shown = subjects.slice(0, 3).join('; ') + (n > 3 ? `; and ${n - 3} more` : '')
    git(wt, 'commit', '--quiet', '-m', `living: take ${n} change${n === 1 ? '' : 's'} from ${name} (${shown})`)
    const mergeSha = git(wt, 'rev-parse', 'HEAD')

    const check = runCheck(wt)
    if (!check.ok) return blocked(check.reason, { output: check.output })

    const push = tryGit(repo, 'push', '--quiet', 'origin', `${mergeSha}:refs/heads/${branch}`)
    if (!push.ok) return blocked('push failed', { output: push.err })
    // Published is published: origin has the merge and the children will take it. A checkout that
    // cannot follow is a warning on the update; the next run sees "behind origin" and catches up.
    // Divergence is then read from the worktree, whose HEAD is the published merge.
    const was = git(repo, 'rev-parse', 'HEAD')
    const ff = tryGit(repo, 'merge', '--quiet', '--ff-only', mergeSha)
    if (ff.ok) {
      const inst = syncCheckout(repo, was, mergeSha)
      if (report.install?.status !== 'failed' && (inst.status !== 'skipped' || !report.install)) report.install = inst
    }
    const installWarning = report.install?.status === 'failed' ? `published; install in the local checkout failed, so its node_modules are stale: ${report.install.output ?? ''}` : null
    const warning = ff.ok ? installWarning : `published; local checkout did not fast-forward: ${ff.err || ff.out}`.slice(0, 1000)
    return { ...report, status: 'updated', divergent: divergence(ff.ok ? repo : wt, parentRef), ...(warning ? { warning } : {}) }
  } finally {
    tryGit(repo, 'worktree', 'remove', '--force', wt)
    rmSync(wt, { recursive: true, force: true })
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const USAGE = 'usage: update.mjs [--repo <path>] [--dry-run] [--json]\n       update.mjs -h | --help'
  const { flags, values } = cliArgs(process.argv.slice(2), USAGE, { bool: ['--dry-run', '--json'], value: ['--repo'] })
  try {
    const r = await update({ repo: values['--repo'] ?? process.cwd(), dryRun: flags.has('--dry-run') })
    if (flags.has('--json')) console.log(JSON.stringify(r, null, 2))
    else {
      console.log(`${r.repo}: ${r.status}${r.blockedBy ? ` (${r.blockedBy.reason})` : ''}`)
      for (const m of r.fastForwarded ?? []) console.log(`  caught up with origin: ${m}`)
      if (r.install && r.install.status !== 'skipped') console.log(`  install in checkout: ${r.install.status}`)
      if (r.warning) console.log(`  warning: ${r.warning}`)
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
