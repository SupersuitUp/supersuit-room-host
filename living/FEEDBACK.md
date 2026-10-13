# Welcome and feedback contract

Every living template app must provide one stable welcome address and an easy way to give
detailed feedback. This is a delivery requirement; this document does not implement a UI or
claim that existing templates already support it.

## The welcome address

- One address welcomes a new person, explains account creation, and returns an authenticated
  person to the app. Joining and returning must not require different links or a review key.
- Explain who may join, what the app does, and where help and change requests live.
- Preserve the app's own invitation and membership rules. Possessing a link never grants
  access to private content by itself.
- Provide useful sign-in troubleshooting without revealing the membership list.

## Feedback inside the app

- Provide an easy-to-find Help & feedback entry from every screen. An error should offer a
  contextual Report a problem action when the app can still display it.
- Offer change requests, bug reports and general feedback with short, relevant prompts.
  For bugs, ask what happened, what was expected and how to reproduce it; optional fields
  must stay optional.
- Accept typed text, attached images/screenshots, attached short video and recorded voice.
  A voice-only report is valid. Let the person listen and inspect attachments before Send.
- Show supported formats, attachment limits, upload progress, retry and removal. Keep a
  draft after a failed upload or submission. Recover interrupted recordings where supported,
  and state honestly when a browser cannot persist a draft.
- Bind drafts and recordings to the app and account. Switching people must never display
  another person's draft. Repeated Send taps must not create duplicate reports.
- Explain what will be sent and who can read it. Include only consented, useful diagnostics:
  app version, sanitized route, time and browser/display information. Never collect private
  screen contents, tokens, cookies, unrelated posts or query-string secrets automatically.
- Store reports and attachments in the app owner's own accounts. Make them private to the
  submitter and explicitly authorized maintainers. Ordinary app membership is not maintainer
  permission. Never publish or forward reports externally by default.
- Give a receipt after durable acceptance and a way to see the submitter's own reports and
  status. Do not claim delivery while a report exists only on the device.

## What satisfies this contract

The shared implementation is one module, `@supersuit/suggest-a-change`
(github.com/SupersuitUp/suggest-a-change). It carries the entry every screen shows (Suggest a
change), the sheet, the receipt, a person's own list, the report contract, the hosted handlers
and a store conformance suite. A template adopts it; it does not write its own.

What proves a template holds to it is the module's own command, run from the template's check
script:

```bash
npx suggest-a-change-check --strict
```

It fails when a screen is not under a layout that renders the entry, when an exempt screen has
no reason, when an adapter is missing, and, with `--strict`, when the adapters are still the
stubs `npx suggest-a-change init` writes. The check lives in the module on purpose: this folder
is copied whole into every template, and one more file here is one more copy to keep identical.
A template is covered when that command is in its `living:check` and green, and not before.

## Tailoring and verification

The template owns the shared implementation and its checks. The tailored app supplies its
wording, storage, identity/membership adapters, explicit maintainers and chosen attachment
limits. These settings belong in its normal private configuration; real people and accounts
never belong in the shared module or template source.

Before delivering a new app, verify the same welcome link in fresh and returning sessions;
typed, image, video and voice submissions; draft recovery and failed-upload retry; receipt
idempotency; account switching; and report/attachment isolation from other members. Test the
actual supported phone recording environment before claiming it works there. Report missing
capabilities as incomplete delivery, never mark them complete because this contract exists.

Existing templates adopt through their normal checked update process. Track each integration
and its evidence; an unintegrated template does not inherit working support from documentation
alone. Domain implementation belongs in reusable app modules and app adapters, not in this
meta-template's update machinery.
