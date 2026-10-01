// Just enough semver for the module bump: plain X.Y.Z versions and the three range forms a
// template should declare a module with (^, ~, exact). Any other range is not the framework's to
// move, so parseRange returns null for it and the bump skips that dependency.
const VERSION = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/

export function parse(v) {
  const m = VERSION.exec(String(v).trim())
  return m ? { major: +m[1], minor: +m[2], patch: +m[3], pre: m[4] ?? null } : null
}

export const isStable = (v) => { const p = parse(v); return !!p && p.pre === null }

export function compare(a, b) {
  const x = parse(a), y = parse(b)
  for (const k of ['major', 'minor', 'patch']) if (x[k] !== y[k]) return x[k] < y[k] ? -1 : 1
  if (x.pre === y.pre) return 0
  if (x.pre === null) return 1
  if (y.pre === null) return -1
  return x.pre < y.pre ? -1 : 1
}

// '^1.2.3' -> { op: '^', base: '1.2.3' }; anything the bump does not manage -> null
export function parseRange(spec) {
  const m = /^([\^~]?)(\d+\.\d+\.\d+)$/.exec(String(spec).trim())
  return m ? { op: m[1], base: m[2] } : null
}

export function satisfies(range, v) {
  const b = parse(range.base), x = parse(v)
  if (!b || !x || x.pre !== null || compare(v, range.base) < 0) return false
  if (range.op === '') return compare(v, range.base) === 0
  if (range.op === '~') return x.major === b.major && x.minor === b.minor
  // ^ fixes the left-most non-zero part, as npm does: ^0.1.2 allows 0.1.x and nothing above.
  if (b.major > 0) return x.major === b.major
  if (b.minor > 0) return x.major === 0 && x.minor === b.minor
  return x.major === 0 && x.minor === 0 && x.patch === b.patch
}
