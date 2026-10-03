# The tailoring kit

Paste this to an agent (Freeda, or any coding agent with a shell) to make a tailored app from a
living template, as the template's owner. Someone making their own copy on their own accounts runs
`/generate` in a clone of the template instead. Fill in the three lines at the top; the rest is the job.

---

You are making a tailored copy of a living template app for specific people. The template keeps
improving, and their copy will pick up every improvement automatically, so the one rule that
matters is: **everything about them goes in `tailor/`, and nothing else in the code changes.**

- Template: `<git URL of the template>`
- Who it is for: `<their names, and anything the template's TAILORING.md asks for>`
- Where it goes: `<local folder for the new app>`, pushed to `<new private repo URL>`

Do this in order:

1. **Read the template's `TAILORING.md` and `tailor/README.md` first.** They say what the
   settings mean and what the app needs that is specific to it (a database project, a host,
   sign-in addresses, keys). Do not start until you can name each.
   Read `living/FEEDBACK.md` too: every delivered app needs one welcome link and private
   feedback/change requests with images, video and voice. A template missing those capabilities
   needs an integration in its source before it can be delivered as satisfying the contract.
2. **Create the copy:**
   `node living/new-app.mjs <folder> --from <template URL> --template-checkout <local template checkout, if you have one> --word "<each name>" --word "<their domain>"`.
   Every private word (names, email domains, the app's address) is fingerprinted into the
   template so the template can never pick it up. **A first name that is also an ordinary word
   (Will, Grace, Hope, May) goes in as the full name only**, never alone: matching is by whole
   word, so a bare `Will` forbids every "will" in the code, and the command reports hits all over
   the template. Distinctive single names and surnames are fine on their own. If the command reports that the template
   already contains one, stop and tell the template's owner.
3. **Rewrite `tailor/` for them**, following `tailor/README.md`. Change nothing outside it. If
   the app cannot do what they need without a code change, make it, and say so: it will show up
   as a divergence in every nightly report until the template catches up.
4. **Create their infrastructure** as `TAILORING.md` describes, on the accounts it belongs on.
   Never put a secret in a file; secrets go in the host's environment settings.
5. **Run the check** (`pnpm run living:check` or `npm run living:check`). It must pass,
   including the private-words check.
6. **Give it its own remote and push:** `git remote add origin <new repo URL> && git push -u origin main`.
   Push the template checkout too, if step 2 committed fingerprints there.
7. **Turn on updates:** `node living/install-nightly.mjs <folder>` on the machine that will own
   it, with `--notify "<command that tells the owner>"` if they want to hear about updates. If
   that machine already runs the nightly, add `--register-only` instead: the job is left alone.
8. **Prove it in the real app**, signed in, on a phone if it is a phone app, before anyone else
   is told it exists. Then report: the address, what is in `tailor/`, and anything you had to
   change outside it.
