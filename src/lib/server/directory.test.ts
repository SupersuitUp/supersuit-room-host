import { describe, it, expect, afterEach, vi } from 'vitest'
import { genesisEntry, newDeviceKey } from '@supersuit/suit-identity'
import { suitDirectory } from './directory'

// The directory answer is replayed here, so a forged or mismatched log gives no keys.
afterEach(() => { vi.unstubAllGlobals() })
const answer = (status: number, body: unknown) => vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(body), { status })))

describe('suitDirectory', () => {
  it('gives the active keys of a log that verifies', async () => {
    const k = newDeviceKey()
    const g = genesisEntry({ priv: k.priv, device: 'mac', at: '2026-11-07T12:00:00.000Z' })
    answer(200, { suit: g.suit, log: [g] })
    expect(await suitDirectory('ada-lovelace')).toEqual({ suit: g.suit, keys: [k.pub] })
  })
  it('gives null for an unknown handle, a forged log, and a log for another suit', async () => {
    answer(404, { error: 'no such handle' })
    expect(await suitDirectory('nobody-here')).toBeNull()
    const k = newDeviceKey()
    const g = genesisEntry({ priv: k.priv, device: 'mac', at: '2026-11-07T12:00:00.000Z' })
    answer(200, { suit: g.suit, log: [{ ...g, key: newDeviceKey().pub }] })
    expect(await suitDirectory('ada-lovelace')).toBeNull()
    answer(200, { suit: 'ss1other', log: [g] })
    expect(await suitDirectory('ada-lovelace')).toBeNull()
  })
})
