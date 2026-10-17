'use client'
import Link from 'next/link'
import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import type { Attachment, ContextItem, Draft, Member, RoomView as View } from '@/lib/rooms/types'
import { bytesLabel, eventLine, isChat, memberLabel, postedAtLabel, saidAtLabel, seenAgo, sideOf } from '@/lib/rooms/labels'
import { houseRules } from '@/lib/rooms/housekeeping'
import { SignIn } from '../../sign-in'

// Read-only, by design: the room's members are Plumas. A person speaks through their own Pluma,
// in their own chat, and reads here. There is no composer and no button that writes.
export function RoomView({ id }: { id: string }) {
  const [open, setOpen] = useState<Attachment | null>(null)
  const [tab, setTab] = useState<'thread' | 'context'>('thread')
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
  const library = v.context ?? []
  const draws = (list: unknown) => <DrawsOn list={list} library={library} onOpen={() => setTab('context')} />

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

      <nav aria-label="Views" className="hairline flex gap-6 border-b pt-3 text-xs uppercase tracking-[0.2em]">
        {(['thread', 'context'] as const).map((t) => (
          <button key={t} type="button" onClick={() => setTab(t)} aria-current={tab === t ? 'page' : undefined}
            className={`-mb-px border-b-2 pb-2 ${tab === t ? 'border-bronze text-marble' : 'border-transparent text-bronze'}`}>
            {t === 'thread' ? 'Thread' : `Context · ${library.filter((c) => !c.retired).length}`}
          </button>
        ))}
      </nav>

      {tab === 'context' && <Library roomId={id} items={library} members={v.members} purged={!!v.room.contextPurgedAt} />}

      <section aria-label="Thread" hidden={tab !== 'thread'} className="flex-1 py-4">
        <ol className="space-y-3">
          {v.events.map((e, n) => {
            const who = memberLabel(v.members, e.by)
            const side = sideOf(v.members, v.you, e.by)
            const right = side === 'right'
            if (e.type === 'draft.version') {
              const d = v.drafts.find((x) => x.id === e.draft)
              if (d && d.latest === e.version) return <DraftCard key={e.seq} draft={d} ownerName={ownerName(d.owner)} by={who} show={show} draws={draws} now={now} right={right} />
            }
            if (!isChat(e.type)) {
              return (
                <li key={e.seq} className="px-6 text-center text-xs text-mist/50">
                  <span className="text-mist/70">{who.name}</span> {eventLine(e, v.members, objectiveTitles)}<Posted at={e.at} now={now} />
                </li>
              )
            }
            // A run of posts from one member shows the name once, as a messaging app does.
            const prev = v.events[n - 1]
            const sameRun = prev && prev.by === e.by && isChat(prev.type) && e.at - prev.at < 10 * 60_000
            return (
              <li key={e.seq} className={`flex flex-col ${right ? 'items-end' : 'items-start'}`}>
                {!sameRun && (
                  <div className={`mb-1 px-1 text-xs ${right ? 'text-right' : ''}`}>
                    <span className="text-marble">{who.name}</span>{who.note && <span className="text-mist/50"> · {who.note}</span>}<Posted at={e.at} now={now} />
                  </div>
                )}
                <div className={`max-w-[85%] rounded-2xl px-4 py-2 ${right ? 'rounded-br-md bg-bronze/25 text-marble' : 'rounded-bl-md bg-mist/10 text-mist'}`}>
                  {e.type === 'message' && e.text ? <p className="whitespace-pre-wrap">{String(e.text)}</p> : null}
                  {e.type === 'context.add' && <p className="text-sm">{eventLine(e, v.members, objectiveTitles)}</p>}
                  {(e.type === 'message' || e.type === 'decision') && show(e.attachments)}
                  {(e.type === 'message' || e.type === 'decision') && draws(e.context)}
                  {e.type === 'decision' && (
                    <div className="border-l-2 border-decisions pl-3">
                      <p className="text-sm text-mist/70">{eventLine(e, v.members, objectiveTitles)}</p>
                      <p className="mt-1 text-marble">&ldquo;{String(e.words)}&rdquo;</p>
                      <p className="text-xs text-mist/60">{`${ownerName(String(e.owner))}, ${saidAtLabel(String(e.saidAt))}`}</p>
                    </div>
                  )}
                </div>
                {sameRun && <Posted at={e.at} now={now} className="mt-0.5 px-1" />}
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

/** When a post landed, in the reader's own time zone. */
function Posted({ at, now, className = '' }: { at: number; now: number; className?: string }) {
  const label = postedAtLabel(at, now)
  if (!label) return null
  return <time dateTime={new Date(at).toISOString()} suppressHydrationWarning className={`text-xs text-mist/50 ${className}`}>{className ? label : ` · ${label}`}</time>
}

function DraftCard({ draft, ownerName, by, show, draws, now, right }: { draft: Draft; ownerName: string; by: { name: string; note: string }; show: (list: unknown) => React.ReactNode; draws: (list: unknown) => React.ReactNode; now: number; right: boolean }) {
  const latest = draft.versions.find((x) => x.n === draft.latest)!
  const decision = draft.decisions.filter((a) => a.version === latest.n && a.fingerprint === latest.fingerprint).at(-1)
  return (
    <li className={`max-w-[92%] rounded-2xl border border-craft/60 p-4 ${right ? 'ml-auto rounded-br-md' : 'mr-auto rounded-bl-md'}`}>
      <div className="text-xs uppercase tracking-[0.2em] text-craft">Draft · version {latest.n} · for {ownerName}</div>
      <div className="mt-1 font-display text-xl text-marble">{draft.title}</div>
      <p className="mt-2 whitespace-pre-wrap text-mist">{latest.text}</p>
      {show(latest.attachments)}
      {draws(latest.context)}
      <div className="mt-2 text-xs text-mist/60">from {by.name}<Posted at={latest.at} now={now} /> · fingerprint {latest.fingerprint.slice(0, 12)}</div>
      <div className="mt-2 text-sm text-craft">
        {decision ? (decision.verdict === 'approve' ? `Approved by ${ownerName}` : `${ownerName} asked for changes`) : `Waiting on ${ownerName}, through their Pluma`}
      </div>
    </li>
  )
}

/** The library items a post draws on, by name; a tap opens the Context tab. */
function DrawsOn({ list, library, onOpen }: { list: unknown; library: ContextItem[]; onOpen: () => void }) {
  if (!Array.isArray(list) || list.length === 0) return null
  const names = (list as string[]).map((sha) => library.find((c) => c.sha256 === sha)?.name ?? `${sha.slice(0, 12)}`)
  return (
    <button type="button" onClick={onOpen} className="mt-1 block text-left text-xs text-mist/60 underline decoration-mist/30 underline-offset-2">
      Draws on {names.join(', ')}
    </button>
  )
}

const ask = async (roomId: string, sha: string, inline: boolean): Promise<string> => {
  const r = await fetch(`/api/rooms/${roomId}/context/${sha}${inline ? '?inline=1' : ''}`)
  if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error ?? 'could not open the file')
  return (await r.json()).downloadUrl as string
}

/** Previews stay small on a phone: an image or a short video is shown inline, anything else is a download. */
const previewKind = (c: ContextItem): 'image' | 'video' | null =>
  c.contentType.startsWith('image/') && c.size <= 25 * 1024 ** 2 ? 'image'
    : c.contentType.startsWith('video/') && c.size <= 200 * 1024 ** 2 ? 'video' : null

function Library({ roomId, items, members, purged }: { roomId: string; items: ContextItem[]; members: Member[]; purged: boolean }) {
  const newestFirst = [...items].sort((a, b) => b.at - a.at)
  return (
    <section aria-label="Context" className="flex-1 py-4">
      <p className="text-sm text-mist/70">What the work draws on, and why each file is here.</p>
      <ul className="mt-4 space-y-4">
        {newestFirst.map((c) => <ContextCard key={c.sha256} roomId={roomId} c={c} members={members} purged={purged} />)}
        {items.length === 0 && <li className="text-sm text-mist/70">Nothing in the library yet. A Pluma adds a file with a reason it matters.</li>}
      </ul>
      <div className="hairline mt-6 border-t pt-4">
        <h2 className="text-xs uppercase tracking-[0.2em] text-bronze">House rules</h2>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-mist/70">
          {houseRules().map((r) => <li key={r}>{r}</li>)}
        </ul>
      </div>
    </section>
  )
}

function ContextCard({ roomId, c, members, purged }: { roomId: string; c: ContextItem; members: Member[]; purged: boolean }) {
  const [err, setErr] = useState<string | null>(null)
  const gone = c.retired || purged
  const kind = gone ? null : previewKind(c)
  const preview = useQuery({ queryKey: ['context-inline', roomId, c.sha256], enabled: !!kind, staleTime: 10 * 60_000, queryFn: () => ask(roomId, c.sha256, true) })
  const who = memberLabel(members, c.from)
  const download = async () => {
    setErr(null)
    try { window.location.assign(await ask(roomId, c.sha256, false)) } catch (e) { setErr((e as Error).message) }
  }
  return (
    <li className={`border p-4 ${gone ? 'border-mist/15 opacity-70' : 'border-bronze/50'}`}>
      <div className="break-words font-display text-lg text-marble">{c.name}</div>
      <div className="mt-1 text-xs text-mist/60">brought by {who.name}{who.note && `, ${who.note}`} · {bytesLabel(c.size)}</div>
      <p className="mt-2 whitespace-pre-wrap text-mist">{c.why}</p>
      {kind === 'image' && preview.data && (
        // eslint-disable-next-line @next/next/no-img-element -- a 15-minute signed address from this host's private bucket; no optimizer may fetch it
        <img src={preview.data} alt={c.name} loading="lazy" className="mt-3 h-auto max-h-[60vh] w-full border border-mist/20 object-contain" />
      )}
      {kind === 'video' && preview.data && (
        <video src={preview.data} controls playsInline preload="metadata" className="mt-3 max-h-[60vh] w-full border border-mist/20" />
      )}
      {c.notes.length > 0 && (
        <ul className="mt-3 space-y-1 border-l-2 border-bronze/40 pl-3">
          {c.notes.map((n, i) => <li key={i} className="text-sm text-mist/80"><span className="text-marble">{memberLabel(members, n.member).name}:</span> {n.text}</li>)}
        </ul>
      )}
      <div className="mt-3 text-sm">
        {c.retired ? <span className="text-mist/60">Retired; the file is deleted and this record stays.</span>
          : purged ? <span className="text-mist/60">Deleted after the room closed; this record stays.</span>
            : <button type="button" onClick={download} className="text-bronze underline underline-offset-2">Download</button>}
        {err && <span className="ml-2 text-craft">{err}</span>}
      </div>
    </li>
  )
}
