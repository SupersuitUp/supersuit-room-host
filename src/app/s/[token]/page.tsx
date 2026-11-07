import type { Metadata } from 'next'
import { getCtx } from '@/lib/server/ctx'
import * as rooms from '@/lib/rooms/service'
import { SharedLog } from './shared'

type P = { params: Promise<{ token: string }> }

export const dynamic = 'force-dynamic'

// OG meta with the title only (design: Sharing), so a link preview names the work and shows nothing else.
export async function generateMetadata({ params }: P): Promise<Metadata> {
  const s = await rooms.readShare(await getCtx(), (await params).token)
  const title = s ? s.room.name : 'Not shared'
  return { title, robots: { index: false, follow: false }, openGraph: { title, type: 'article' }, twitter: { card: 'summary', title } }
}

// A read-only page (v0.4), live only on every operator's yes. A revoked or unknown token says the same thing.
export default async function Shared({ params }: P) {
  const s = await rooms.readShare(await getCtx(), (await params).token)
  if (!s) return <main className="mx-auto max-w-xl px-5 py-10 text-mist/80">This page is not shared.</main>
  return <SharedLog input={s} />
}
