// The one argument parser every living/ command line shares. A command line that guesses is
// dangerous here: install-nightly once took `--help` for a repository path, registered it and
// reloaded the nightly job. So every CLI declares its flags up front and this refuses the rest.
//
//   parseCli(argv, { bool: ['--dry-run'], value: ['--repo'], multi: ['--word'], positionals: 1 })
//   -> { help: true }                       --help or -h anywhere: print usage, exit 0, touch nothing
//   -> { error: '...' }                     unknown flag, missing value, extra positional: exit 2
//   -> { flags: Set, values: {}, multi: {}, positionals: [] }
// `--` ends flag parsing; what follows is positional.
export function parseCli(argv, { bool = [], value = [], multi = [], positionals = 0 } = {}) {
  if (argv.some((a) => a === '--help' || a === '-h')) return { help: true }
  const flags = new Set()
  const values = {}
  const many = Object.fromEntries(multi.map((n) => [n, []]))
  const rest = []
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--') { rest.push(...argv.slice(i + 1)); break }
    if (!a.startsWith('-') || a === '-') { rest.push(a); continue }
    if (bool.includes(a)) { flags.add(a); continue }
    if (value.includes(a) || multi.includes(a)) {
      const v = argv[i + 1]
      if (v === undefined || (v.startsWith('--') && v.length > 2)) return { error: `${a} needs a value` }
      i++
      if (multi.includes(a)) many[a].push(v)
      else values[a] = v
      continue
    }
    return { error: `unknown flag ${a}` }
  }
  if (rest.length > positionals) return { error: `unexpected argument ${rest[positionals]}` }
  return { flags, values, multi: many, positionals: rest }
}

// The front of every CLI entry point: usage and exit 0 for --help, the refusal and exit 2 for
// anything undeclared, otherwise the parsed arguments. Nothing has run by the time it returns.
export function cliArgs(argv, usage, spec) {
  const r = parseCli(argv, spec)
  if (r.help) { console.log(usage); process.exit(0) }
  if (r.error) { console.error(`${r.error}\n${usage}`); process.exit(2) }
  return r
}
