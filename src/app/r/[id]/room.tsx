'use client'
import Link from 'next/link'
import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { Draft, RoomView as View } from '@/lib/rooms/types'
import { eventLine, memberLabel, seenAgo } from '@/lib/rooms/labels'
import { SignIn } from '../../sign-in'

async function call(path: string, method: string, body?: unknown) {
  const r = await fetch(path, { method, headers: { 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined })
  const data = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(data.error ?? 'that did not go through')
  return data
}

export function RoomView({ id }: { id: string }) {
  const qc = useQueryClient()
  const q = useQuery({
    queryKey: ['room', id],
    refetchInterval: 5_000,
    queryFn: async () => {
      const r = await fetch(`/api/rooms/${id}/events?after=0`)
      if (r.status === 401) return null
      if (r.status === 404) return 'gone' as const
      if (!r.ok) throw new Error('could not load')
      return (await r.json()) as View
    },
  })
  const refresh = () => qc.invalidateQueries({ queryKey: ['room', id] })

  if (q.isLoading) return <main className="p-6 text-mist/70">Opening.</main>
  if (q.data === null) return <SignIn onDone={refresh} />
  if (q.data === 'gone' || !q.data) return <main className="p-6 text-mist/70">This room is not here, or you are not one of its members.</main>
  const v = q.data
  const objectiveTitles = Object.fromEntries(v.objectives.map((o) => [o.id, o.title]))
  const ownerName = (person: string) => memberLabel(v.members, `p-${person}`).name
  const now = Date.now()

  return (
    <main className="mx-auto flex min-h-dvh max-w-xl flex-col px-5 pb-40 pt-6">
      <header className="hairline border-b pb-4">
        <Link href="/" className="text-sm text-mist/70">Back</Link>
        <h1 className="mt-2 font-display text-3xl text-marble">{v.room.name}</h1>
        <ul className="mt-2 text-sm text-mist/70">
          {v.members.map((m) => {
            const l = memberLabel(v.members, m.id)
            return (
              <li key={m.id}>
                <span className="text-mist">{l.name}</span>
                {l.note && <span>, {l.note}</span>}
                {m.kind === 'agent' && <span>, {seenAgo(m.lastSeenAt, now)}</span>}
              </li>
            )
          })}
        </ul>
      </header>

      <section aria-label="Objectives" className="hairline border-b py-4">
        <h2 className="text-xs uppercase tracking-[0.2em] text-bronze">Objectives</h2>
        <ul className="mt-2 space-y-2">
          {v.objectives.map((o) => (
            <li key={o.id} className="border-l-2 border-decisions pl-3">
              <div className="text-marble">{o.title}</div>
              <div className="text-sm text-mist/70">{ownerName(o.owner)} · <span className="text-decisions">{o.status}</span></div>
            </li>
          ))}
          {v.objectives.length === 0 && <li className="text-sm text-mist/70">No objectives pinned yet.</li>}
        </ul>
      </section>

      <section aria-label="Thread" className="flex-1 py-4">
        <ol className="space-y-4">
          {v.events.map((e) => {
            const who = memberLabel(v.members, e.by)
            if (e.type === 'draft.version') {
              const d = v.drafts.find((x) => x.id === e.draft)
              if (d && d.latest === e.version) return <DraftCard key={e.seq} draft={d} you={v.you} roomId={id} ownerName={ownerName(d.owner)} by={who} onDone={refresh} />
            }
            return (
              <li key={e.seq}>
                <div className="text-sm"><span className="font-display text-base text-marble">{who.name}</span>{who.note && <span className="text-mist/60"> · {who.note}</span>}</div>
                {e.type === 'message'
                  ? <p className="mt-1 whitespace-pre-wrap text-mist">{String(e.text)}</p>
                  : <p className="mt-1 text-sm text-mist/70">{eventLine(e, v.members, objectiveTitles)}</p>}
              </li>
            )
          })}
        </ol>
      </section>

      <Composer roomId={id} onDone={refresh} closed={v.room.state !== 'open'} />
    </main>
  )
}

function DraftCard({ draft, you, roomId, ownerName, by, onDone }: { draft: Draft; you: string; roomId: string; ownerName: string; by: { name: string; note: string }; onDone: () => void }) {
  const latest = draft.versions.find((x) => x.n === draft.latest)!
  const mine = you === `p-${draft.owner}`
  const verdict = draft.approvals.filter((a) => a.version === latest.n && a.fingerprint === latest.fingerprint).at(-1)
  const m = useMutation({
    mutationFn: (v: 'approve' | 'changes') => call(`/api/rooms/${roomId}/drafts/${draft.id}/approvals`, 'POST', { version: latest.n, fingerprint: latest.fingerprint, verdict: v }),
    onSuccess: onDone,
  })
  return (
    <li className="border border-craft/60 p-4">
      <div className="text-xs uppercase tracking-[0.2em] text-craft">Draft · version {latest.n} · for {ownerName}</div>
      <div className="mt-1 font-display text-xl text-marble">{draft.title}</div>
      <p className="mt-2 whitespace-pre-wrap text-mist">{latest.text}</p>
      <div className="mt-2 text-xs text-mist/60">from {by.name} · fingerprint {latest.fingerprint.slice(0, 12)}</div>
      {verdict && <div className="mt-2 text-sm text-craft">{verdict.verdict === 'approve' ? `Approved by ${ownerName}` : `${ownerName} asked for changes`}</div>}
      {mine && !verdict && (
        <div className="mt-4 flex gap-3">
          <button className="bg-craft px-4 py-2 text-night disabled:opacity-50" disabled={m.isPending} onClick={() => m.mutate('approve')}>Approve this version</button>
          <button className="hairline border px-4 py-2 text-marble disabled:opacity-50" disabled={m.isPending} onClick={() => m.mutate('changes')}>Ask for changes</button>
        </div>
      )}
      {m.error && <p className="mt-2 text-sm text-mist/70">{(m.error as Error).message}</p>}
    </li>
  )
}

function Composer({ roomId, onDone, closed }: { roomId: string; onDone: () => void; closed: boolean }) {
  const [text, setText] = useState('')
  const m = useMutation({
    mutationFn: () => call(`/api/rooms/${roomId}/messages`, 'POST', { text }),
    onSuccess: () => { setText(''); onDone() },
  })
  if (closed) return <p className="text-sm text-mist/70">This room is closed.</p>
  return (
    <form
      className="hairline fixed inset-x-0 bottom-0 border-t bg-night px-5 py-3"
      onSubmit={(e) => { e.preventDefault(); if (text.trim()) m.mutate() }}
    >
      <div className="mx-auto flex max-w-xl gap-3">
        <textarea
          aria-label="Message"
          className="hairline min-h-12 flex-1 resize-none border bg-transparent p-2 text-marble outline-none"
          rows={2}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Say something to the room"
        />
        <button className="hairline border px-4 text-marble disabled:opacity-50" disabled={m.isPending || !text.trim()}>Send</button>
      </div>
      {m.error && <p className="mx-auto mt-1 max-w-xl text-sm text-mist/70">{(m.error as Error).message}</p>}
    </form>
  )
}
