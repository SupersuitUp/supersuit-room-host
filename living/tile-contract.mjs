// THE TILE CONTRACT FOR EVERY SUPER APP made from this template: its notifications, generalized from
// the Us app's notify-coverage guard (2026-10-07), and since 2026-10-15 that every tile explains itself.
// Each app supplies its own declarations; this file only checks them. Rules and reasons: living/SUPER-APP.md.
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'

const REASONED = ['privateToOwner', 'noMemberWrites']

export function checkTileNews({ tiles, tileNews, kinds }) {
  const out = []
  for (const t of tiles) if (!(t in tileNews)) out.push(`tile "${t}" has no news decision: announce kinds, or say why it is private`)
  for (const t of Object.keys(tileNews)) if (!tiles.includes(t)) out.push(`news decision for "${t}", which is not a tile`)
  for (const [t, d] of Object.entries(tileNews)) {
    const why = REASONED.find((k) => k in d)
    if (why && !String(d[why] || '').trim()) out.push(`tile "${t}" is ${why} with no reason written down`)
    if (!why && !Array.isArray(d.announces)) out.push(`tile "${t}" neither announces nor gives a reason`)
  }
  const claimed = new Set(Object.values(tileNews).flatMap((d) => d.announces || []))
  for (const k of kinds) if (!claimed.has(k)) out.push(`news kind "${k}" belongs to no tile`)
  for (const k of claimed) if (!kinds.includes(k)) out.push(`tile announces "${k}", which is not a news kind`)
  return out
}

export function checkNewsLines({ kinds, lineFor, name }) {
  return kinds.filter((k) => !String(lineFor(k)).startsWith(`${name} `)).map((k) => `news kind "${k}" does not start with the person: "${lineFor(k)}"`)
}

// PRINCIPLE 13: every tile explains itself, and so does the app. Each tile declares its one-line
// purpose and an about: what it is for (the job it takes off a person's hands) and when to open it,
// which the app shows on the tile's About sheet and on its About page. The app has that About page,
// and the home links to it in code (a mention in a comment does not count).
const answered = (v, max) => typeof v === 'string' && v.trim().length > 0 && v.length <= max
export function checkTileAbout({ tiles, about, aboutHref, homeSource }) {
  const out = []
  for (const t of tiles) {
    const a = about[t]
    if (!a || typeof a !== 'object') { out.push(`tile "${t}" has no about: give it a purpose, what it is for, and when to open it`); continue }
    if (!answered(a.purpose, 140)) out.push(`tile "${t}" has no purpose: one line, at most 140 characters`)
    if (!answered(a.for, 300)) out.push(`tile "${t}" does not say what it is for: one or two sentences, at most 300 characters`)
    if (!answered(a.when, 300)) out.push(`tile "${t}" does not say when to open it: one or two sentences, at most 300 characters`)
  }
  for (const t of Object.keys(about)) if (!tiles.includes(t)) out.push(`about for "${t}", which is not a tile`)
  if (typeof aboutHref !== 'string' || !aboutHref.startsWith('/')) out.push('the app has no About page: name its path (aboutHref), which explains the app and lists every tile with its purpose')
  else {
    const code = stripCommentsAndStrings(String(homeSource ?? ''), { keepStrings: true })
    if (![`'${aboutHref}'`, `"${aboutHref}"`, `\`${aboutHref}\``].some((q) => code.includes(q))) out.push(`the home does not link to ${aboutHref}, the app's About page`)
  }
  return out
}

const WRITE_METHODS = new Set(['POST', 'PATCH', 'PUT'])

// Blank out comments and string/template literals, keeping newlines, so a word inside them can
// never look like code. Parser-free on purpose: a regex literal holding a quote can confuse it,
// which route files almost never contain. `keepStrings` blanks the comments only.
export function stripCommentsAndStrings(src, { keepStrings = false } = {}) {
  let out = '', i = 0
  const n = src.length
  const blank = (s) => s.replace(/[^\n]/g, ' ')
  while (i < n) {
    const c = src[i], d = src[i + 1]
    if (c === '/' && d === '/') {
      let j = src.indexOf('\n', i); if (j < 0) j = n
      out += blank(src.slice(i, j)); i = j
    } else if (c === '/' && d === '*') {
      let j = src.indexOf('*/', i + 2); j = j < 0 ? n : j + 2
      out += blank(src.slice(i, j)); i = j
    } else if (c === "'" || c === '"' || c === '`') {
      let j = i + 1
      while (j < n && src[j] !== c) j += src[j] === '\\' ? 2 : 1
      j = Math.min(j + 1, n)
      out += keepStrings ? src.slice(i, j) : c + blank(src.slice(i + 1, j - 1)) + c; i = j
    } else { out += c; i++ }
  }
  return out
}

// Does this route file export a POST, PATCH or PUT handler, in any shape Next.js accepts?
// function (async or not), const/let/var (arrow, call, typed), a destructured const, and
// `export { x as POST }` lists, with or without `from`.
export function isWriteRoute(src) {
  const code = stripCommentsAndStrings(src)
  const M = '(POST|PATCH|PUT)'
  if (new RegExp(`\\bexport\\s+(?:async\\s+)?function\\s*\\*?\\s*${M}\\b`).test(code)) return true
  if (new RegExp(`\\bexport\\s+(?:const|let|var)\\s+${M}\\b`).test(code)) return true
  if (new RegExp(`\\bexport\\s+(?:const|let|var)\\s*\\{[^}]*\\b${M}\\b`).test(code)) return true
  for (const [, list] of code.matchAll(/\bexport\s+(?:type\s+)?\{([^}]*)\}/g)) {
    for (const spec of list.split(',')) {
      const words = spec.trim().split(/\s+/) // `x`, `x as POST`, `type X`: the exported name is last
      if (words[0] !== 'type' && WRITE_METHODS.has(words[words.length - 1])) return true
    }
  }
  return false
}
const ANNOUNCE = /\bannounce[A-Z]\w*\(/

function routeFiles(dir) {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n)
    return statSync(p).isDirectory() ? routeFiles(p) : n === 'route.ts' ? [p] : []
  })
}

// The route, or a module it imports through one of `libDirs` (alias -> directory), announces.
// A lib whose path ends with an `ignoreLibs` suffix never counts: the module that DEFINES
// `announceX(` matches the pattern without calling anything.
function announcesThrough(file, libDirs, announce, ignoreLibs) {
  const src = readFileSync(file, 'utf8')
  if (announce.test(src)) return true
  for (const [, spec] of src.matchAll(/from '([^']+)'/g)) {
    for (const [alias, dir] of Object.entries(libDirs)) {
      if (!spec.startsWith(alias)) continue
      const base = join(dir, spec.slice(alias.length))
      const lib = [base + '.ts', base + '.mjs', join(base, 'index.ts')].find(existsSync)
      if (!lib || ignoreLibs.some((s) => lib.endsWith(s))) continue
      if (announce.test(readFileSync(lib, 'utf8'))) return true
    }
  }
  return false
}

export function checkRouteCoverage({ appDir, apiRoot, libDirs, tileForPath, tileNews, quietRoutes,
  announce = ANNOUNCE, exempt = (p) => p.endsWith('/upload-url'), ignoreLibs = [] }) {
  const apiPath = (f) => '/' + dirname(f).slice(appDir.length + 1)
  const checked = routeFiles(apiRoot).filter((f) => isWriteRoute(readFileSync(f, 'utf8')))
  const paths = checked.map(apiPath)
  const silent = checked.filter((f) => {
    const p = apiPath(f), t = tileForPath(p)
    if (!t || !tileNews[t] || !tileNews[t].announces) return false
    if (exempt(p) || p in quietRoutes) return false
    return !announcesThrough(f, libDirs, announce, ignoreLibs)
  }).map(apiPath)
  const stale = Object.keys(quietRoutes).filter((p) => !paths.includes(p))
  return { checked: paths, silent, stale }
}
