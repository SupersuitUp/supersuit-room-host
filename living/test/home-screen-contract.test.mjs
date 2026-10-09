import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { checkBackControls, checkInputFontSizes, checkHomeScreen, routeOf, tagsIn } from '../home-screen-contract.mjs'

const CLI = join(dirname(fileURLToPath(import.meta.url)), '..', 'home-screen-contract.mjs')
const GLOBAL_OK = '@import "tailwindcss";\n@layer base {\n  input, textarea, select { font-size: 16px; }\n}\n'
const BACK = "import Link from 'next/link'\nexport function Back({ href }: { href: string }) { return <Link href={href}>‹ Back</Link> }\n"

function withRepo(files, fn) {
  const root = mkdtempSync(join(tmpdir(), 'home-screen-'))
  for (const [p, s] of Object.entries(files)) {
    mkdirSync(dirname(join(root, p)), { recursive: true })
    writeFileSync(join(root, p), s)
  }
  try { return fn(root) } finally { rmSync(root, { recursive: true, force: true }) }
}

const BASE = {
  'src/app/globals.css': GLOBAL_OK,
  'src/app/components/back.tsx': BACK,
  'src/app/page.tsx': 'export default function Home() { return <main>home</main> }\n',
}

test('a route is the folder path, without route groups, private folders or the src/app prefix', () => {
  assert.equal(routeOf('/r/src/app', '/r/src/app/page.tsx'), '/')
  assert.equal(routeOf('/r/src/app', '/r/src/app/notes/[id]/page.tsx'), '/notes/[id]')
  assert.equal(routeOf('/r/src/app', '/r/src/app/(signed-in)/notes/page.tsx'), '/notes')
})

test('every screen below the home renders Back; the home itself does not need to', () => withRepo({
  ...BASE,
  'src/app/notes/page.tsx': "import { Back } from '../components/back'\nexport default function P() { return <main><Back href=\"/\" /></main> }\n",
  'src/app/notes/[id]/page.tsx': 'export default function P() { return <main>no way out</main> }\n',
}, (r) => {
  const res = checkBackControls({ appDir: join(r, 'src/app'), repo: r })
  assert.deepEqual(res.checked.sort(), ['/notes', '/notes/[id]'])
  assert.equal(res.missing.length, 1)
  assert.match(res.problems[0], /src\/app\/notes\/\[id\]\/page\.tsx/)
  assert.match(res.problems[0], /Back/)
}))

test('Back rendered by a module the page imports counts, through the @/ alias too, two hops deep', () => withRepo({
  ...BASE,
  'src/app/notes/page.tsx': "import { NotesScreen } from './screen'\nexport default function P() { return <NotesScreen /> }\n",
  'src/app/notes/screen.tsx': "import { Frame } from '@/app/components/frame'\nexport function NotesScreen() { return <Frame /> }\n",
  'src/app/components/frame.tsx': "import { Back } from './back'\nexport function Frame() { return <div><Back href=\"/\" /></div> }\n",
}, (r) => {
  const res = checkBackControls({ appDir: join(r, 'src/app'), repo: r })
  assert.deepEqual(res.problems, [])
}))

test('three hops is too deep to count, so the screen is reported', () => withRepo({
  ...BASE,
  'src/app/notes/page.tsx': "import { A } from './a'\nexport default function P() { return <A /> }\n",
  'src/app/notes/a.tsx': "import { B } from './b'\nexport function A() { return <B /> }\n",
  'src/app/notes/b.tsx': "import { C } from './c'\nexport function B() { return <C /> }\n",
  'src/app/notes/c.tsx': "import { Back } from '../components/back'\nexport function C() { return <Back href=\"/\" /> }\n",
}, (r) => {
  assert.equal(checkBackControls({ appDir: join(r, 'src/app'), repo: r }).missing.length, 1)
}))

test('a Back mentioned only in a comment or a string does not count', () => withRepo({
  ...BASE,
  'src/app/notes/page.tsx': "// TODO: <Back href=\"/\" />\nexport default function P() { return <main>{'<Back href=\"/\" />'}</main> }\n",
}, (r) => {
  assert.equal(checkBackControls({ appDir: join(r, 'src/app'), repo: r }).missing.length, 1)
}))

test('a longer component name is not Back', () => withRepo({
  ...BASE,
  'src/app/notes/page.tsx': 'export default function P() { return <BackRow /> }\n',
}, (r) => {
  assert.equal(checkBackControls({ appDir: join(r, 'src/app'), repo: r }).missing.length, 1)
  assert.equal(checkBackControls({ appDir: join(r, 'src/app'), repo: r, back: 'BackRow' }).missing.length, 0)
}))

test('an exempt screen passes only with a written reason, and an exemption for no screen is stale', () => withRepo({
  ...BASE,
  'src/app/join/page.tsx': 'export default function P() { return <main>join</main> }\n',
  'src/app/pair/page.tsx': 'export default function P() { return <main>pair</main> }\n',
}, (r) => {
  const res = checkBackControls({ appDir: join(r, 'src/app'), repo: r, exempt: { '/join': 'entry from an invite link; nothing to go back to', '/pair': '  ', '/gone': 'old' } })
  assert.deepEqual(res.exempted, [['/join', 'entry from an invite link; nothing to go back to']])
  assert.equal(res.problems.length, 2)
  assert.ok(res.problems.some((p) => /\/pair/.test(p) && /reason/.test(p)))
  assert.ok(res.problems.some((p) => /\/gone/.test(p) && /no screen/.test(p)))
}))

test('the home can be a different route, and more than one', () => withRepo({
  ...BASE,
  'src/app/app/page.tsx': 'export default function P() { return <main>app home</main> }\n',
}, (r) => {
  assert.equal(checkBackControls({ appDir: join(r, 'src/app'), repo: r }).missing.length, 1)
  assert.equal(checkBackControls({ appDir: join(r, 'src/app'), repo: r, home: ['/', '/app'] }).missing.length, 0)
}))

test('tagsIn finds every input, textarea and select with its attributes, across lines and braces', () => {
  const src = 'const a = <input\n  className="text-sm"\n  onChange={(e) => set(e.target.value > 1)}\n/>\nconst b = <textarea rows={3}></textarea>\nconst c = <selection />\n'
  const tags = tagsIn(src)
  assert.deepEqual(tags.map((t) => [t.tag, t.line]), [['input', 1], ['textarea', 5]])
  assert.match(tags[0].attrs, /text-sm/)
})

test('the global stylesheet must set at least 16px on input, textarea and select', () => {
  for (const css of [GLOBAL_OK, 'input,textarea,select{font-size:1rem}', 'input, textarea, select { font-size: max(16px, 1em) !important }', 'input { font-size: 17px }\ntextarea, select { font-size: 16px }']) {
    withRepo({ 'src/app/globals.css': css }, (r) => assert.deepEqual(checkInputFontSizes({ repo: r }).problems, [], css))
  }
  withRepo({ 'src/app/globals.css': 'input, textarea { font-size: 16px }' }, (r) => {
    const p = checkInputFontSizes({ repo: r }).problems
    assert.equal(p.length, 1)
    assert.match(p[0], /src\/app\/globals\.css.*select/)
  })
  for (const css of ['input, textarea, select { font-size: 15px }', 'input, textarea, select { font-size: 0.875rem }']) {
    withRepo({ 'src/app/globals.css': css }, (r) => {
      const p = checkInputFontSizes({ repo: r }).problems
      for (const f of ['input', 'textarea', 'select']) assert.ok(p.some((x) => x.includes(`: ${f} is never`)), `${css}: ${f}`)
    })
  }
  withRepo({}, (r) => assert.match(checkInputFontSizes({ repo: r }).problems[0], /globals\.css/))
})

test('a component that makes an input smaller than 16px is named with its file and line', () => withRepo({
  'src/app/globals.css': GLOBAL_OK,
  'src/app/a.tsx': 'export const A = () => <div>\n<input className="w-full text-sm" />\n</div>\n',
  'src/app/b.tsx': 'export const B = () => <textarea className={`p-2 ${x} text-xs`} />\n',
  'src/app/c.tsx': 'export const C = () => <select className="sm:text-[15px]" />\n',
  'src/app/d.tsx': "export const D = () => <input style={{ fontSize: 14 }} />\n",
  'src/app/e.tsx': "export const E = () => <input style={{ fontSize: '0.8rem' }} />\n",
}, (r) => {
  const p = checkInputFontSizes({ repo: r }).problems
  assert.equal(p.length, 5, p.join('\n'))
  assert.ok(p.some((x) => x.startsWith('src/app/a.tsx:2') && /text-sm/.test(x)))
  assert.ok(p.some((x) => x.startsWith('src/app/b.tsx:1') && /text-xs/.test(x)))
  assert.ok(p.some((x) => x.startsWith('src/app/c.tsx:1')))
  assert.ok(p.some((x) => x.startsWith('src/app/d.tsx:1')))
  assert.ok(p.some((x) => x.startsWith('src/app/e.tsx:1')))
}))

test('16px and up, non-text inputs, tests and other elements are left alone', () => withRepo({
  'src/app/globals.css': GLOBAL_OK,
  'src/app/a.tsx': [
    'export const A = () => <div>',
    '<input className="text-base" />',
    '<input className="text-[16px]" style={{ fontSize: 18 }} />',
    '<input type="checkbox" className="text-sm" />',
    '<input type="range" className="text-xs" />',
    '<label className="text-sm">x</label>',
    '<span className="text-sm">{"<input className=\\"text-sm\\" />"}</span>',
    '</div>',
  ].join('\n'),
  'src/app/a.test.tsx': 'const x = <input className="text-sm" />\n',
}, (r) => {
  assert.deepEqual(checkInputFontSizes({ repo: r }).problems, [])
}))

test('a stylesheet rule that shrinks an input is named too', () => withRepo({
  'src/app/globals.css': GLOBAL_OK + '.composer textarea { font-size: 14px }\n',
}, (r) => {
  const p = checkInputFontSizes({ repo: r }).problems
  assert.equal(p.length, 1)
  assert.match(p[0], /globals\.css.*\.composer textarea.*14px/)
}))

test('checkHomeScreen joins both checks and the CLI reads home-screen.json', () => withRepo({
  ...BASE,
  'src/app/notes/page.tsx': 'export default function P() { return <main /> }\n',
  'src/app/join/page.tsx': 'export default function P() { return <main /> }\n',
  'src/app/a.tsx': 'export const A = () => <input className="text-sm" />\n',
  'home-screen.json': JSON.stringify({ exempt: { '/join': 'opened from an invite link before the person is in the app' } }),
}, (r) => {
  const res = checkHomeScreen({ repo: r, exempt: { '/join': 'invite' } })
  assert.equal(res.ok, false)
  assert.equal(res.problems.length, 2)
  const run = spawnSync(process.execPath, [CLI, '--repo', r], { encoding: 'utf8' })
  assert.equal(run.status, 1)
  assert.match(run.stdout, /src\/app\/notes\/page\.tsx/)
  assert.match(run.stdout, /src\/app\/a\.tsx:1/)
  assert.match(run.stdout, /exempt \/join: opened from an invite link/)
}))

test('the CLI passes a clean app, prints its exemptions, and refuses an unknown flag', () => withRepo({
  ...BASE,
  'src/app/join/page.tsx': 'export default function P() { return <main /> }\n',
  'home-screen.json': JSON.stringify({ exempt: { '/join': 'opened from an invite link' } }),
}, (r) => {
  const ok = spawnSync(process.execPath, [CLI, '--repo', r], { encoding: 'utf8' })
  assert.equal(ok.status, 0, ok.stdout + ok.stderr)
  assert.match(ok.stdout, /exempt \/join: opened from an invite link/)
  assert.equal(spawnSync(process.execPath, [CLI, '--nope'], { encoding: 'utf8' }).status, 2)
}))

test('the CLI refuses a home-screen.json it cannot read', () => withRepo({ ...BASE, 'home-screen.json': '{ not json' }, (r) => {
  const run = spawnSync(process.execPath, [CLI, '--repo', r], { encoding: 'utf8' })
  assert.equal(run.status, 2)
  assert.match(run.stderr, /home-screen\.json/)
}))
