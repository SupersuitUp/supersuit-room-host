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

## Commands

| Command | What it does |
|---|---|
| `node living/update.mjs [--repo P] [--dry-run] [--json]` | Merge the parent if it is ahead, keep `tailor/`, run `living:check`, publish only if green. Exit 0 updated or current, 2 blocked, 1 crashed. Reports divergent files. |
| `node living/divergence.mjs` | (library) Parent files this copy changed on purpose, with what the parent changed there since. |
| `node living/private-words.mjs [--repo P]` | Fail if a private word appears outside `tailor/`. `--add <word>...` fingerprints words into `tailor/forbidden.sha256`. |
| `node living/new-template.mjs <dir>` | A new living template from this repository. |
| `node living/new-app.mjs <dir> --from <template> --template-checkout <path> --word <w>...` | A new tailored app from a template; fingerprints its private words into the template. |
| `node living/nightly.mjs` | Update every registered repository on this machine, parents first. |
| `node living/install-nightly.mjs <repo> [--notify "<cmd>"]` | Register a repository and install the 03:30 LaunchAgent (macOS). |

`LIVING_NOTIFY_CMD` is a shell command that receives a report as JSON on stdin whenever a
nightly run published something or was blocked. A quiet night runs nothing.

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
