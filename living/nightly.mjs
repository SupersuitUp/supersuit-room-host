#!/usr/bin/env node
// The nightly runner: every living repository registered on this machine, parents first, one
// update each. A change to the meta-template reaches its templates and then their apps in a
// single run. Only a night where something published or something was blocked is reported;
// a quiet night says nothing.
//
//   node living/nightly.mjs [--registry <file>] [--json]
//   registry: ~/.living-template/repos.json, { "repos": ["/abs/path", ...] }
//   LIVING_NOTIFY_CMD: a shell command given each report worth telling as JSON on stdin
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve, dirname } from 'node:path'
import { spawnSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'
import { tryGit } from './git.mjs'
import { update } from './update.mjs'

export const HOME = join(homedir(), '.living-template')
export const REGISTRY = join(HOME, 'repos.json')

const readRegistry = (file) => (existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')).repos ?? [] : [])

export function register(repo, file = REGISTRY) {
  const repos = readRegistry(file)
  const path = resolve(repo)
  if (!repos.includes(path)) repos.push(path)
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, JSON.stringify({ repos }, null, 2) + '\n')
  return repos
}

// The same repository is named by a GitHub URL in one place and a local path in another, so
// compare on a normalized form of every name a repo answers to.
const norm = (u) => u.replace(/\/+$/, '').replace(/\.git$/, '').replace(/^git@github\.com:/, 'https://github.com/').toLowerCase()
const url = (repo, remote) => { const r = tryGit(repo, 'remote', 'get-url', remote); return r.ok ? norm(r.out) : null }

export function orderParentsFirst(repos) {
  const names = new Map()
  for (const r of repos) {
    for (const n of [url(r, 'origin'), norm(resolve(r))]) if (n) names.set(n, r)
  }
  const parentOf = (r) => { const p = url(r, 'template'); return p ? names.get(p) ?? null : null }
  const depth = (r, seen = new Set()) => {
    const p = parentOf(r)
    if (!p || seen.has(r)) return 0
    seen.add(r)
    return 1 + depth(p, seen)
  }
  return repos.map((r, i) => ({ r, d: depth(r), i })).sort((a, b) => a.d - b.d || a.i - b.i).map((x) => x.r)
}

export async function nightly({ registry = REGISTRY, notify = null } = {}) {
  const reports = []
  for (const repo of orderParentsFirst(readRegistry(registry))) {
    let r
    try {
      r = await update({ repo })
    } catch (e) {
      r = { repo, status: 'blocked', merged: [], divergent: [], blockedBy: { reason: 'crashed', output: e.message } }
    }
    // A repository with no parent is the top of a family (the meta-template). Not an error.
    if (r.blockedBy?.reason === 'no template remote') r = { ...r, status: 'root', blockedBy: null }
    reports.push(r)
    if (notify && (r.status === 'updated' || r.status === 'blocked')) await notify(r)
  }
  return reports
}

export function shellNotifier(cmd) {
  return (report) => {
    const r = spawnSync('/bin/sh', ['-c', cmd], { input: JSON.stringify(report), encoding: 'utf8' })
    if (r.status !== 0) console.error(`notify failed for ${report.repo}: ${(r.stderr || r.stdout).trim()}`)
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const args = process.argv.slice(2)
  const i = args.indexOf('--registry')
  const registry = i >= 0 ? args[i + 1] : REGISTRY
  const cmd = process.env.LIVING_NOTIFY_CMD
  const reports = await nightly({ registry, notify: cmd ? shellNotifier(cmd) : null })
  mkdirSync(HOME, { recursive: true })
  writeFileSync(join(HOME, 'last-run.json'), JSON.stringify({ at: new Date().toISOString(), reports }, null, 2) + '\n')
  if (args.includes('--json')) console.log(JSON.stringify(reports, null, 2))
  else for (const r of reports) console.log(`${new Date().toISOString()} ${r.repo}: ${r.status}${r.blockedBy ? ` (${r.blockedBy.reason})` : ''}`)
  process.exit(reports.some((r) => r.status === 'blocked') ? 2 : 0)
}
