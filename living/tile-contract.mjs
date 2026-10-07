// THE NOTIFICATION CONTRACT FOR EVERY TILE IN EVERY SUPER APP made from this template. Generalized
// from the Us app's notify-coverage guard (2026-10-07). Each app supplies its own declarations; this
// file only checks them. Rules and reasons: living/SUPER-APP.md.
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

const WRITES = /export async function (POST|PATCH|PUT)\b|export const \{[^}]*\b(POST|PATCH|PUT)\b/
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
  const checked = routeFiles(apiRoot).filter((f) => WRITES.test(readFileSync(f, 'utf8')))
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
