#!/usr/bin/env node
// The nightly runner: every living repository registered on this machine, parents first, one
// update each. A change to the meta-template reaches its templates and then their apps in a
// single run. A repository registered as a TEMPLATE also gets the module bump right after its
// own update, so the version it takes reaches its apps in the same run; an app never picks a
// module version itself. Only a night where something published, was blocked, or is newly held
// is reported; a quiet night says nothing, and the same held or refused version is told once.
//
//   node living/nightly.mjs [--registry <file>] [--json]
//   registry: ~/.living-template/repos.json, { "repos": ["/abs/path", ...], "templates": [...] }
//   beside the registry: last-run.json and modules-seen.json
//   LIVING_NOTIFY_CMD: a shell command given each report worth telling as JSON on stdin
import { existsSync, readFileSync, writeFileSync, mkdirSync, renameSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve, dirname } from 'node:path'
import { spawnSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'
import { tryGit } from './git.mjs'
import { update } from './update.mjs'
import { bump, statusOf } from './bump.mjs'

export const HOME = join(homedir(), '.living-template')
export const REGISTRY = join(HOME, 'repos.json')

const readJson = (file) => (existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : {})
const readRegistry = (file) => readJson(file).repos ?? []
const readTemplates = (file) => readJson(file).templates ?? []

export function register(repo, file = REGISTRY, { template = false } = {}) {
  const reg = readJson(file)
  const repos = reg.repos ?? []
  const templates = reg.templates ?? []
  const path = resolve(repo)
  if (!repos.includes(path)) repos.push(path)
  if (template && !templates.includes(path)) templates.push(path)
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, JSON.stringify(templates.length ? { repos, templates } : { repos }, null, 2) + '\n')
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

// What one repository's module report adds to what was already told. A taken version is always
// news; a held, refused or skipped module, or a block, only the first night it appears.
// A blocked report returned before any module was looked at, so its empty held and refused
// lists say nothing: the previous ones are carried forward, or the night it recovers would
// tell the same held version again.
// A skipped module (declared with a range the bump does not move, or a living.modules entry that
// is not a package name) is told once per declaration: changing the declaration tells it again.
const skipKey = (s) => `${s.spec ?? null}|${s.reason}`

export function remember(m, prev = {}) {
  if (m.blockedBy) return { held: { ...prev.held }, refused: { ...prev.refused }, skipped: { ...prev.skipped }, blocked: m.blockedBy.reason }
  return {
    held: Object.fromEntries(m.held.map((h) => [h.name, h.available])),
    refused: Object.fromEntries(m.refused.map((f) => [f.name, f.to ?? f.reason])),
    skipped: Object.fromEntries((m.skipped ?? []).map((s) => [s.name, skipKey(s)])),
    blocked: null,
  }
}

export function freshNews(m, prev = {}) {
  const held = m.held.filter((h) => prev.held?.[h.name] !== h.available)
  const refused = m.refused.filter((f) => prev.refused?.[f.name] !== (f.to ?? f.reason))
  const skipped = (m.skipped ?? []).filter((s) => prev.skipped?.[s.name] !== skipKey(s))
  const blockedBy = m.blockedBy && prev.blocked !== m.blockedBy.reason ? m.blockedBy : null
  if (!m.taken.length && !held.length && !refused.length && !skipped.length && !blockedBy) return null
  const news = { ...m, held, refused, skipped, blockedBy }
  return { ...news, status: statusOf(news) }
}

// The told-once memo is only a memo: one that cannot be read must never stop the updates. It is
// set aside (at worst a held version is told one more time), said once in the run's output, and
// rewritten whole at the end of the run.
function readSeen(file, warn) {
  let seen
  try { seen = readJson(file) } catch (e) {
    warn(`${file} could not be read (${e.message}); starting it again, so a held version may be told once more`)
    return {}
  }
  if (seen && typeof seen === 'object' && !Array.isArray(seen)) return seen
  warn(`${file} is not an object; starting it again, so a held version may be told once more`)
  return {}
}

// Written beside itself and renamed into place, so a run killed mid-write, or a second run reading
// while this one writes, never sees half a file.
function writeAtomic(file, body) {
  mkdirSync(dirname(file), { recursive: true })
  const tmpFile = `${file}.tmp`
  writeFileSync(tmpFile, body)
  renameSync(tmpFile, file)
}

export async function nightly({ registry = REGISTRY, notify = null, bumpModules = bump, seenFile = join(dirname(registry), 'modules-seen.json'), warn = (m) => console.error(m) } = {}) {
  const templates = new Set(readTemplates(registry).map((p) => resolve(p)))
  const seen = templates.size ? readSeen(seenFile, warn) : {}
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

    // The module bump, for templates only, and never on a checkout whose update was blocked
    // (dirty, ahead, diverged, crashed...): that report has told the owner, and a bump would be
    // blocked for the same reason and say the same thing again.
    if (!templates.has(resolve(repo)) || r.status === 'blocked') continue
    let m
    try {
      m = await bumpModules({ repo })
    } catch (e) {
      m = { repo, kind: 'modules', status: 'blocked', taken: [], refused: [], held: [], skipped: [], blockedBy: { reason: 'crashed', output: e.message } }
    }
    reports.push(m)
    const news = freshNews(m, seen[m.repo])
    seen[m.repo] = remember(m, seen[m.repo])
    if (notify && news) await notify(news)
  }
  if (templates.size) writeAtomic(seenFile, JSON.stringify(seen, null, 2) + '\n')
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
  const registry = i >= 0 ? resolve(args[i + 1]) : REGISTRY
  const cmd = process.env.LIVING_NOTIFY_CMD
  const reports = await nightly({ registry, notify: cmd ? shellNotifier(cmd) : null })
  // Beside the registry, so a throwaway --registry run never overwrites the machine's real record.
  const home = dirname(registry)
  mkdirSync(home, { recursive: true })
  writeFileSync(join(home, 'last-run.json'), JSON.stringify({ at: new Date().toISOString(), reports }, null, 2) + '\n')
  if (args.includes('--json')) console.log(JSON.stringify(reports, null, 2))
  else for (const r of reports) console.log(`${new Date().toISOString()} ${r.repo}: ${r.kind === 'modules' ? 'modules ' : ''}${r.status}${r.blockedBy ? ` (${r.blockedBy.reason})` : ''}`)
  process.exit(reports.some((r) => r.status === 'blocked') ? 2 : 0)
}
