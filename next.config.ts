import type { NextConfig } from 'next'
import { authProxyRewrites } from './src/lib/client/auth-domain'

const nextConfig: NextConfig = {
  poweredByHeader: false,
  // Firebase's sign-in handler, served through this host (src/lib/client/auth-domain.ts).
  async rewrites() {
    return authProxyRewrites(process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID)
  },
  async headers() {
    return [{
      source: '/:path*',
      headers: [
        // Only members read a room: never indexed by anything that reads headers rather than the page.
        { key: 'X-Robots-Tag', value: 'noindex, nofollow' },
        { key: 'Referrer-Policy', value: 'no-referrer' },
        { key: 'X-Content-Type-Options', value: 'nosniff' },
      ],
    }]
  },
}
export default nextConfig
