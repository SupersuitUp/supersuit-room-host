'use client'
import { useQuery } from '@tanstack/react-query'
import { tetherLog, TetherLogView, type TetherInput } from '@/lib/tether-log/index.ts'
import '@/lib/tether-log/tether-log.css'

// The host's door to the tether log: it reads from the host, so it works with every computer asleep.
export function TetherPage({ id }: { id: string }) {
  const q = useQuery({
    queryKey: ['tether-log', id],
    refetchInterval: 15_000,
    queryFn: async () => {
      const r = await fetch(`/api/rooms/${id}/log`)
      if (!r.ok) throw new Error('could not load')
      return (await r.json()) as TetherInput
    },
  })
  if (!q.data) return <main className="p-6 text-mist/70">Opening.</main>
  return <TetherLogView model={tetherLog(q.data)} mode="member" checkedBy="host" />
}
