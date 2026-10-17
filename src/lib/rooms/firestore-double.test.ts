import { describe, it, expect } from 'vitest'
import { readFileSync, cpSync, mkdtempSync, appendFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { DEST, check } from '../../../scripts/vendor-firestore-double.mjs'
import { MemoryStore } from './memory-store'

// The test store is the production FirestoreStore on @supersuit/firestore-double, the strict double
// shared with the account server. These hold that it stays that way: the vendored copy is intact,
// and memory-store.ts never grows its own transaction rules again (a laxer copy of them let
// retireMember's read-after-write through on 2026-10-15).
describe('the shared Firestore double', () => {
  it('is vendored intact and refuses one changed byte', () => {
    const manifest = JSON.parse(readFileSync(join(DEST, 'VENDORED.json'), 'utf8'))
    expect(manifest.package).toBe('@supersuit/firestore-double')
    expect(check().problems).toEqual([])
    const dir = mkdtempSync(join(tmpdir(), 'firestore-double-vendor-'))
    try {
      cpSync(DEST, dir, { recursive: true })
      appendFileSync(join(dir, 'src', 'index.mjs'), ' ')
      expect(check(dir).problems).toEqual(['edited by hand: src/index.mjs'])
    } finally { rmSync(dir, { recursive: true, force: true }) }
  })

  it("backs the test store, which therefore refuses a read after a write with Firestore's message", async () => {
    const src = readFileSync(new URL('./memory-store.ts', import.meta.url), 'utf8')
    expect(src).toMatch(/from '\.\.\/vendor\/firestore-double\/src\/index\.mjs'/)
    expect(src).toMatch(/extends FirestoreStore/)
    expect(src).not.toMatch(/transaction\s*</)
    const s = new MemoryStore()
    await expect(s.transaction(async (tx) => { tx.set('a/1', { x: 1 }); await tx.get('a/2') }))
      .rejects.toThrow('Firestore transactions require all reads to be executed before all writes.')
  })
})
