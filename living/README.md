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

- **Every app has a welcome and feedback flow.** [FEEDBACK.md](FEEDBACK.md) defines the delivery
  requirement: one stable welcome link, private detailed change requests and bug reports,
  images/video/voice, recoverable drafts and receipts. The meta-template carries the contract;
  shared app modules and each template's adapters carry the implementation. The module is
  `@supersuit/suggest-a-change`, and `npx suggest-a-change-check --strict` in a template's own
  check is what proves every screen carries the entry.
- **Every retained content source is searchable or carries an explicit decision.** [SEARCH.md](SEARCH.md) defines the contract: every tile and source declares indexed, intentionally excluded with a reason, or a failing gap. `checkSearchCoverage` proves the real listing, loading, indexing, authenticated search, disabled-tile behavior and private access. A template includes that integration test in its `living:check`; declarations alone do not pass.
- **Every upload is findable.** [ASSETS.md](ASSETS.md) defines the contract: whatever writes uploaded
  media indexes it with `@supersuit/asset-index`, or says why not. `node living/asset-contract.mjs`
  checks it, and a template puts that command in its own `living:check`.
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
- **Every app lives on a home screen.** No browser back button and no zoom into a field: every
  screen below the home has a Back control to its parent, and no input renders under 16px
  ([SUPER-APP.md](SUPER-APP.md), rules 10 and 11). `node living/home-screen-contract.mjs` checks
  it, and a template puts that command in its own `living:check`.
- **A template pins its modules; an app never picks one.** A module is a package the template
  declares in `package.json` `living.modules` (exact names or `@scope/*`; default every
  `@supersuit/*` package), best declared with `^`. Each night, for a repository registered as a
  template, `bump.mjs` takes the newest version inside that range in a throwaway worktree, runs the
  template's own `living:check`, and publishes only if it passes; the same run then carries the
  new pin to every app. A version outside the range (a major, or under `^0.x` a minor, as npm reads
  it) waits for a person: `node living/bump.mjs --repo <template> --allow-major <name>` takes it
  through the same check. Taken automatically: anything inside the range that passes the check.
  Held, and told once: anything outside it. Refused, and told once: anything that fails the
  check (nothing is published; the report is `blocked`). Skipped, and told once: a module declared
  with a range the bump does not move (`0.1.x`, `~1.2`, `*`, `workspace:*`, a tag) and a
  `living.modules` entry that is not a package name; declare it as `^X.Y.Z` to have it moved.
- **Below 1.0, an addition is a patch and a breaking change is a minor.** That is how a module's
  version has to be cut for the rule above to work: npm reads `^0.1.2` as "0.1.x only", so a
  breaking change shipped as a minor is held for a person, and an addition shipped as a patch
  reaches every template on its own.

## Commands

| Command | What it does |
|---|---|
| `node living/update.mjs [--repo P] [--dry-run] [--json]` | Merge the parent if it is ahead, keep `tailor/`, run `living:check`, publish only if green. Exit 0 updated or current, 2 blocked, 1 crashed. Reports divergent files. Publishes only from a checkout that is exactly origin's default branch (see below). |
| [SEARCH.md](SEARCH.md), `search-contract.mjs` | (library) `checkSearchDecisions` and `checkSearchCoverage`: exhaustive source decisions and real behavior probes, including restricted readers and stale permissions. |
| [SUPER-APP.md](SUPER-APP.md), `tile-contract.mjs` | (library) The notification contract every tile in a super app holds to, and the three checks an app calls from its own tests: `checkTileNews`, `checkNewsLines`, `checkRouteCoverage`. |
| `node living/bump.mjs [--repo P] [--dry-run] [--allow-major <name>]... [--json]` | For a template: take each module's newest version inside its declared range, check, publish only if green; hold anything outside the range. Exit 0, 2 blocked, 1 crashed. |
| `node living/divergence.mjs` | (library) Parent files this copy changed on purpose, with what the parent changed there since. |
| `node living/private-words.mjs [--repo P]` | Fail if a private word appears outside `tailor/`. `--add <word>...` fingerprints words into `tailor/forbidden.sha256`. |
| [SUPER-APP.md](SUPER-APP.md), `node living/home-screen-contract.mjs [--repo P] [--config F]` | Fail if a screen below the home has no Back control, or an input, textarea or select can render under 16px (iOS zooms into it). Declarations and exemptions in the app's `home-screen.json`. Exit 0 clean, 1 problems, 2 bad arguments or config. Library: `checkHomeScreen({ repo, ...config })`. |
| [ASSETS.md](ASSETS.md), `node living/asset-contract.mjs [--repo P]` | Fail if a file under `src/` writes uploaded media without reaching `@supersuit/asset-index` or carrying `asset-index: exempt <reason>`. Exit 0 clean, 1 problems, 2 bad arguments. Library: `checkAssetIndexing({ repo })`. |
| `node living/new-template.mjs <dir>` | A new living template from this repository. |
| `node living/new-app.mjs <dir> --from <template> --template-checkout <path> --word <w>...` | A new tailored app from a template; fingerprints its private words into the template. |
| `node living/nightly.mjs` | Update every registered repository on this machine, parents first. Exit 0 whenever the run finished, blocked repositories included (they are told through `LIVING_NOTIFY_CMD`); anything else means the run itself crashed. |
| `node living/install-nightly.mjs <repo> [--template] [--register-only] [--notify "<cmd>" \| --no-notify] [--heartbeat "<cmd>"] [--move-job]` | Register a repository and install the 03:30 LaunchAgent (macOS). `--template` also bumps its modules each night; never use it for a tailored app. `--register-only` edits the registry and leaves the job alone. Exit 2 is a refusal, with nothing changed (an unknown flag, a path that is not an existing git repo, or a `HOME` that is not this user's real home folder). |

`LIVING_NOTIFY_CMD` is a shell command that receives a report as JSON on stdin whenever a
nightly run published something, was blocked, or has a newly held, refused or skipped module
(module reports carry `"kind": "modules"`). A quiet night runs nothing, and the same held,
refused or skipped module is told once.

`LIVING_HEARTBEAT_CMD` is a shell command run after every run that finished, quiet or not, with
`{ at, repos, blocked }` as JSON on stdin. It exists because a job cannot report its own absence:
point it at something that re-arms a timer, and the timer goes off when the job crashes or stops
running. `--heartbeat "<cmd>"` puts it in the plist; a re-run keeps the one already there, and an
empty one removes it. With no heartbeat a dead job is silent, and the installer says so.

**The job is one per user, whatever `HOME` says.** launchd holds a single job under this label, so
a full install run with `HOME` pointed somewhere else would replace the real job with one that logs
into that folder and has lost its notify command. The installer refuses that (exit 2, nothing
written). The plist starts node by a path an upgrade keeps (`/opt/homebrew/bin/node`) when one on
`PATH` is the same binary, never by Homebrew's versioned folder.

**Adding a repository to a machine whose job already runs: `--register-only`.** The job runs every
registered repository, so a new one needs only the registry line:
`node living/install-nightly.mjs <template-repo> --template --register-only`. The plist and the
loaded job are not touched. Registering an app takes no `--template`.

**A full re-run rewrites and reloads the plist, and keeps what the live one had.** With no
`--notify` and no `LIVING_NOTIFY_CMD` in the shell, the notify command already in the plist is
kept; removing it takes `--no-notify`, and an explicitly empty one is refused. The job stays on the
copy of the framework it already runs, whichever copy you ran this from; `--move-job` moves it to
this copy, and is required when the old copy no longer exists. A refusal exits 2 and changes
nothing, the registry included.

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

## The check runs on what ships, and so does the checkout

`living:check` always runs after a frozen install (`pnpm install --frozen-lockfile`, or `npm ci`
for a `package-lock.json`, chosen by the lockfile) in the throwaway worktree, so the gate tests the
lockfile that ships; a failed install is a block with reason `install failed`. The checkout keeps
its own `node_modules`, though, and a fast-forward to a merge that changed `package.json` or a
lockfile would leave them stale, so a later local `living:check` would test an older program than
the deploy builds. `update.mjs` (the merge, and the catch-up when behind origin) and `bump.mjs`
therefore run the same frozen install in the checkout after the fast-forward, only when the move
touched a dependency file. It cannot block, since the commits are published by then: the report
carries `install` (`installed`, `skipped` or `failed`) and a failure adds a `warning`.

## Making a tailored app

**Someone making their own copy, on their own accounts:** clone the template, open it in Claude
Code, and run `/generate` (`.claude/commands/generate.md`). It asks them what it needs, builds
everything on their accounts following the template's `TAILORING.md`, and leaves the copy
listening to the template.

**The template's owner making a copy for someone:** `living/KIT.md`, which also fingerprints the
new copy's private words into the template.

Every command here takes `-h` / `--help` (usage, exit 0, nothing touched) and refuses an unknown flag
with exit 2 naming it, through the shared parser in `living/cli.mjs`.

## Tests

```bash
node --test 'living/test/*.test.mjs'
```

Every test builds throwaway repositories in the temp folder, including a full three-level
family, and proves one rule: what publishes, what is refused, and what is never touched.
