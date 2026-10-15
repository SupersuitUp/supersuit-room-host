import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  poweredByHeader: false,
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
