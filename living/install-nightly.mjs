#!/usr/bin/env node
// Register a living repository on this machine and make sure the one nightly job exists.
// macOS only (a LaunchAgent at 03:30 local time). The job runs nightly.mjs from the copy of the
// framework it was first installed from, which is itself kept current by the nightly update of
// the repository it lives in.
//
//   node living/install-nightly.mjs <repo> [--template] [--register-only]
//                                   [--notify "<shell command>" | --no-notify] [--move-job]
//   --template       registers the repository as a TEMPLATE, so the nightly run also bumps its
//                    modules (living/bump.mjs); never use it for a tailored app.
//   --register-only  edits the registry only; the plist and the loaded job are not touched. The
//                    job already runs every registered repository, so this is all a new one needs.
//   notify           --notify, else LIVING_NOTIFY_CMD in the environment, else the command already
//                    in the live plist is kept. Removing it takes --no-notify; nothing drops it silently.
//   --move-job       run the job from THIS copy of the framework. Without it a re-run keeps the job
//                    on the copy it already runs, and refuses if that copy no longer exists.
//   -h, --help       print usage and exit 0; nothing is read or written.
//   exit 0 done, 1 usage or launchctl failed, 2 refused (nothing written): an unknown flag, a path
//   that is not an existing git repository, or a notify/script conflict
import { writeFileSync, readFileSync, mkdirSync, existsSync, realpathSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { spawnSync } from 'node:child_process'
import { register, HOME, REGISTRY } from './nightly.mjs'
import { parseCli } from './cli.mjs'
import { tryGit } from './git.mjs'

export const LABEL = 'com.living-template.nightly'
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

export function plist({ node, script, path, notify, log, hour = 3, minute = 30 }) {
  const env = [['PATH', path], ...(notify ? [['LIVING_NOTIFY_CMD', notify]] : [])]
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${esc(node)}</string>
    <string>${esc(script)}</string>
  </array>
  <key>EnvironmentVariables</key>
  <dict>
${env.map(([k, v]) => `    <key>${k}</key>\n    <string>${esc(v)}</string>`).join('\n')}
  </dict>
  <key>StartCalendarInterval</key>
  <dict>
    <key>Hour</key>
    <integer>${hour}</integer>
    <key>Minute</key>
    <integer>${minute}</integer>
  </dict>
  <key>StandardOutPath</key>
  <string>${esc(log)}</string>
  <key>StandardErrorPath</key>
  <string>${esc(log)}</string>
</dict>
</plist>
`
}

const FLAGS = ['--template', '--register-only', '--no-notify', '--move-job']

export const USAGE = 'usage: install-nightly.mjs <repo> [--template] [--register-only] [--notify "<cmd>" | --no-notify] [--move-job]\n       install-nightly.mjs -h | --help'

// { help } for -h/--help, { error } for anything undeclared, else the parsed command line.
export function parseArgs(argv, env = process.env) {
  const r = parseCli(argv, { bool: FLAGS, value: ['--notify'], positionals: 1 })
  if (r.help || r.error) return r
  const has = (f) => r.flags.has(f)
  return { repo: r.positionals[0], notify: r.values['--notify'] ?? env.LIVING_NOTIFY_CMD, template: has('--template'), registerOnly: has('--register-only'), noNotify: has('--no-notify'), moveJob: has('--move-job') }
}

// The registry only ever holds working repositories: the path must be the top of an existing git checkout.
export function isGitRepo(path) {
  try {
    const top = tryGit(path, 'rev-parse', '--show-toplevel')
    return top.ok && realpathSync(top.out) === realpathSync(path)
  } catch { return false }
}

const unesc = (s) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&')

// The live job as this file writes it: the script it runs and the notify command it carries.
// null when the text is not a job plist this can read.
export function readJob(xml) {
  const args = /<key>ProgramArguments<\/key>\s*<array>([\s\S]*?)<\/array>/.exec(xml ?? '')
  if (!args) return null
  const strings = [...args[1].matchAll(/<string>([\s\S]*?)<\/string>/g)].map((m) => unesc(m[1]))
  const env = /<key>EnvironmentVariables<\/key>\s*<dict>([\s\S]*?)<\/dict>/.exec(xml)?.[1] ?? ''
  const notify = /<key>LIVING_NOTIFY_CMD<\/key>\s*<string>([\s\S]*?)<\/string>/.exec(env)?.[1]
  return { script: strings[1] ?? null, notify: notify === undefined ? null : unesc(notify) }
}

// What the job should be after this run, from the live one: never drop notify without
// --no-notify, never move the job to another copy of the framework without --move-job.
// existing: readJob of the live plist, null when there is none; unreadable: a plist exists that
// readJob could not read. Returns { notify, script, notes } or { error }.
export function planJob({ existing, unreadable = false, notify, noNotify = false, moveJob = false, script, exists = existsSync }) {
  if (noNotify && notify) return { error: 'both --notify and --no-notify were given; pass one' }
  if (unreadable && !(moveJob && (noNotify || notify))) {
    return { error: 'cannot read the live plist, so its notify command and script are unknown; pass --move-job and --notify "<cmd>" (or --no-notify) to replace it, or --register-only to leave it' }
  }
  const notes = []
  const next = noNotify ? null : notify !== undefined ? notify : existing?.notify ?? null
  if (!next && existing?.notify && !noNotify) {
    return { error: `the live job tells "${existing.notify}" about blocked nights and this run would remove it; pass --no-notify to remove it on purpose, or --notify "<cmd>" to change it` }
  }
  let target = script
  if (existing?.script && existing.script !== script && !moveJob) {
    if (!exists(existing.script)) {
      return { error: `the live job runs ${existing.script}, which no longer exists; pass --move-job to run ${script} instead` }
    }
    target = existing.script
    notes.push(`the job stays on ${existing.script}; pass --move-job to run ${script} instead`)
  }
  return { notify: next, script: target, notes }
}

export const PLIST = join(homedir(), 'Library', 'LaunchAgents', `${LABEL}.plist`)
const THIS_SCRIPT = join(dirname(fileURLToPath(import.meta.url)), 'nightly.mjs')

function loadJob(file) {
  const domain = `gui/${process.getuid()}`
  spawnSync('launchctl', ['bootout', `${domain}/${LABEL}`])
  const r = spawnSync('launchctl', ['bootstrap', domain, file], { encoding: 'utf8' })
  return r.status === 0 ? { ok: true } : { ok: false, err: r.stderr }
}

// Everything the command does, with every path injectable so tests use throwaway files only.
// Refusals are decided before anything is written: a refused run leaves the registry, the plist
// and the job exactly as they were.
export function install({ argv, env = process.env, registry = REGISTRY, plistFile = PLIST, script = THIS_SCRIPT, load = loadJob, exists = existsSync, isRepo = isGitRepo, node = process.execPath, log = join(HOME, 'nightly.log') }) {
  const a = parseArgs(argv, env)
  const out = []
  if (a.help) return { code: 0, out: [USAGE] }
  if (a.error) return { code: 2, out, err: `refused, nothing changed: ${a.error}\n${USAGE}` }
  if (!a.repo) return { code: 1, out, err: USAGE }
  if (!isRepo(a.repo)) return { code: 2, out, err: `refused, nothing changed: ${a.repo} is not a git repo (not an existing git checkout)` }
  if (a.registerOnly) {
    const repos = register(a.repo, registry, { template: a.template })
    out.push(`registered ${repos.length} repo(s) in ${registry}${a.template ? `; ${a.repo} as a template` : ''}; the nightly job was not touched`)
    return { code: 0, out }
  }
  let existing = null
  let unreadable = false
  if (existsSync(plistFile)) {
    existing = readJob(readFileSync(plistFile, 'utf8'))
    unreadable = existing === null
  }
  const plan = planJob({ existing, unreadable, notify: a.notify, noNotify: a.noNotify, moveJob: a.moveJob, script, exists })
  if (plan.error) return { code: 2, out, err: `refused, nothing changed: ${plan.error}` }
  const repos = register(a.repo, registry, { template: a.template })
  mkdirSync(dirname(log), { recursive: true })
  mkdirSync(dirname(plistFile), { recursive: true })
  writeFileSync(plistFile, plist({
    node,
    script: plan.script,
    path: [dirname(node), join(homedir(), '.local', 'bin'), '/opt/homebrew/bin', '/usr/local/bin', '/usr/bin', '/bin'].join(':'),
    notify: plan.notify,
    log,
  }))
  const r = load(plistFile)
  if (!r.ok) return { code: 1, out, err: `launchctl bootstrap failed: ${r.err}` }
  out.push(...plan.notes)
  out.push(`registered ${repos.length} repo(s) in ${registry}${a.template ? `; ${a.repo} as a template` : ''}; nightly job ${LABEL} loaded (03:30) running ${plan.script}${plan.notify ? '' : ', with NO notify command'}`)
  return { code: 0, out }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const r = install({ argv: process.argv.slice(2) })
  for (const line of r.out) console.log(line)
  if (r.err) console.error(r.err)
  process.exit(r.code)
}
