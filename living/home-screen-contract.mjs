#!/usr/bin/env node
// THE HOME-SCREEN CONTRACT. Every app made from this family is saved to a phone's home screen,
// where there is no browser back button and iOS zooms the page into any field under 16px. So:
// every screen below the home renders the app's Back control, that control stays in reach
// mid-page (pinned, or floated in when the screen is scrolled back up), and no input, textarea or
// select ever renders below 16px. Static checks, no parser and no dependencies. Rules: living/SUPER-APP.md.
//
//   node living/home-screen-contract.mjs [--repo <path>] [--config <file>]
//   exit 0 clean, 1 problems, 2 bad arguments or an unreadable config
//   config (default <repo>/home-screen.json, optional):
//     { "home": ["/"], "back": "Back", "backFile": "src/app/components/back.tsx",
//       "exempt": { "/route": "why it has no Back" },
//       "appDir": "src/app", "globalCss": "src/app/globals.css", "depth": 2 }
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join, resolve, dirname, relative, sep } from 'node:path'
import { pathToFileURL } from 'node:url'
import { cliArgs } from './cli.mjs'

const MIN_PX = 16
const FIELDS = ['input', 'textarea', 'select']
const PAGE = /^page\.(tsx|ts|jsx|js|mdx)$/
const CODE_EXTS = ['.tsx', '.ts', '.jsx', '.js', '.mjs']
const SKIP_DIR = new Set(['node_modules', '.next', '__fixtures__'])
const TEST_FILE = /\.(test|spec)\.[^/]+$/
// Inputs that never take typed text, so iOS never zooms into them.
const NO_TEXT_TYPES = new Set(['checkbox', 'radio', 'range', 'file', 'hidden', 'submit', 'button', 'color', 'image', 'reset'])
const TW_SIZE = { xs: 12, sm: 14 }

// Blank comments and string literals, keeping length and newlines, so a word inside them never
// looks like code. Single and double quotes end at the line: an apostrophe in JSX text ("don't")
// is not a string, so an unclosed one on its line is left as a character.
export function blankNonCode(src) {
  let out = '', i = 0
  const n = src.length
  const blank = (s) => s.replace(/[^\n]/g, ' ')
  while (i < n) {
    const c = src[i], d = src[i + 1]
    if (c === '/' && d === '/' && src[i - 1] !== ':') {
      let j = src.indexOf('\n', i); if (j < 0) j = n
      out += blank(src.slice(i, j)); i = j
    } else if (c === '/' && d === '*') {
      let j = src.indexOf('*/', i + 2); j = j < 0 ? n : j + 2
      out += blank(src.slice(i, j)); i = j
    } else if (c === '`') {
      let j = i + 1
      while (j < n && src[j] !== '`') j += src[j] === '\\' ? 2 : 1
      j = Math.min(j + 1, n)
      out += c + blank(src.slice(i + 1, j - 1)) + (j - 1 > i ? src[j - 1] : ''); i = j
    } else if (c === "'" || c === '"') {
      let j = i + 1
      while (j < n && src[j] !== c && src[j] !== '\n') j += src[j] === '\\' ? 2 : 1
      if (j < n && src[j] === c) { out += c + blank(src.slice(i + 1, j)) + c; i = j + 1 }
      else { out += c; i++ }
    } else { out += c; i++ }
  }
  return out
}

function walk(dir, keep) {
  if (!existsSync(dir)) return []
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n)
    if (statSync(p).isDirectory()) return SKIP_DIR.has(n) ? [] : walk(p, keep)
    return keep(n, p) ? [p] : []
  })
}

// The URL a page file serves: its folder path under the app directory, with route groups
// `(name)` and parallel slots `@name` removed.
export function routeOf(appDir, file) {
  const segs = relative(appDir, dirname(file)).split(sep).filter((s) => s && !/^\(.*\)$/.test(s) && !s.startsWith('@'))
  return '/' + segs.join('/')
}

function resolveImport(from, spec, aliases) {
  let base = null
  if (spec.startsWith('.')) base = resolve(dirname(from), spec)
  else for (const [alias, dir] of Object.entries(aliases)) if (spec.startsWith(alias)) { base = join(dir, spec.slice(alias.length)); break }
  if (!base) return null
  const tries = [base, ...CODE_EXTS.map((e) => base + e), ...CODE_EXTS.map((e) => join(base, 'index' + e))]
  return tries.find((p) => existsSync(p) && statSync(p).isFile()) ?? null
}

function rendersBack(file, back, aliases, depth, seen = new Set()) {
  if (seen.has(file)) return false
  seen.add(file)
  const src = readFileSync(file, 'utf8')
  if (new RegExp(`<${back}(?=[\\s/>])`).test(blankNonCode(src))) return true
  if (depth <= 0) return false
  for (const [, spec] of src.matchAll(/\bfrom\s*['"]([^'"]+)['"]/g)) {
    const target = resolveImport(file, spec, aliases)
    if (target && rendersBack(target, back, aliases, depth - 1, seen)) return true
  }
  return false
}

export function checkBackControls({ repo, appDir = join(repo, 'src/app'), home = ['/'], back = 'Back', exempt = {},
  aliases = { '@/': join(repo, 'src/') }, depth = 2 }) {
  const rel = (p) => relative(repo, p).split(sep).join('/')
  const pages = walk(appDir, (n, p) => PAGE.test(n) && !relative(appDir, p).split(sep).some((s) => s.startsWith('_')))
  const problems = [], missing = [], exempted = [], checked = []
  const routes = new Set()
  for (const file of pages) {
    const route = routeOf(appDir, file)
    routes.add(route)
    if (home.includes(route)) continue
    checked.push(route)
    if (route in exempt) {
      const why = String(exempt[route] ?? '').trim()
      if (why) exempted.push([route, why])
      else problems.push(`${rel(file)}: the screen ${route} is exempt from Back with no reason written down`)
      continue
    }
    if (rendersBack(file, back, aliases, depth)) continue
    missing.push({ route, file: rel(file) })
    problems.push(`${rel(file)}: the screen ${route} has no Back control, so on a home-screen app there is no way out of it. Render <${back} href="<its parent>" /> at the top, or exempt it in home-screen.json with the reason`)
  }
  const stale = Object.keys(exempt).filter((r) => !routes.has(r))
  for (const r of stale) problems.push(`home-screen.json: ${r} is exempt from Back, but there is no screen at ${r}`)
  return { checked, missing, exempted, stale, problems }
}

// Every <input>, <textarea> and <select> opening tag in a source file, with its attribute text
// (read from the original, so class strings survive) and the line it starts on.
export function tagsIn(src) {
  const code = blankNonCode(src)
  const out = []
  for (const m of code.matchAll(/<(input|textarea|select)(?=[\s/>])/g)) {
    let i = m.index + m[0].length, depth = 0, q = null
    const start = i
    for (; i < src.length; i++) {
      const c = src[i]
      if (q) { if (c === '\\') i++; else if (c === q) q = null; continue }
      if (c === '"' || c === "'" || c === '`') { q = c; continue }
      if (c === '{') depth++
      else if (c === '}') depth--
      else if (c === '>' && depth === 0) break
    }
    out.push({ tag: m[1], attrs: src.slice(start, i), line: src.slice(0, m.index).split('\n').length })
  }
  return out
}

function px(value, unit) {
  const v = parseFloat(value)
  return unit === 'rem' || unit === 'em' ? v * 16 : v
}

// The font sizes under 16px an element's attributes set, in words. Empty when none.
function smallSizes(attrs) {
  const found = []
  for (const tok of attrs.split(/[\s"'`{}]+/)) {
    const m = tok.match(/^(?:[\w\-[\]&:]+:)?!?text-(xs|sm|\[(\d*\.?\d+)(px|rem|em)\])!?$/)
    if (!m) continue
    const size = m[1] in TW_SIZE ? TW_SIZE[m[1]] : px(m[2], m[3])
    if (size < MIN_PX) found.push(`${tok} (${size}px)`)
  }
  for (const m of attrs.matchAll(/fontSize\s*:\s*(?:(\d*\.?\d+)(?![\d.]*\s*['"`])|['"`](\d*\.?\d+)(px|rem|em)['"`])/g)) {
    const size = m[1] !== undefined ? parseFloat(m[1]) : px(m[2], m[3])
    if (size < MIN_PX) found.push(`fontSize ${size}px`)
  }
  return found
}

function cssRules(css) {
  const clean = css.replace(/\/\*[\s\S]*?\*\//g, (s) => s.replace(/[^\n]/g, ' '))
  return [...clean.matchAll(/([^{};]+)\{([^{}]*)\}/g)].map((m) => ({
    selectors: m[1].split(',').map((s) => s.trim()).filter(Boolean),
    body: m[2],
    line: clean.slice(0, m.index + m[0].length - m[0].trimStart().length).split('\n').length,
  }))
}

// font-size in px, or null when it is not a length this can read (inherit, a var, a calc).
function cssFontSize(body) {
  const m = body.match(/(?:^|;|\s)font-size\s*:\s*([^;]+)/)
  if (!m) return undefined
  const v = m[1].replace(/!important/, '').trim()
  const sizes = [...v.matchAll(/(\d*\.?\d+)(px|rem|em)\b/g)].map((s) => px(s[1], s[2]))
  if (!sizes.length) return null
  return v.startsWith('max(') ? Math.max(...sizes) : v.startsWith('min(') ? Math.min(...sizes) : sizes[0]
}

const lastCompound = (sel) => sel.split(/[\s>+~]+/).filter(Boolean).pop() ?? ''
const fieldOf = (compound) => FIELDS.find((f) => new RegExp(`^${f}(?=$|[.:#\\[])`).test(compound))

export function checkInputFontSizes({ repo, globalCss = 'src/app/globals.css', srcDir = 'src' }) {
  const root = resolve(repo)
  const rel = (p) => relative(root, p).split(sep).join('/')
  const problems = []
  const globalPath = join(root, globalCss)
  if (!existsSync(globalPath)) {
    problems.push(`${globalCss}: missing, so nothing sets input, textarea and select to 16px and iOS zooms into them`)
  } else {
    const rules = cssRules(readFileSync(globalPath, 'utf8'))
    for (const f of FIELDS) {
      const ok = rules.some((r) => r.selectors.some((s) => fieldOf(s) === f && !/[\s>+~]/.test(s)) && (cssFontSize(r.body) ?? 0) >= MIN_PX)
      if (!ok) problems.push(`${globalCss}: ${f} is never given a font-size of at least ${MIN_PX}px, so iOS zooms the page when one is focused. Add "input, textarea, select { font-size: ${MIN_PX}px }"`)
    }
  }
  const smallClasses = new Map() // a class whose own rule sets under 16px -> that size
  for (const file of walk(join(root, srcDir), (n) => n.endsWith('.css'))) {
    for (const r of cssRules(readFileSync(file, 'utf8'))) {
      const size = cssFontSize(r.body)
      if (size == null || size >= MIN_PX) continue
      const hit = r.selectors.filter((s) => fieldOf(lastCompound(s)))
      if (hit.length) problems.push(`${rel(file)}:${r.line}: "${hit.join(', ')}" sets font-size ${size}px, under ${MIN_PX}px, so iOS zooms when it is focused`)
      for (const s of r.selectors) {
        const m = lastCompound(s).match(/^\.([\w-]+)(?:$|:)/)
        if (m) smallClasses.set(m[1], size)
      }
    }
  }
  for (const file of walk(join(root, srcDir), (n) => CODE_EXTS.some((e) => n.endsWith(e)) && !TEST_FILE.test(n))) {
    const src = readFileSync(file, 'utf8')
    // Class strings kept in a constant in the same file: `const FIELD = '... text-sm'`.
    const consts = new Map([...src.matchAll(/\bconst\s+([A-Za-z_$][\w$]*)\s*=\s*(['"`])([^'"`\n]*)\2/g)].map((m) => [m[1], m[3]]))
    for (const t of tagsIn(src)) {
      const type = t.attrs.match(/\btype\s*=\s*["']([\w-]+)["']/)?.[1]
      if (t.tag === 'input' && type && NO_TEXT_TYPES.has(type)) continue
      const named = [...t.attrs.matchAll(/[A-Za-z_$][\w$]*/g)].map((m) => consts.get(m[0])).filter((v) => v !== undefined)
      const attrs = [t.attrs, ...named].join(' ')
      const small = smallSizes(attrs)
      for (const tok of new Set(attrs.split(/[\s"'`{}]+/))) if (smallClasses.has(tok)) small.push(`class ${tok} (${smallClasses.get(tok)}px)`)
      if (small.length) problems.push(`${rel(file)}:${t.line}: ${t.tag === 'input' ? 'an' : 'a'} ${t.tag} is ${small.join(' and ')}, under ${MIN_PX}px, so iOS zooms when it is focused. Use text-base or larger and keep the look with the layout around it`)
    }
  }
  return { problems }
}

// Line and block comments removed, strings kept: the class names this reads live in strings.
function withoutComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:'"`])\/\/[^\n]*/g, '$1')
}

// A Back drawn once at the top of a long screen scrolls away with it, and the only way to it is
// scrolling all the way back up (asked for 2026-10-12). So the Back component has to draw itself
// in a layer that does not scroll away: a bar pinned to the top (`sticky`), or a copy floated in
// when the screen is scrolled back up (`fixed`). Either class in the component's own file is the
// evidence; which of the two, and when it shows, is the app's to decide and its own tests' to prove.
export function checkBackReach({ repo, backFile = 'src/app/components/back.tsx', back = 'Back' }) {
  const file = join(repo, backFile)
  if (!existsSync(file)) {
    return { problems: [`${backFile}: no such file, so nothing shows that <${back}> stays in reach mid-page. Keep the Back component there, or name its file as "backFile" in home-screen.json`] }
  }
  if (/\b(sticky|fixed)\b/.test(withoutComments(readFileSync(file, 'utf8')))) return { problems: [] }
  return { problems: [`${backFile}: <${back}> is drawn only where it sits, so on a long screen it scrolls away and the way out is all the way back at the top. Pin it (a "sticky" bar), or float a copy when the screen is scrolled back up (a "fixed" link): see living/SUPER-APP.md rule 10`] }
}

export function checkHomeScreen({ repo, appDir = 'src/app', home, back, backFile, exempt, globalCss, depth }) {
  const root = resolve(repo)
  const b = checkBackControls({ repo: root, appDir: join(root, appDir), home, back, exempt, depth })
  const f = checkInputFontSizes({ repo: root, globalCss })
  const r = checkBackReach({ repo: root, backFile, back })
  const problems = [...b.problems, ...r.problems, ...f.problems]
  return { ok: problems.length === 0, problems, exempted: b.exempted, checked: b.checked }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const usage = 'usage: node living/home-screen-contract.mjs [--repo <path>] [--config <file>]'
  const { values } = cliArgs(process.argv.slice(2), usage, { value: ['--repo', '--config'] })
  const repo = resolve(values['--repo'] ?? process.cwd())
  const configPath = values['--config'] ? resolve(values['--config']) : join(repo, 'home-screen.json')
  let config = {}
  if (existsSync(configPath)) {
    try { config = JSON.parse(readFileSync(configPath, 'utf8')) } catch (e) { console.error(`${configPath}: not readable JSON (${e.message})`); process.exit(2) }
  } else if (values['--config']) { console.error(`${configPath}: no such file`); process.exit(2) }
  const r = checkHomeScreen({ repo, ...config })
  for (const p of r.problems) console.log(p)
  for (const [route, why] of r.exempted) console.log(`exempt ${route}: ${why}`)
  if (!r.ok) { console.error(`${r.problems.length} home-screen problem(s). See living/SUPER-APP.md.`); process.exit(1) }
  console.log(`home-screen contract holds: ${r.checked.length} screen(s) below the home have Back or a reason, Back stays in reach mid-page, and no field is under ${MIN_PX}px`)
}
