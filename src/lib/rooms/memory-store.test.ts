import { describe, it, expect } from 'vitest'
import { MemoryStore } from './memory-store'

describe('the memory store behaves like Firestore where it matters', () => {
  it('refuses a read after a write inside one transaction, as Firestore does', async () => {
    const s = new MemoryStore()
    await expect(s.transaction(async (tx) => { tx.set('a/1', { x: 1 }); await tx.get('a/2') })).rejects.toThrow(/reads to be executed before all writes/)
  })

  it('applies nothing when the transaction throws', async () => {
    const s = new MemoryStore()
    await s.transaction(async (tx) => { tx.set('a/1', { x: 1 }) }).catch(() => {})
    await s.transaction(async (tx) => { tx.set('a/2', { x: 2 }); throw new Error('no') }).catch(() => {})
    expect(await s.get('a/2')).toBeNull()
  })
})
