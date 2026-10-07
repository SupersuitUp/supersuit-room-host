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
