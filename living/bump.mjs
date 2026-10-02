#!/usr/bin/env node
// The module bump, for a TEMPLATE only; an app takes whatever its template pinned, through
// update.mjs. For each module dependency (package.json `living.modules`, default `@supersuit/*`):
// if a newer version is inside the declared range, take it in a throwaway worktree, install,
// run the template's own `living:check`, and publish only if every step passed. A version outside
// the range (a major, under ^; below 1.0 a minor, as npm reads it) is held for a person;
// `--allow-major <name>` takes it through the same check. One module at a time, so a broken module
// never blocks a working one.
//
//   node living/bump.mjs [--repo <path>] [--dry-run] [--allow-major <name>]... [--json]
//   exit 0 bumped / current / held / ahead (dry run), 2 blocked, 1 crashed
import { existsSync, readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'
import { git, tryGit, changedFiles, inSyncWithOrigin } from './git.mjs'
import { packageManager, runCheck, run, syncCheckout } from './check.mjs'
import { declaredModules, badModulePatterns, planModule } from './modules.mjs'
import { cliArgs } from './cli.mjs'

export function npmVersions(name, cwd) {
  const r = spawnSync('npm', ['view', name, 'versions', '--json'], { cwd, encoding: 'utf8', env: process.env })
  if (r.status !== 0) throw new Error(`npm view ${name} failed: ${`${r.stderr ?? ''}${r.stdout ?? ''}`.trim().slice(-500)}`)
  const v = JSON.parse(r.stdout || '[]')
  return Array.isArray(v) ? v : [v]
}

export function statusOf(r, dryRun = false) {
  if (r.blockedBy || r.refused.length) return 'blocked'
  if (r.taken.length) return dryRun ? 'ahead' : 'bumped'
  return r.held.length ? 'held' : 'current'
}

export async function bump({ repo = process.cwd(), dryRun = false, allowMajor = [], versionsOf = npmVersions } = {}) {
  repo = resolve(repo)
  const report = { repo, kind: 'modules', status: 'current', taken: [], refused: [], held: [], skipped: [], blockedBy: null }
  const done = () => ({ ...report, status: statusOf(report, dryRun) })

  const pkgPath = join(repo, 'package.json')
  if (!existsSync(pkgPath)) return done()
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'))
  // An entry of living.modules that is not a string cannot name a package; say so, never throw.
  for (const p of badModulePatterns(pkg)) report.skipped.push({ name: JSON.stringify(p) ?? String(p), spec: null, reason: 'not a package name' })
  const modules = declaredModules(pkg)
  if (!modules.length) return done()
  if (!packageManager(repo).lockfile) { report.blockedBy = { reason: 'no lockfile' }; return done() }
  const dirty = changedFiles(repo)
  if (dirty.length) { report.blockedBy = { reason: 'dirty', files: dirty }; return done() }
  tryGit(repo, 'worktree', 'prune') // a take killed mid-flight left a registered worktree behind
  const sync = inSyncWithOrigin(repo)
  if (sync.blocked) { report.blockedBy = { reason: sync.blocked, ...(sync.output ? { output: sync.output } : {}) }; return done() }
  const { branch } = sync

  for (const m of modules) {
    let versions
    try { versions = versionsOf(m.name, repo) } catch (e) {
      report.refused.push({ name: m.name, to: null, reason: 'versions unavailable', output: e.message })
      continue
    }
    const plan = planModule(m.spec, versions, { allowMajor: allowMajor.includes(m.name) })
    if (plan.skip) { report.skipped.push({ name: m.name, spec: m.spec, reason: plan.skip }); continue }
    if (plan.held) report.held.push({ name: m.name, range: m.spec, available: plan.held })
    if (!plan.take) continue
    if (dryRun) { report.taken.push({ name: m.name, from: m.spec, to: plan.take.to }); continue }
    let r
    try { r = takeOne(repo, branch, m, plan.take) } catch (e) { r = { ok: false, reason: 'crashed', output: e.message } }
    if (r.ok) report.taken.push({ name: m.name, from: m.spec, to: plan.take.to, ...(r.warning ? { warning: r.warning } : {}) })
    else report.refused.push({ name: m.name, to: plan.take.to, reason: r.reason, output: r.output ?? '', ...(r.files ? { files: r.files } : {}) })
  }
  return done()
}

// One module, one throwaway worktree: raise the range, let the package manager rewrite the
// lockfile, prove it resolved the version planned, commit only package.json and the lockfile,
// run the template's own check, and publish only if it passed. The checkout is touched only by a
// fast-forward to a commit that already passed. The worktree is removed on every path.
function takeOne(repo, branch, m, take) {
  const wt = mkdtempSync(join(tmpdir(), 'living-bump-'))
  rmSync(wt, { recursive: true, force: true })
  // Cut from origin, never from local HEAD (equal at the start; after a take, both moved together).
  git(repo, 'worktree', 'add', '--quiet', '--detach', wt, `refs/remotes/origin/${branch}`)
  try {
    const file = join(wt, 'package.json')
    const text = readFileSync(file, 'utf8')
    const pkg = JSON.parse(text)
    pkg[m.field][m.name] = take.spec
    const indent = /^([ \t]+)"/m.exec(text)?.[1] ?? '  '
    writeFileSync(file, JSON.stringify(pkg, null, indent) + '\n')

    const { pm, lockfile } = packageManager(wt)
    const inst = run(pm, pm === 'pnpm' ? ['install', '--no-frozen-lockfile'] : ['install', '--no-audit', '--no-fund'], wt)
    if (!inst.ok) return { ok: false, reason: 'install failed', output: inst.output }
    const got = installedVersion(wt, m.name)
    if (got !== take.to) return { ok: false, reason: 'resolved a different version', output: `planned ${take.to}, installed ${got}` }
    const extra = changedFiles(wt).filter((f) => f !== 'package.json' && f !== lockfile)
    if (extra.length) return { ok: false, reason: 'unexpected changes', files: extra }

    git(wt, 'add', '--', 'package.json', lockfile)
    git(wt, 'commit', '--quiet', '-m', `living: take ${m.name} ${take.to} (was ${m.spec})`, '--', 'package.json', lockfile)
    const sha = git(wt, 'rev-parse', 'HEAD')

    const check = runCheck(wt)
    if (!check.ok) return { ok: false, reason: check.reason, output: check.output }
    const push = tryGit(repo, 'push', '--quiet', 'origin', `${sha}:refs/heads/${branch}`)
    if (!push.ok) return { ok: false, reason: 'push failed', output: push.err }
    // Published is published: origin has it and apps will take it. A checkout that cannot follow
    // is a warning on the take, and the next run reports it as behind origin rather than retrying.
    const was = git(repo, 'rev-parse', 'HEAD')
    const ff = tryGit(repo, 'merge', '--quiet', '--ff-only', sha)
    if (!ff.ok) return { ok: true, warning: `published; local checkout not fast-forwarded: ${ff.err || ff.out}`.slice(0, 1000) }
    // The bump always changes package.json and the lockfile, so the checkout's node_modules are
    // the old version until it installs. Published already, so a failure is a warning.
    const synced = syncCheckout(repo, was, sha)
    if (synced.status === 'failed') return { ok: true, warning: `published; install in the local checkout failed, so its node_modules are stale: ${synced.output}`.slice(0, 1000) }
    return { ok: true }
  } finally {
    tryGit(repo, 'worktree', 'remove', '--force', wt)
    rmSync(wt, { recursive: true, force: true })
    tryGit(repo, 'worktree', 'prune')
  }
}

function installedVersion(dir, name) {
  try { return JSON.parse(readFileSync(join(dir, 'node_modules', name, 'package.json'), 'utf8')).version } catch { return null }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const USAGE = 'usage: bump.mjs [--repo <path>] [--dry-run] [--json] [--allow-major <module>]...\n       bump.mjs -h | --help'
  const { flags, values, multi } = cliArgs(process.argv.slice(2), USAGE, { bool: ['--dry-run', '--json'], value: ['--repo'], multi: ['--allow-major'] })
  try {
    const r = await bump({ repo: values['--repo'] ?? process.cwd(), dryRun: flags.has('--dry-run'), allowMajor: multi['--allow-major'] })
    if (flags.has('--json')) console.log(JSON.stringify(r, null, 2))
    else {
      console.log(`${r.repo}: modules ${r.status}${r.blockedBy ? ` (${r.blockedBy.reason})` : ''}`)
      for (const x of r.taken) console.log(`  ${r.status === 'ahead' ? 'would take' : 'took'} ${x.name} ${x.to} (was ${x.from})${x.warning ? `; ${x.warning}` : ''}`)
      for (const x of r.refused) console.log(`  refused ${x.name} ${x.to ?? ''}: ${x.reason}`)
      for (const x of r.held) console.log(`  held ${x.name} ${x.available}: outside ${x.range}; take it with --allow-major ${x.name}`)
      for (const x of r.skipped) console.log(`  skipped ${x.name}${x.spec ? ` ${x.spec}` : ''}: ${x.reason}`)
      for (const f of r.blockedBy?.files ?? []) console.log(`  blocked by ${f}`)
    }
    process.exit(r.status === 'blocked' ? 2 : 0)
  } catch (e) {
    console.error(e.message)
    process.exit(1)
  }
}
