import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { authDomainFor, authProxyRewrites } from './auth-domain'

// Google's account chooser says "continue to <authDomain>". With the project default it read
// "continue to cci-paos-analytics.firebaseapp.com"; through our own host it names rooms.supersuit.co.
describe('sign-in through our own host', () => {
  it('the production host signs in through itself', () => {
    expect(authDomainFor('rooms.supersuit.co', 'cci-paos-analytics.firebaseapp.com')).toBe('rooms.supersuit.co')
  })

  it('any other host keeps the configured domain, whose redirect URI is registered', () => {
    for (const h of ['supersuit-room-host-git-x.vercel.app', 'localhost:3000', '', undefined]) {
      expect(authDomainFor(h, 'cci-paos-analytics.firebaseapp.com')).toBe('cci-paos-analytics.firebaseapp.com')
    }
  })

  it('proxies /__/auth to the configured project, and adds nothing when no project is configured', () => {
    expect(authProxyRewrites('cci-paos-analytics')).toEqual([
      { source: '/__/auth/:path*', destination: 'https://cci-paos-analytics.firebaseapp.com/__/auth/:path*' },
    ])
    expect(authProxyRewrites(undefined)).toEqual([])
  })

  it('is wired into next.config and the browser client', () => {
    expect(readFileSync('next.config.ts', 'utf8')).toMatch(/authProxyRewrites\(process\.env\.NEXT_PUBLIC_FIREBASE_PROJECT_ID\)/)
    expect(readFileSync('src/lib/client/firebase.ts', 'utf8')).toMatch(/authDomainFor\(/)
  })
})
