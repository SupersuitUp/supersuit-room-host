'use client'
import { useEffect, useState } from 'react'
import { tetherLog, TetherLogView, type TetherInput } from '@/lib/tether-log/index.ts'
import '@/lib/tether-log/tether-log.css'

// The view groups entries by day in the reader's own time zone, which the server cannot know. So the
// server draws the name only, and the view draws once the page is in the reader's browser.
export function SharedLog({ input }: { input: TetherInput }) {
  const [here, setHere] = useState(false)
  useEffect(() => { setHere(true) }, [])
  if (!here) return <main className="mx-auto max-w-xl px-5 py-10"><h1 className="font-display text-3xl text-marble">{input.room.name}</h1><p className="mt-3 text-mist/70">Opening.</p></main>
  return <TetherLogView model={tetherLog(input)} mode="shared" checkedBy="host" aboutHref="https://rooms.supersuit.co/about" />
}
