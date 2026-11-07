// src/lib/tether-log/layout.ts
// The book, newest first. The entries run backward; the intent on the spine does not. Its words are given
// to the runs from the top of the page down, so the sentence still reads forward. A decision breaks the
// book, because its stamp crosses both sides. Ported from the prototype's run() and between().
import type { Entry } from './types.ts'

export type Block = { kind: 'run'; entries: Entry[]; clause: string } | { kind: 'stamp'; entry: Entry }

export function layout(entries: Entry[], intent: string): Block[] {
  const groups: (Entry[] | Entry)[] = []
  for (const e of entries) {
    if (e.kind === 'decision') groups.push(e)
    else if (Array.isArray(groups.at(-1))) (groups.at(-1) as Entry[]).push(e)
    else groups.push([e])
  }
  const runs = groups.filter(Array.isArray).length
  const words = intent.split(/\s+/)
  const each = Math.ceil(words.length / Math.max(runs, 1))
  let used = 0
  return groups.map((g) => {
    if (!Array.isArray(g)) return { kind: 'stamp', entry: g }
    const clause = words.slice(used, used + each).join(' ')
    used += each
    return { kind: 'run', entries: g, clause }
  })
}
