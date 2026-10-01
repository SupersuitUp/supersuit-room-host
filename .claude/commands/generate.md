---
description: Make this living template your own app, on your own accounts, still receiving every improvement to the template.
---

# /generate: make this template yours

You are running inside a fresh clone of a **living template**: an app that keeps improving after
it is copied. Your job is to turn this clone into the app of the person (or people) at the keyboard,
on **their** accounts, so that it keeps receiving every improvement to the template from here on.

One rule decides almost everything: **whatever makes this copy theirs goes in `tailor/`, and nothing
else in the code changes.** An update never touches `tailor/`; anything changed outside it becomes
a divergence they will be told about every night.

Work through the steps in order. After each one, say in one line what is now true.

## 0. Check where you are

```bash
git remote -v
git log --oneline -1
```

- If there is already a remote named `template`, this clone has been generated before. Stop, say
  so, and offer to run `node living/update.mjs` instead.
- If `origin` points at the template (it does in a fresh clone), continue.
- Read, in full, before doing anything else: `TAILORING.md` (what this app needs that is specific to
  it), `tailor/README.md` (what every setting means) and `living/README.md` (how updates arrive).

## 1. Keep listening to the template

```bash
git remote rename origin template
```

From now on `template` is where improvements come from, and `origin` will be their own repository.

## 2. Ask them what only they know

Use `AskUserQuestion`, a few questions at a time, never a wall of prose. Ask for exactly what
`TAILORING.md` lists under "What you need before you start", and nothing it does not. **Never ask
for a secret in the chat** (an API key, a password, a private key): the transcript keeps it. A
secret goes from them straight into the hosting provider's own prompt, at the step that needs it. Do not guess
a name, an address or an account. Where `TAILORING.md` offers a default, offer it as the
recommended option.

Then confirm, once, which accounts everything will be created on (their Google/Firebase account,
their hosting account, their GitHub account). **Never create anything on an account they did not
name**, and never on the account of whoever made the template.

## 3. Their private words

Write `tailor/private-words.txt`: one per line, their full names, any distinctive single name or
surname, their email domain if it is personal, and the app's address once it is known. **Three
kinds of name go in only as the full name, never alone:** a first name that is also an ordinary
word (Will, Grace, Hope, May), a name the template's sample couple uses (see `tailor/README.md`),
and the short member keys. The check matches whole words, so a bare "Will" would flag every
"will" in the code, and a bare sample name flags every test.

```bash
node living/private-words.mjs     # must say: no private words outside tailor/
```

## 4. Rewrite tailor/

Follow `tailor/README.md` field by field. The sample values are placeholders; every one of them
gets replaced or deliberately kept. Fill everything their answers already settle (including the
address, when they are not using their own domain); values that only exist once their accounts do
(an API key, an app id) stay as placeholders until step 5 fills them, and step 6 refuses any that
are left. Change nothing outside `tailor/` except a change `TAILORING.md` names as sanctioned for
their situation; that file then shows as diverging every night, which is expected.

## 5. Their infrastructure

Follow `TAILORING.md`'s setup sections in order (every section before "Prove it"), on their
accounts. Publishing, going live and updates are steps 7 to 9 here, not there:

- Run every command yourself. Before the first one for a service, check they are signed in to the
  right account (`firebase login:list`, `gcloud config get account`, `vercel whoami`, `gh auth status`)
  and ask them to sign in if not.
- **A step that needs a human** (a billing account, a console toggle, a DNS record at their
  registrar) is handed to them as one exact instruction with the direct link, then verified by you
  with a command before moving on. Never mark a step done because they said it is done.
- **Secrets never go in a file.** A key goes straight into the hosting provider's environment
  settings, and the local copy is deleted.

## 6. The check

```bash
pnpm install && pnpm run living:check    # or npm, if there is no pnpm-lock.yaml
```

It must pass. A failure is a real problem to fix in `tailor/`, never a check to skip.

## 7. Their own repository

Create a **private** repository on their GitHub account, then:

```bash
git remote add origin <their repository URL>
git push -u origin main
```

## 8. Live

Deploy as `TAILORING.md` says, then prove it as its "Prove it" section says, on a phone if it is a
phone app. Delete anything you created to test it.

## 9. Updates every night

On the Mac that will own the app:

```bash
node living/install-nightly.mjs "$(pwd)"
```

Optionally add `--notify "<a command that tells them>"`; it receives a JSON report on stdin only on
a night when something updated or something was blocked. Every night their copy merges the
template's improvements, runs `living:check`, and publishes only if it passes. If the template
repository is private, their GitHub account needs read access to it; check with
`git fetch template` and tell them who to ask if it fails.

## 10. Report

In plain words: the address, who can sign in, what is in `tailor/`, anything they still have to do
by hand, and anything you had to change outside `tailor/` (and why). Then stop.
