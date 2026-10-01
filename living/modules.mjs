// Which dependencies are modules, and what to do about each one's newer versions. Pure: no git,
// no network, no package manager, so every rule here is a unit test.
//
// A module is a package the template declares in package.json `living.modules` (exact names or
// `@scope/*`), by default every `@supersuit/*` package. Peer dependencies are never modules: a
// template does not install what its packages expect the host to provide.
import { parseRange, satisfies, isStable, compare } from './semver.mjs'

export const DEFAULT_MODULES = ['@supersuit/*']
const FIELDS = ['dependencies', 'devDependencies', 'optionalDependencies']

const matches = (name, pattern) => (pattern.endsWith('/*') ? name.startsWith(pattern.slice(0, -1)) : name === pattern)

// Entries of living.modules that are not strings cannot name a package: declaredModules skips
// them, and this reports them so the bump can say so instead of throwing.
export const badModulePatterns = (pkg) => (Array.isArray(pkg?.living?.modules) ? pkg.living.modules.filter((p) => typeof p !== 'string') : [])

export function declaredModules(pkg) {
  const patterns = Array.isArray(pkg?.living?.modules) ? pkg.living.modules.filter((p) => typeof p === 'string') : DEFAULT_MODULES
  const out = []
  for (const field of FIELDS) {
    for (const [name, spec] of Object.entries(pkg?.[field] ?? {})) {
      if (patterns.some((p) => matches(name, p))) out.push({ name, field, spec })
    }
  }
  return out.sort((a, b) => a.name.localeCompare(b.name))
}

// For one module: the newest stable version inside the declared range is taken (and the range is
// raised to it); the newest stable version outside it is held for a person, unless allowMajor,
// which takes the newest of all through the same checked path. semver's compare and satisfies
// throw on invalid input, so a range that does not parse is skipped (reported, never a crash) and
// only stable, parseable versions ever reach them. Below 1.0 a minor is outside a ^ range, as in npm.
export function planModule(spec, versions, { allowMajor = false } = {}) {
  const range = parseRange(spec)
  if (!range || !isStable(range.base)) return { take: null, held: null, skip: 'unmanaged range' }
  // A registry may say v1.3.0; the range written into package.json must be ^1.3.0.
  const stable = (Array.isArray(versions) ? versions : []).filter((v) => typeof v === 'string' && isStable(v)).map((v) => v.trim().replace(/^v/, ''))
  const newer = stable.filter((v) => compare(v, range.base) > 0).sort(compare)
  const best = newer.filter((v) => satisfies(range, v)).at(-1) ?? null
  const top = newer.filter((v) => !satisfies(range, v)).at(-1) ?? null
  const take = (to) => ({ to, spec: `${range.op}${to}` })
  if (allowMajor) {
    const to = top ?? best
    return { take: to ? take(to) : null, held: null, skip: null }
  }
  return { take: best ? take(best) : null, held: top, skip: null }
}
