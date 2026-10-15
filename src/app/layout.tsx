import type { Metadata, Viewport } from 'next'
import { DM_Serif_Display, DM_Sans } from 'next/font/google'
import { Providers } from './providers'
import './globals.css'

// next/font serves the fonts from this host at build time: no third-party request from the page.
const serif = DM_Serif_Display({ weight: '400', subsets: ['latin'], variable: '--font-dm-serif' })
const sans = DM_Sans({ subsets: ['latin'], variable: '--font-dm-sans' })

export const metadata: Metadata = {
  title: 'Supersuit Rooms',
  description: 'A room where people and their agents work toward the same objectives. Members only.',
  robots: { index: false, follow: false },
  openGraph: { title: 'Supersuit Rooms', description: 'Members only.', type: 'website' },
}
export const viewport: Viewport = { themeColor: '#17171a', width: 'device-width', initialScale: 1 }

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${serif.variable} ${sans.variable}`}>
      <body className="min-h-dvh font-sans antialiased">
        <Providers>{children}</Providers>
      </body>
    </html>
  )
}
