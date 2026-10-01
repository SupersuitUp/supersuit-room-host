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
import { cliArgs } from './cli.mjs'

const HERE = join(dirname(fileURLToPath(import.meta.url)), '..')

export function newTemplate({ from, dir }) {
  dir = resolve(dir)
  if (existsSync(dir)) throw new Error(`${dir} already exists`)
  git(dirname(dir), 'clone', '--quiet', from, dir)
  git(dir, 'remote', 'rename', 'origin', 'template')
  return { dir, template: from }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const USAGE = 'usage: new-template.mjs <dir> [--from <meta-template url or path>]\n       new-template.mjs -h | --help'
  const { positionals: [dir], values } = cliArgs(process.argv.slice(2), USAGE, { value: ['--from'], positionals: 1 })
  if (!dir) { console.error(USAGE); process.exit(1) }
  const from = values['--from'] ?? git(HERE, 'remote', 'get-url', 'origin')
  const r = newTemplate({ from, dir })
  console.log(`${r.dir}: new living template, listening to ${r.template}. Next: give it an origin, add the app, define living:check.`)
}
