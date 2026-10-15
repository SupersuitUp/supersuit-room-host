import { describe, it, expect } from 'vitest'
import { devFixtureEnabled, seedDevFixture, DEV_SESSION } from './dev-fixture'
import * as rooms from './service'

describe('the development fixture', () => {
  it('runs only under next dev with the flag on, never in production', () => {
    expect(devFixtureEnabled({ NODE_ENV: 'development', ROOMS_DEV_FIXTURE: '1' })).toBe(true)
    expect(devFixtureEnabled({ NODE_ENV: 'production', ROOMS_DEV_FIXTURE: '1' })).toBe(false)
    expect(devFixtureEnabled({ NODE_ENV: 'development' })).toBe(false)
  })

  it('seeds a room with objectives, two agents, a test identity and a draft awaiting its owner', async () => {
    const { ctx, roomId } = await seedDevFixture()
    expect(await rooms.personForSession(ctx, DEV_SESSION)).toBe('ada')
    const v = await rooms.read(ctx, { kind: 'person', person: 'ada' }, roomId, 0)
    expect(v.objectives.length).toBeGreaterThan(1)
    expect(v.members.filter((m) => m.kind === 'agent').length).toBe(2)
    expect(v.members.some((m) => m.kind === 'agent' && m.test)).toBe(true)
    expect(v.drafts[0].owner).toBe('ada')
    expect(rooms.isApproved(v.drafts[0])).toBe(false)
  })
})
