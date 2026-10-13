export interface HomeScreenConfig {
  /** Routes that are the app's home and need no Back. Default ['/']. */
  home?: readonly string[]
  /** The Back component's name. Default 'Back'. */
  back?: string
  /** The Back component's file, relative to the repo. Default 'src/app/components/back.tsx'. */
  backFile?: string
  /** Route -> why it has no Back. An empty reason, or a route with no screen, is a problem. */
  exempt?: Record<string, string>
  /** Relative to the repo. Default 'src/app'. */
  appDir?: string
  /** Relative to the repo. Default 'src/app/globals.css'. */
  globalCss?: string
  /** How many imports deep a page may render Back through. Default 2. */
  depth?: number
}

export function checkHomeScreen(o: { repo: string } & HomeScreenConfig): {
  ok: boolean
  problems: string[]
  exempted: [string, string][]
  checked: string[]
}

export function checkBackControls(o: {
  repo: string
  appDir?: string
  home?: readonly string[]
  back?: string
  exempt?: Record<string, string>
  aliases?: Record<string, string>
  depth?: number
}): {
  checked: string[]
  missing: { route: string; file: string }[]
  exempted: [string, string][]
  stale: string[]
  problems: string[]
}

/** The Back component draws itself pinned (`sticky`) or floating (`fixed`), so it stays in reach mid-page. */
export function checkBackReach(o: { repo: string; backFile?: string; back?: string }): { problems: string[] }

export function checkInputFontSizes(o: { repo: string; globalCss?: string; srcDir?: string }): { problems: string[] }

/** The URL a page file serves, without route groups or parallel slots. */
export function routeOf(appDir: string, file: string): string

/** Every input, textarea and select opening tag in a source file. */
export function tagsIn(src: string): { tag: 'input' | 'textarea' | 'select'; attrs: string; line: number }[]

/** Comments and string literals blanked, length and newlines kept. */
export function blankNonCode(src: string): string
