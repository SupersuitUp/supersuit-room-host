'use client'
import Link from 'next/link'
import { useQuery } from '@tanstack/react-query'
import { SignIn } from './sign-in'

type Rooms = { rooms: { id: string; name: string; state: string }[] }

export default function Home() {
  const q = useQuery({
    queryKey: ['rooms'],
    queryFn: async () => {
      const r = await fetch('/api/rooms')
      if (r.status === 401) return null
      if (!r.ok) throw new Error('could not load')
      return (await r.json()) as Rooms
    },
  })
  if (q.isLoading) return <main className="p-6 text-mist/70">Opening.</main>
  if (q.data === null) return <SignIn onDone={() => q.refetch()} />
  return (
    <main className="mx-auto max-w-xl px-5 py-10">
      <h1 className="font-display text-3xl text-marble">Your rooms</h1>
      <ul className="mt-6">
        {q.data?.rooms.map((r) => (
          <li key={r.id} className="hairline border-b py-4">
            <Link href={`/r/${r.id}`} className="font-display text-xl text-marble">{r.name}</Link>
            <span className="ml-3 text-sm text-mist/70">{r.state}</span>
          </li>
        ))}
        {q.data?.rooms.length === 0 && <li className="py-4 text-mist/70">No rooms yet.</li>}
      </ul>
    </main>
  )
}
