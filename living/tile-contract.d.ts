export type TileNewsDecision =
  | { announces: readonly string[] }
  | { privateToOwner: string }
  | { noMemberWrites: string }

export function checkTileNews(o: {
  tiles: readonly string[]
  tileNews: Record<string, TileNewsDecision>
  kinds: readonly string[]
}): string[]

export function checkNewsLines(o: {
  kinds: readonly string[]
  lineFor: (kind: string) => string
  name: string
}): string[]

export function checkRouteCoverage(o: {
  appDir: string
  apiRoot: string
  libDirs: Record<string, string>
  tileForPath: (path: string) => string | null
  tileNews: Record<string, TileNewsDecision>
  quietRoutes: Record<string, string>
  announce?: RegExp
  exempt?: (path: string) => boolean
  ignoreLibs?: readonly string[]
}): { checked: string[]; silent: string[]; stale: string[] }

/** What a tile says about itself: its one line (at most 140 characters), what it is for and when to open it (at most 300 each). */
export interface TileAbout { purpose: string; for: string; when: string }

/** Principle 13: every tile declares its about, and the home links to the app's About page. */
export function checkTileAbout(o: {
  tiles: readonly string[]
  about: Record<string, TileAbout>
  aboutHref: string
  /** The home page's source; the About page's path must appear in it as a string, outside comments. */
  homeSource: string
}): string[]

/** True when a route file exports a POST, PATCH or PUT handler in any shape, ignoring comments and strings. */
export function isWriteRoute(src: string): boolean
