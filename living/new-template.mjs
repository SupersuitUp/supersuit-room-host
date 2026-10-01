#!/usr/bin/env node
// Make a new living template from the meta-template. The clone keeps the meta-template's
// history (it carries nothing personal, and shared history is what lets updates merge), and
// remembers the meta-template as `template`. Give it its own origin, then add the app on top
// as ordinary commits, with a `living:check` script in package.json.
//
//   node living/new-template.mjs <dir> [--from <meta-template url or path>]
import { existsSync } from 'node:fs'
import { resolve, dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { git } from './git.mjs'

const HERE = join(dirname(fileURLToPath(import.meta.url)), '..')

export function newTemplate({ from, dir }) {
  dir = resolve(dir)
  if (existsSync(dir)) throw new Error(`${dir} already exists`)
  git(dirname(dir), 'clone', '--quiet', from, dir)
  git(dir, 'remote', 'rename', 'origin', 'template')
  return { dir, template: from }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const args = process.argv.slice(2)
  const i = args.indexOf('--from')
  const from = i >= 0 ? args.splice(i, 2)[1] : git(HERE, 'remote', 'get-url', 'origin')
  if (!args[0]) { console.error('usage: new-template.mjs <dir> [--from <url>]'); process.exit(1) }
  const r = newTemplate({ from, dir: args[0] })
  console.log(`${r.dir}: new living template, listening to ${r.template}. Next: give it an origin, add the app, define living:check.`)
}
