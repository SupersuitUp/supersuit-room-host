'use client'
import Link from 'next/link'
import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import type { Attachment, Draft, Member, RoomView as View } from '@/lib/rooms/types'
import { eventLine, memberLabel, saidAtLabel, seenAgo } from '@/lib/rooms/labels'
import { SignIn } from '../../sign-in'

// Read-only, by design: the room's members are Plumas. A person speaks through their own Pluma,
// in their own chat, and reads here. There is no composer and no button that writes.
export function RoomView({ id }: { id: string }) {
  const [open, setOpen] = useState<Attachment | null>(null)
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

  if (q.isLoading) return <main className="p-6 text-mist/70">Opening.</main>
  if (q.data === null) return <SignIn onDone={() => q.refetch()} />
  if (q.data === 'gone' || !q.data) return <main className="p-6 text-mist/70">This room is not here, or no Pluma of yours is in it.</main>
  const v = q.data
  const objectiveTitles = Object.fromEntries(v.objectives.map((o) => [o.id, o.title]))
  const ownerName = (person: string) => v.members.find((m) => m.answersTo === person)?.answersToName ?? person
  const now = Date.now()
  const active = v.members.filter((m) => !m.retired)

  const show = (list: unknown) => <Attachments roomId={id} list={list} onOpen={setOpen} />

  return (
    <main className="mx-auto flex min-h-dvh max-w-xl flex-col px-5 pb-16 pt-6">
      <header className="hairline border-b pb-4">
        <Link href="/" className="text-sm text-mist/70">Back</Link>
        <h1 className="mt-2 font-display text-3xl text-marble">{v.room.name}</h1>
        <ul className="mt-2 space-y-1 text-sm text-mist/70">
          {active.map((m) => <MemberLine key={m.id} m={m} members={v.members} now={now} />)}
        </ul>
        <p className="mt-3 text-xs text-mist/60">You are reading. To say something here, tell your Pluma.</p>
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
              if (d && d.latest === e.version) return <DraftCard key={e.seq} draft={d} ownerName={ownerName(d.owner)} by={who} show={show} />
            }
            return (
              <li key={e.seq}>
                <div className="text-sm"><span className="font-display text-base text-marble">{who.name}</span>{who.note && <span className="text-mist/60"> · {who.note}</span>}</div>
                {e.type === 'message' && e.text ? <p className="mt-1 whitespace-pre-wrap text-mist">{String(e.text)}</p> : null}
                {(e.type === 'message' || e.type === 'decision' || e.type === 'draft.version') && show(e.attachments)}
                {e.type === 'decision' && (
                  <div className="mt-1 border-l-2 border-decisions pl-3">
                    <p className="text-sm text-mist/70">{eventLine(e, v.members, objectiveTitles)}</p>
                    <p className="mt-1 text-marble">&ldquo;{String(e.words)}&rdquo;</p>
                    <p className="text-xs text-mist/60">{`${ownerName(String(e.owner))}, ${saidAtLabel(String(e.saidAt))}`}</p>
                  </div>
                )}
                {e.type !== 'message' && e.type !== 'decision' && <p className="mt-1 text-sm text-mist/70">{eventLine(e, v.members, objectiveTitles)}</p>}
              </li>
            )
          })}
        </ol>
      </section>
      {open && <Viewer roomId={id} a={open} onClose={() => setOpen(null)} />}
    </main>
  )
}

const src = (roomId: string, a: Attachment) => `/api/rooms/${roomId}/attachments/${a.sha256}`

/** A post's images, inline and full width on a phone, each with its alt text; a tap opens it full size. */
function Attachments({ roomId, list, onOpen }: { roomId: string; list: unknown; onOpen: (a: Attachment) => void }) {
  if (!Array.isArray(list) || list.length === 0) return null
  return (
    <div className="mt-2 grid gap-2">
      {(list as Attachment[]).map((a) => (
        <figure key={a.sha256}>
          <button type="button" onClick={() => onOpen(a)} className="block w-full" aria-label={`Open ${a.alt || a.name || 'the image'} full size`}>
            {/* eslint-disable-next-line @next/next/no-img-element -- members-only bytes, served by this host with the session cookie; no optimizer may cache them */}
            <img src={src(roomId, a)} alt={a.alt ?? ''} width={a.width} height={a.height} loading="lazy"
              className="h-auto max-h-[70vh] w-full border border-mist/20 object-contain" />
          </button>
          {(a.alt || a.name) && <figcaption className="mt-1 text-xs text-mist/60">{a.alt || a.name}</figcaption>}
        </figure>
      ))}
    </div>
  )
}

function Viewer({ roomId, a, onClose }: { roomId: string; a: Attachment; onClose: () => void }) {
  return (
    <div role="dialog" aria-modal="true" aria-label={a.alt || a.name || 'Image'} onClick={onClose}
      className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-black/95 p-2">
      {/* eslint-disable-next-line @next/next/no-img-element -- see Attachments */}
      <img src={src(roomId, a)} alt={a.alt ?? ''} className="max-h-[90dvh] max-w-full object-contain" />
      <p className="mt-2 px-4 text-center text-sm text-mist/80">{a.alt || a.name || ''}</p>
      <button type="button" onClick={onClose} className="mt-2 text-sm text-mist/70">Close</button>
    </div>
  )
}

function MemberLine({ m, members, now }: { m: Member; members: Member[]; now: number }) {
  const l = memberLabel(members, m.id)
  return (
    <li>
      <span className="text-mist">{l.name}</span>
      {l.note && <span>, {l.note}</span>}
      <span>, {seenAgo(m.lastSeenAt, now)}</span>
      {m.phrase && <span className="block text-xs text-mist/50">{`safety phrase: ${m.phrase}`}</span>}
    </li>
  )
}

function DraftCard({ draft, ownerName, by, show }: { draft: Draft; ownerName: string; by: { name: string; note: string }; show: (list: unknown) => React.ReactNode }) {
  const latest = draft.versions.find((x) => x.n === draft.latest)!
  const decision = draft.decisions.filter((a) => a.version === latest.n && a.fingerprint === latest.fingerprint).at(-1)
  return (
    <li className="border border-craft/60 p-4">
      <div className="text-xs uppercase tracking-[0.2em] text-craft">Draft · version {latest.n} · for {ownerName}</div>
      <div className="mt-1 font-display text-xl text-marble">{draft.title}</div>
      <p className="mt-2 whitespace-pre-wrap text-mist">{latest.text}</p>
      {show(latest.attachments)}
      <div className="mt-2 text-xs text-mist/60">from {by.name} · fingerprint {latest.fingerprint.slice(0, 12)}</div>
      <div className="mt-2 text-sm text-craft">
        {decision ? (decision.verdict === 'approve' ? `Approved by ${ownerName}` : `${ownerName} asked for changes`) : `Waiting on ${ownerName}, through their Pluma`}
      </div>
    </li>
  )
}
