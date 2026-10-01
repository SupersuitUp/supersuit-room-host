#!/usr/bin/env node
// Make a tailored app from a living template. The clone remembers the template as `template`
// and starts with the template's sample tailor/, which the person tailoring it rewrites. The
// app's private words (names, addresses, domains) go into its own tailor/private-words.txt,
// and their fingerprints into the TEMPLATE's tailor/forbidden.sha256, as a commit in the
// template checkout, so the template can never pick them up. Push that commit with the template.
//
//   node living/new-app.mjs <dir> --from <template url or path> [--template-checkout <path>] [--word <w>]...
import { existsSync, writeFileSync } from 'node:fs'
import { resolve, dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { git } from './git.mjs'
import { addForbidden, scan } from './private-words.mjs'

export function newApp({ from, dir, privateWords = [], templateCheckout = null }) {
  dir = resolve(dir)
  if (existsSync(dir)) throw new Error(`${dir} already exists`)
  git(dirname(dir), 'clone', '--quiet', from, dir)
  git(dir, 'remote', 'rename', 'origin', 'template')

  if (privateWords.length) {
    writeFileSync(join(dir, 'tailor/private-words.txt'), privateWords.join('\n') + '\n')
    git(dir, 'add', '--', 'tailor/private-words.txt')
    git(dir, 'commit', '--quiet', '-m', 'tailor: this app\'s private words', '--', 'tailor/private-words.txt')
  }

  let templateHits = []
  if (templateCheckout && privateWords.length) {
    if (addForbidden(templateCheckout, privateWords) > 0) {
      git(templateCheckout, 'add', '--', 'tailor/forbidden.sha256')
      git(templateCheckout, 'commit', '--quiet', '-m', 'tailor: forbid a new app\'s private words', '--', 'tailor/forbidden.sha256')
    }
    templateHits = scan(templateCheckout)
  }
  return { dir, template: from, templateHits }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const args = process.argv.slice(2)
  const take = (name) => { const out = []; let i; while ((i = args.indexOf(name)) >= 0) out.push(args.splice(i, 2)[1]); return out }
  const [from] = take('--from'); const [templateCheckout] = take('--template-checkout'); const words = take('--word')
  if (!args[0] || !from) { console.error('usage: new-app.mjs <dir> --from <url> [--template-checkout <path>] [--word <w>]...'); process.exit(1) }
  const r = newApp({ from, dir: args[0], privateWords: words, templateCheckout })
  console.log(`${r.dir}: new tailored app, listening to ${r.template}. Next: rewrite tailor/, give it an origin, follow the template's TAILORING.md.`)
  if (r.templateHits.length) {
    for (const h of r.templateHits) console.log(`  the template already contains one of this app's private words at ${h.file}:${h.line}`)
    process.exit(2)
  }
}
