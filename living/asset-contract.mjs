#!/usr/bin/env node
// THE ASSET CONTRACT: every upload is findable. A file under src/ that writes uploaded media
// must index it with @supersuit/asset-index, or say in a comment why not. Rules: living/ASSETS.md.
//
//   node living/asset-contract.mjs [--repo <path>]    exit 1 and list problems, 0 when none, 2 on bad args
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join, resolve, dirname, relative, sep } from 'node:path'
import { pathToFileURL } from 'node:url'
import { cliArgs } from './cli.mjs'

const PKG = '@supersuit/asset-index'
const EXTS = ['.ts', '.tsx', '.js', '.mjs']
const SKIP_DIR = new Set(['node_modules', '__fixtures__'])
const TEST_FILE = /\.(test|spec)\.[^/]+$/
const PKG_IMPORT = /['"]@supersuit\/asset-index(\/[^'"]*)?['"]/
const EXEMPT = /asset-index:\s*exempt\b([^\n]*)/g
const LOOKAHEAD = 10

function walk(dir) {
  if (!existsSync(dir)) return []
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n)
    if (statSync(p).isDirectory()) return SKIP_DIR.has(n) ? [] : walk(p)
    return TEST_FILE.test(n) ? [] : [p]
  })
}

function writesMedia(src) {
  const lines = src.split('\n')
  return lines.some((l, i) => {
    if (/\.(save|createWriteStream)\(/.test(l) && /file\(/.test(l)) return true
    if (!/getSignedUrl\(/.test(l)) return false
    return /action\s*:\s*['"]write['"]/.test(lines.slice(i, i + LOOKAHEAD).join('\n'))
  })
}

function exempt(src) {
  return [...src.matchAll(EXEMPT)].some((m) => m[1].replace(/\*\/\s*$/, '').trim() !== '')
}

function resolveRelative(from, spec) {
  const base = resolve(dirname(from), spec)
  const tries = [base, ...EXTS.map((e) => base + e), ...EXTS.map((e) => join(base, 'index' + e))]
  return tries.find((p) => existsSync(p) && statSync(p).isFile())
}

function importsPackageViaOneHop(file, src) {
  for (const m of src.matchAll(/(?:from|import)\s*\(?\s*['"](\.[^'"]*)['"]/g)) {
    const target = resolveRelative(file, m[1])
    if (target && PKG_IMPORT.test(readFileSync(target, 'utf8'))) return true
  }
  return false
}

export function checkAssetIndexing({ repo }) {
  const root = resolve(repo)
  const rel = (p) => relative(root, p).split(sep).join('/')
  const problems = []
  const writers = [] // { file, kind: 'import' | 'hop' | 'exempt' | 'none' }
  for (const file of walk(join(root, 'src'))) {
    if (!EXTS.includes(file.slice(file.lastIndexOf('.')))) continue
    const src = readFileSync(file, 'utf8')
    if (!writesMedia(src)) continue
    const kind = PKG_IMPORT.test(src) ? 'import' : exempt(src) ? 'exempt' : importsPackageViaOneHop(file, src) ? 'hop' : 'none'
    writers.push({ file, kind })
    if (kind === 'none') problems.push(`${rel(file)}: writes uploaded media but never reaches ${PKG} (import it, import a module that does, or add "asset-index: exempt <reason>")`)
  }
  if (writers.some((w) => w.kind !== 'exempt')) {
    let deps = {}
    try { const j = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')); deps = j.dependencies || {} } catch {}
    if (!(PKG in deps)) problems.push(`package.json: ${PKG} is not in dependencies, and uploads are written under src/`)
  }
  return { ok: problems.length === 0, problems }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const usage = 'usage: node living/asset-contract.mjs [--repo <path>]'
  const { values } = cliArgs(process.argv.slice(2), usage, { value: ['--repo'] })
  const { ok, problems } = checkAssetIndexing({ repo: values['--repo'] ?? process.cwd() })
  for (const p of problems) console.log(p)
  if (!ok) { console.error(`${problems.length} asset problem(s). See living/ASSETS.md.`); process.exit(1) }
  console.log('every upload is findable')
}
