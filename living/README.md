# living/

The machinery for being a living template. Every living template is made from this repository
and keeps listening to it; every tailored app is made from a template and keeps listening to
that. Fix something here once and it walks down the family on its own:

```
living-template-template      this repository: the machinery, nothing else
├── <some>-template           a living template: an app with a sample tailor/
│   └── <someone>'s app       a tailored app: the template plus their own tailor/
```

## The rules every level follows

- **One parent, named `template`.** A template's `template` remote is this repository; an
  app's is its template. Nothing else is special about any level.
- **`tailor/` belongs to the copy.** Whatever makes a copy someone's own lives there, and an
  update never overwrites it. Neither does it overwrite `README.md`. (`.gitattributes` covers
  a file both sides changed; `update.mjs` also restores these paths when only the parent
  changed them, which `merge=ours` alone does not.)
- **The copy defines its own check.** `package.json` must have a `living:check` script (for a
  web app: tests and build, plus `node living/private-words.mjs`). Nothing publishes unless it
  passes.
- **No real person's name, address or domain outside `tailor/`.** `living/private-words.mjs`
  fails the check if one appears. A template forbids its apps' names by fingerprint, so it
  never has to contain them.
- **A template pins its modules; an app never picks one.** A module is a package the template
  declares in `package.json` `living.modules` (exact names or `@scope/*`; default every
  `@supersuit/*` package), best declared with `^`. Each night, for a repository registered as a
  template, `bump.mjs` takes the newest version inside that range in a throwaway worktree, runs the
  template's own `living:check`, and publishes only if it passes; the same run then carries the
  new pin to every app. A version outside the range (a major, or under `^0.x` a minor, as npm reads
  it) waits for a person: `node living/bump.mjs --repo <template> --allow-major <name>` takes it
  through the same check. Taken automatically: anything inside the range that passes the check.
  Held: anything outside it, and anything that fails the check. A held version is told once, not
  every night.
- **Below 1.0, an addition is a patch and a breaking change is a minor.** That is how a module's
  version has to be cut for the rule above to work: npm reads `^0.1.2` as "0.1.x only", so a
  breaking change shipped as a minor is held for a person, and an addition shipped as a patch
  reaches every template on its own.

## Commands

| Command | What it does |
|---|---|
| `node living/update.mjs [--repo P] [--dry-run] [--json]` | Merge the parent if it is ahead, keep `tailor/`, run `living:check`, publish only if green. Exit 0 updated or current, 2 blocked, 1 crashed. Reports divergent files. Publishes only from a checkout that is exactly origin's default branch (see below). |
| `node living/bump.mjs [--repo P] [--dry-run] [--allow-major <name>]... [--json]` | For a template: take each module's newest version inside its declared range, check, publish only if green; hold anything outside the range. Exit 0, 2 blocked, 1 crashed. |
| `node living/divergence.mjs` | (library) Parent files this copy changed on purpose, with what the parent changed there since. |
| `node living/private-words.mjs [--repo P]` | Fail if a private word appears outside `tailor/`. `--add <word>...` fingerprints words into `tailor/forbidden.sha256`. |
| `node living/new-template.mjs <dir>` | A new living template from this repository. |
| `node living/new-app.mjs <dir> --from <template> --template-checkout <path> --word <w>...` | A new tailored app from a template; fingerprints its private words into the template. |
| `node living/nightly.mjs` | Update every registered repository on this machine, parents first. |
| `node living/install-nightly.mjs <repo> [--template] [--notify "<cmd>"]` | Register a repository and install the 03:30 LaunchAgent (macOS). `--template` also bumps its modules each night; never use it for a tailored app. |

`LIVING_NOTIFY_CMD` is a shell command that receives a report as JSON on stdin whenever a
nightly run published something, was blocked, or has a newly held module version (module reports
carry `"kind": "modules"`). A quiet night runs nothing, and the same held or refused version is
told once.

**Re-running `install-nightly.mjs` rewrites and reloads the live plist.** Unless you pass
`--notify "<cmd>"` (or `LIVING_NOTIFY_CMD` is set in that shell), the plist loses its notify
command and every blocked night goes untold. Pass the command already in the plist, under its
`LIVING_NOTIFY_CMD` key. To register a template: `node living/install-nightly.mjs <template-repo>
--template --notify "<cmd>"`. Registering an app takes no `--template`.

## When an update or a bump is blocked

`update.mjs` and `bump.mjs` publish only from a checkout that is exactly origin's default branch,
so a session's unpushed work is never pushed on its behalf. Otherwise nothing is pushed and the
report's `blockedBy.reason` says why:

| Reason | Meaning |
|---|---|
| `dirty` | Uncommitted changes (the files are listed). |
| `not on <branch>` | The checkout is on a branch other than origin's default. |
| `detached HEAD` | No branch is checked out. |
| `ahead of origin` | A local commit was never pushed. |
| `diverged from origin` | Local and origin each have commits the other lacks. |
| `behind origin` | Origin has commits this checkout lacks. |
| `fetch failed` | Origin could not be reached (git's output is attached). |

Behind is the one case that heals itself: `update.mjs` fast-forwards a clean checkout that is only
behind (listed as `fastForwarded` in its report) and carries on. `bump.mjs` blocks instead, and
the same night's update does the fast-forward. A blocked template is not bumped that night.

The module report remembers what it has told in `modules-seen.json`, beside the registry. If that
file is unreadable it is replaced by an empty one, a warning goes to `nightly.log`, and every
repository is still updated; at worst a held version is told once more.

## Making a tailored app

**Someone making their own copy, on their own accounts:** clone the template, open it in Claude
Code, and run `/generate` (`.claude/commands/generate.md`). It asks them what it needs, builds
everything on their accounts following the template's `TAILORING.md`, and leaves the copy
listening to the template.

**The template's owner making a copy for someone:** `living/KIT.md`, which also fingerprints the
new copy's private words into the template.

## Tests

```bash
node --test 'living/test/*.test.mjs'
```

Every test builds throwaway repositories in the temp folder, including a full three-level
family, and proves one rule: what publishes, what is refused, and what is never touched.
