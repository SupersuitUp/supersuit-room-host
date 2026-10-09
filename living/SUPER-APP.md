# Super apps: the tile contract

A super app is a launcher whose tiles are small apps. Every tile in every super app made from this
template holds to the same contract, so a new tile cannot quietly be the one that never tells anyone
anything. The notification checks live in [tile-contract.mjs](tile-contract.mjs); each app supplies
its own declarations and calls them from its own tests. Rules 10 and 11, the home-screen contract,
are checked by [home-screen-contract.mjs](home-screen-contract.mjs) from the app's `living:check`.

## The principles

1. **Every app notifies.** Anything one person saves that the other can see is news, unless it is declared private to its owner, with the reason.
2. **A burst is one buzz.** Repeats of the same kind bundle into one row and one push. This is what keeps rule 1 from becoming noise.
3. **A push names the person and opens the exact thing.** Who, then what, in their words where the other person has already seen those words. The tap opens the item, never the tile's front page.
4. **Never the person who did it, never a repeat.** Only a write made by this request is news.
5. **One news record feeds every channel**: push, launcher, email digest. A new tile wires its news once.
6. **Anything you can type, you can say.** Voice and text are equal ways into the same field.
7. **Capture says it was kept.** A photo or a take is safe on the phone the moment it stops, survives a dropped connection, and the screen says plainly that it is saved.
8. **Whatever a person can do on the phone, their agent can do from the computer**, through the tile's agent route, or the tile carries a written reason why not.
9. **A tile that is off is gone, strangers get nothing, names stay in `tailor/`, colors come from the theme.**
10. **Every screen below the home has an explicit Back control that returns to its parent.** The app lives on a home screen, where there is no browser back button. Back is a visible "‹ Back" at the top left, at least 44px to tap, in the theme's colors, and it goes to a fixed parent `href`. Never `history.back()` alone: a screen opened from a notification or a link has no history, and that Back goes nowhere.
11. **No input, textarea or select ever renders below 16px.** iOS zooms the whole page into a focused field smaller than that, and a home-screen app has no easy way back out of the zoom. Keep a field looking small with the layout around it, never by shrinking its font. Never `maximum-scale=1` or `user-scalable=no` in the viewport: that kills pinch zoom, which people who need larger text depend on.

**Breaking a rule on purpose is allowed, never by accident.** Every exception carries a written
reason, and the check prints every one on every run, so a shortcut never goes quiet.

## Adding a tile

A new tile is not done until every item holds. The first three fail a test when skipped; the rest
are on you.

1. **Register the tile** in your app's tile list and defaults (default OFF, so a template update
   never switches an app on for someone), and its pages and API prefix in the module that turns a
   disabled tile into a 404 everywhere.
2. **Decide its notifications in your app's `notify-coverage.ts`, before writing a route.** Either
   `announces: [...kinds]`, or `privateToOwner: '<why nobody else can see it>'`, or
   `noMemberWrites: '<why members never write here>'`. Type the map as a record keyed by tile, so a
   tile with no entry does not compile.
3. **Every write route announces or says why it is quiet.** If what a POST/PATCH/PUT writes is
   something the other member can see, it calls an `announce*` function from your app's announce
   module (directly, or from the lib module the route calls), run after the response so a failed
   push never fails the member's action. Otherwise it gets an entry in `QUIET_ROUTES` with the
   reason. Upload-ticket routes are exempt. The coverage test walks every route and fails on one that
   is quiet by omission.
4. **Every kind of action on a shared item is decided.** A new patch kind (a reaction, a new step)
   needs its line in your app's patch-news table and a scenario that runs the announce module for
   real, so the test fails when the code does not do what the decision says.
5. **Each new news kind** goes in your app's list of activity kinds, gets its event shape and row,
   and its sentence in an exhaustive switch. Only a write made BY this request is news: compare the
   stamp to now, never re-announce a repeat, and never put words on a locked phone that the other
   member has not already seen. A burst of the same thing is one push: add it to the grouped kinds.
   The email digest picks up every announced kind from its activity row, so there is no second
   place to wire.
6. **The launcher.** A summary read only when the tile is on, and an entry in the launcher component
   with a "has new" flag so the tile can leave the More folder when something arrives.
7. **Item links.** If its items can be linked to, register the kind with your item-link and
   item-meta modules, so a link unfurls with no names or words in it.
8. **Docs.** The tile and its default in `tailor/README.md`, and what it does in `README.md`.

## How an app wires the check

One test file in the app calls the three functions with the app's own declarations:

```ts
import { describe, it, expect } from 'vitest'
import { join } from 'node:path'
import { checkTileNews, checkNewsLines, checkRouteCoverage } from '../../../living/tile-contract.mjs'
import type { TileNewsDecision } from '../../../living/tile-contract'
import { TILES } from '../couple/schema'
import { TILE_NEWS, QUIET_ROUTES, ACTIVITY_KINDS, tileForPath } from './notify-coverage'
import { activityLine } from './activity'

const src = join(process.cwd(), 'src')

describe('the tile contract', () => {
  it('every tile decides its news', () => {
    expect(checkTileNews({ tiles: [...TILES], tileNews: TILE_NEWS, kinds: [...ACTIVITY_KINDS] })).toEqual([])
  })
  it('every news line starts with the person', () => {
    expect(checkNewsLines({ kinds: [...ACTIVITY_KINDS], lineFor: (k) => activityLine(k, 'Ana'), name: 'Ana' })).toEqual([])
  })
  it('no write route is quiet by omission', () => {
    const r = checkRouteCoverage({
      appDir: join(src, 'app'), apiRoot: join(src, 'app/api'),
      libDirs: { '@/lib/': join(src, 'lib/') },
      tileForPath, tileNews: TILE_NEWS, quietRoutes: QUIET_ROUTES,
      ignoreLibs: ['/lib/announce.ts'], // the module that defines announce* calls nothing
    })
    expect(r.silent).toEqual([])
    expect(r.stale).toEqual([])
  })
})
```

A write route is any `route.ts` that exports `POST`, `PATCH` or `PUT` in a shape Next.js accepts:
`export (async) function`, `export const|let` (arrow, wrapped call, typed), a destructured
`export const { POST } = ...`, or an `export { handler as POST }` list, with or without `from`.
Comments and string literals are blanked first, so a mention of POST in either is not a write.

`ignoreLibs` matters: the announce module itself defines `export function announceX(`, which matches
the announce pattern without announcing anything. Pass its path suffix (starting with `/`, e.g.
`/lib/announce.ts`) so a route that only imports it is still reported silent. The import scan reads
only `from '...'` with single quotes; a route using double quotes or a dynamic import is reported
silent, which is the safe direction. `exempt` (default: paths ending `/upload-url`) and `announce`
(the pattern) can be replaced when an app's conventions differ.

## The home-screen contract (rules 10 and 11)

`node living/home-screen-contract.mjs [--repo <path>] [--config <file>]` goes in the app's own
`living:check`. It exits 1 and names the file for every problem, 0 when the contract holds, and 2 on
a bad flag or an unreadable config. It checks, statically:

- **Back.** Every Next.js page under `src/app` other than the home renders the app's Back component:
  the page itself, or a module it imports (relative or `@/`) up to two imports deep. Route groups
  `(name)` and slots `@name` are not part of the route; `_private` folders are skipped. A mention in a
  comment or a string does not count, and `<BackRow>` is not `<Back>`.
- **16px.** The global stylesheet gives `input`, `textarea` and `select` a font-size of at least 16px
  (`16px`, `1rem`, or a `max()` reaching it). No stylesheet rule under `src` shrinks one of them, and
  no `<input>`, `<textarea>` or `<select>` in a component carries `text-xs`, `text-sm`, an arbitrary
  `text-[Npx]` under 16, or a `fontSize` under 16 (any variant prefix counts, `sm:text-sm` too).
  Inputs that never take typed text (`type="checkbox"`, `radio`, `range`, `file`, `hidden`, buttons)
  are left alone, and so are test files.

The app's declarations live in `home-screen.json` at its root, all optional:

```json
{
  "home": ["/"],
  "back": "Back",
  "exempt": { "/join": "opened from an invite link before the person is in the app; there is no parent yet" },
  "globalCss": "src/app/globals.css"
}
```

`home` lists the routes that are the app's home (a launcher at `/app` as well as `/`, say). `back` is
the component's name. Every exemption needs its reason, the check prints every one on every run, and
an exemption for a route that no longer exists is a problem. A screen that only redirects is a fair
exemption; a screen someone can land on and read is not.

The Back component itself, in each app (`src/app/components/back.tsx` is the convention):

```tsx
import Link from 'next/link'
import { INK } from '../theme'

// The way out of a screen on a home-screen app, which has no browser back button. Always a fixed
// parent, never history.back(): a screen opened from a notification has no history.
export function Back({ href, label = 'Back' }: { href: string; label?: string }) {
  return (
    <Link href={href} className="-ml-3 inline-flex min-h-11 min-w-11 items-center px-3 text-base" style={{ color: INK }}>
      <span aria-hidden="true" className="mr-1 text-xl leading-none">‹</span>{label}
    </Link>
  )
}
```

The library is `checkHomeScreen({ repo, ...config })`, built from `checkBackControls` and
`checkInputFontSizes`, for an app that would rather call it from a test.
