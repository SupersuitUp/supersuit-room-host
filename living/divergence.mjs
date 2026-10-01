// Which of the parent's files has this copy changed on purpose? Worked out fresh on every run
// from git itself, so the record cannot go stale the way a hand-kept list would.
//
// A file is divergent when the parent has it (outside the kept paths), this copy has committed
// a change to it since the two last met, and it still differs from the parent's version. Files
// only this copy has are its own additions, not divergence: that is what lets a template, which
// adds a whole app on top of the meta-template, report only the meta-template files it bent.
import { git, tryGit, lines, isKept } from './git.mjs'

export function divergence(repo, parentRef = 'template/main') {
  if (!tryGit(repo, 'rev-parse', '--verify', '--quiet', parentRef).ok) return []
  const base = git(repo, 'merge-base', 'HEAD', parentRef)
  const out = []
  for (const file of lines(git(repo, 'ls-tree', '-r', '--name-only', parentRef))) {
    if (isKept(file)) continue
    if (tryGit(repo, 'diff', '--quiet', 'HEAD', parentRef, '--', file).ok) continue
    // Changed by THIS copy: some commit on our side since the meeting point touched it, merges
    // included (a merge that resolved a conflict our way is a decision to diverge). Parent
    // commits already merged in are excluded by --not.
    const ours = git(repo, 'log', '--format=%H', 'HEAD', '--not', parentRef, '--', file)
    if (!ours) continue
    const parentChanges = lines(git(repo, 'log', '--format=%s', `${base}..${parentRef}`, '--', file))
    out.push({ file, parentChanges })
  }
  return out
}
