#!/usr/bin/env node
// Register a living repository on this machine and make sure the one nightly job exists.
// macOS only (a LaunchAgent at 03:30 local time). The job runs THIS copy of nightly.mjs,
// which is itself kept current by the nightly update of the repository it lives in.
//
//   node living/install-nightly.mjs <repo> [--template] [--notify "<shell command>"]
//   LIVING_NOTIFY_CMD in the environment is used when --notify is not given.
//   --template registers the repository as a TEMPLATE, so the nightly run also bumps its modules
//   (living/bump.mjs); never use it for a tailored app.
import { writeFileSync, mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { spawnSync } from 'node:child_process'
import { register, HOME, REGISTRY } from './nightly.mjs'

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

export function parseArgs(argv) {
  const args = [...argv]
  const i = args.indexOf('--notify')
  const notify = i >= 0 ? args.splice(i, 2)[1] : process.env.LIVING_NOTIFY_CMD
  const t = args.indexOf('--template')
  const template = t >= 0
  if (template) args.splice(t, 1)
  return { repo: args[0], notify, template }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const { repo, notify, template } = parseArgs(process.argv.slice(2))
  if (!repo) { console.error('usage: install-nightly.mjs <repo> [--template] [--notify "<cmd>"]'); process.exit(1) }
  const repos = register(repo, REGISTRY, { template })
  mkdirSync(HOME, { recursive: true })
  const file = join(homedir(), 'Library', 'LaunchAgents', `${LABEL}.plist`)
  writeFileSync(file, plist({
    node: process.execPath,
    script: join(dirname(fileURLToPath(import.meta.url)), 'nightly.mjs'),
    path: [dirname(process.execPath), join(homedir(), '.local', 'bin'), '/opt/homebrew/bin', '/usr/local/bin', '/usr/bin', '/bin'].join(':'),
    notify,
    log: join(HOME, 'nightly.log'),
  }))
  const domain = `gui/${process.getuid()}`
  spawnSync('launchctl', ['bootout', `${domain}/${LABEL}`])
  const r = spawnSync('launchctl', ['bootstrap', domain, file], { encoding: 'utf8' })
  if (r.status !== 0) { console.error(`launchctl bootstrap failed: ${r.stderr}`); process.exit(1) }
  console.log(`registered ${repos.length} repo(s) in ${REGISTRY}${template ? `; ${repo} as a template` : ''}; nightly job ${LABEL} loaded (03:30)`)
}
