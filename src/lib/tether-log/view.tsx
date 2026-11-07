// src/lib/tether-log/view.tsx
'use client'
// One view, two doors: the host page and the Helm tile draw this same file, so they cannot drift apart.
// It is the prototype ledger-newest-first.html, ported. It writes nothing: people never post.
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { COPY, TERMS, type Part, type TermKey } from './terms.ts'
import { abs, clock, dayKey, dayLabel, dayName, rel } from './time.ts'
import { layout } from './layout.ts'
import type { Check, Entry, TetherLogModel } from './types.ts'

type Mode = 'member' | 'shared'
type Words = { seen: Set<TermKey>; mode: Mode }

function say(parts: readonly Part[], w: Words): ReactNode[] {
  return parts.map((p, i) => {
    if (typeof p === 'string') return p
    const t = TERMS[p.term], full = p.plural ? t.plural : t.label
    const label = p.lower ? full[0].toLowerCase() + full.slice(1) : full
    if (w.seen.has(p.term)) return <span key={i}>{label}</span>
    w.seen.add(p.term)
    if (w.mode === 'shared') return <span key={i}>{label} ({t.gloss})</span>
    return <span key={i}>{label}<a className="tl-i" href={t.url} aria-label={`What ${t.label} means`}>ⓘ</a></span>
  })
}

const Tick = ({ check }: { check: Check }) => check === 'failed'
  ? <span className="tl-failed" role="img" aria-label="This post failed its signature check">✕</span>
  : check === 'signed' ? <svg className="tl-tick" viewBox="0 0 17 15" aria-hidden="true"><path pathLength="1" d="M2 8.5 6.4 13 15 2" /></svg> : null

const When = ({ at, now, stack = false, right = false }: { at: number; now: number; stack?: boolean; right?: boolean }) => (
  <span className={`tl-when ${stack ? 'tl-stack' : ''} ${right ? 'tl-right' : ''}`}>
    <time className="tl-rel" dateTime={new Date(at).toISOString()} suppressHydrationWarning>{rel(at, now)}</time>
    <time className="tl-abs" dateTime={new Date(at).toISOString()} suppressHydrationWarning>{abs(at)}</time>
  </span>
)

const Reversal = ({ e }: { e: Entry }) => <>
  {e.reversedBy !== undefined && <a className="tl-rev" href={`#tl-e${e.reversedBy}`}>Reversed at No. {e.reversedBy}</a>}
  {e.reverses.length > 0 && <span className="tl-rev">Reverses {e.reverses.map((n, i) => <span key={n}>{i ? ' and ' : ''}<a href={`#tl-e${n}`}>No. {n}</a></span>)}</span>}
</>

function EntryBody({ e, now, open }: { e: Entry; now: number; open(e: Entry): void }) {
  if (e.kind === 'said') return (
    <><button type="button" className={`tl-said ${e.no % 2 ? 'tl-b' : ''}`} id={`tl-e${e.no}`} data-strike onClick={() => open(e)} aria-label={`Entry ${e.no}, words from ${e.saidBy}, carried by ${e.carriedBy}. Open proof and signature.`}>
      <span className="tl-who"><span>{e.saidBy}, No. {e.no}</span><Tick check={e.check} /></span><When at={e.at} now={now} stack />
      <q>{e.words}</q>{e.text && <small className="tl-did">{e.text}</small>}<small>{`Carried by ${e.carriedBy}`}</small>
    </button><Reversal e={e} /></>
  )
  return (
    <><button type="button" className="tl-entry" id={`tl-e${e.no}`} data-n={e.no} onClick={() => open(e)} aria-label={`Entry ${e.no}, ${e.who}. Open proof and signature.`}>
      <span className="tl-no"><time className="tl-rel" suppressHydrationWarning>{rel(e.at, now)}</time><span className="tl-nr">No. {e.no}<Tick check={e.check} /></span></span>
      <time className="tl-abs" suppressHydrationWarning>{abs(e.at)}</time>
      <p>{e.kind === 'redacted' ? 'This post was taken back. Nothing of it remains here.' : e.text}</p>
      {e.proof.map((p) => <span key={p.label} className="tl-proof">{p.label}</span>)}
    </button><Reversal e={e} /></>
  )
}

function Stamp({ e, now, open, noReason }: { e: Entry; now: number; open(e: Entry): void; noReason: ReactNode }) {
  return (
    <div className={`tl-stamp ${e.no % 2 ? 'tl-tilt' : ''}`} data-strike><div className="tl-plate">
      <span className="tl-top"><span>{e.saidBy}&rsquo;s decision, No. {e.no}</span><Tick check={e.check} /></span><When at={e.at} now={now} />
      <q className="tl-ink">{e.words}</q>
      <span className="tl-foot">
        <span className="tl-seals"><span className="tl-seal">{e.saidBy?.[0]}</span></span>
        <small style={{ textAlign: 'right' }}>{`${e.verdict === 'approve' ? 'Approved' : 'Asked for changes'}. Carried by ${e.carriedBy}`}<br />
          {e.rejected && <>Rejected: {e.rejected}<br />{e.reason ?? noReason}<br /></>}{!e.rejected && e.reason && <>{e.reason}<br /></>}<Reversal e={e} /></small>
      </span>
      <button type="button" className="tl-hit" id={`tl-e${e.no}`} data-n={e.no} onClick={() => open(e)} aria-label={`Entry ${e.no}, decision by ${e.saidBy}, carried by ${e.carriedBy}. Open proof and signature.`} />
    </div></div>
  )
}

const CHECK_WORDS: Record<Check, string> = {
  signed: 'Checked. The key of its author signed this post.', failed: 'This post failed its signature check. Do not rely on it.',
  unsigned: 'Not signed. This line is the log\'s own note, not a post.', host: 'The host wrote this line.', redacted: 'Taken back, so no signature remains.',
}

export function TetherLogView({ model: m, mode, checkedBy, aboutHref, notice, hostHref }: { model: TetherLogModel; mode: Mode; checkedBy: 'host' | 'mac'; aboutHref?: string; notice?: ReactNode; hostHref?: string }) {
  const w: Words = { seen: new Set(), mode }
  const [now, setNow] = useState(() => Date.now())
  const [sheet, setSheet] = useState<{ title: string; body: ReactNode } | null>(null)
  const dlg = useRef<HTMLDialogElement>(null)
  const book = useRef<HTMLElement>(null)
  const head = useRef<HTMLDivElement>(null)
  const [at, setAt] = useState(m.entries[0]?.no ?? 0)

  // Relative times stay true while the page is open.
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 15_000)
    const v = () => { if (!document.hidden) setNow(Date.now()) }
    addEventListener('visibilitychange', v)
    return () => { clearInterval(t); removeEventListener('visibilitychange', v) }
  }, [])
  useEffect(() => { if (sheet) dlg.current?.showModal?.(); else dlg.current?.close?.() }, [sheet])
  // A wide screen has room to keep Settled and Still open beside the intent, as the prototype does.
  const firstFold = useRef<HTMLDetailsElement>(null)
  useEffect(() => { if (firstFold.current && matchMedia('(min-width:760px)').matches) firstFold.current.open = true }, [])

  // The head counts each side up to the entry being read.
  useEffect(() => {
    let waiting = false
    const count = () => {
      waiting = false
      const line = (head.current?.getBoundingClientRect().bottom ?? 0) + 110
      let cur = m.entries[0]?.no ?? 0
      for (const el of book.current?.querySelectorAll<HTMLElement>('[id^="tl-e"]') ?? []) if (el.getBoundingClientRect().top < line) cur = Number(el.id.slice(4))
      setAt(cur)
    }
    const on = () => { if (!waiting) { waiting = true; requestAnimationFrame(count) } }
    addEventListener('scroll', on, { passive: true })
    return () => removeEventListener('scroll', on)
  }, [m.entries])

  // Stamps strike as they reach the reader. One beat each, once.
  useEffect(() => {
    if (matchMedia('(prefers-reduced-motion: reduce)').matches || !('IntersectionObserver' in window)) return
    const all = [...(book.current?.querySelectorAll('[data-strike]') ?? [])]
    all.forEach((s) => s.classList.add('tl-armed'))
    const io = new IntersectionObserver((es) => es.forEach((x) => { if (x.isIntersecting) { x.target.classList.remove('tl-armed'); x.target.classList.add('tl-struck'); io.unobserve(x.target) } }), { threshold: 0.01, rootMargin: '0px 0px -12% 0px' })
    all.forEach((s) => io.observe(s))
    return () => io.disconnect()
  }, [])

  const counted = (side: 'left' | 'right') => m.entries.filter((e) => e.side === side && e.no <= at).length
  const voucher = (e: Entry) => setSheet({ title: `Entry No. ${e.no}`, body: (
    <dl>
      <dt>When</dt><dd>{rel(e.at, now)}, {abs(e.at)}</dd>
      {e.words && <><dt>Said by</dt><dd>{e.saidBy}</dd><dt>Words</dt><dd className="tl-words">{e.words}</dd><dt>Carried by</dt><dd>{e.carriedBy}</dd></>}
      {!e.words && <><dt>Made by</dt><dd>{e.who}</dd><dt>Entry</dt><dd>{e.text ?? 'Taken back.'}</dd></>}
      {e.rejected && <><dt>Rejected</dt><dd>{e.rejected}</dd></>}
      <dt>Proof</dt><dd>{e.proof.length ? e.proof.map((p) => (p.href ? <a key={p.label} href={p.href}>{p.label}</a> : <span key={p.label}>{p.label}</span>)) : 'No proof on this entry.'}</dd>
      <dt>Signature</dt><dd>{CHECK_WORDS[e.check]}</dd>
    </dl>
  ) })
  const sigLine = m.signatures.failed
    ? `${m.signatures.failed} post${m.signatures.failed === 1 ? '' : 's'} failed its check. ${m.signatures.signed} of ${m.signatures.total} passed.`
    : `${m.signatures.signed} of ${m.signatures.total} posts passed.`
  const who = checkedBy === 'host' ? 'Checked by the host, which holds public keys only.' : 'Checked on your computer.'
  const blocks = layout(m.entries, m.intent)
  const noReason = say(COPY.noReason, w)
  let lastDay = m.entries[0] ? dayKey(m.entries[0].at) : ''
  // A day break, as the prototype draws it: the day's name on the left, its date on the right.
  const dayRow = (e: Entry, key: string, row: number) => {
    if (dayKey(e.at) === lastDay) return null
    lastDay = dayKey(e.at)
    return [
      <div className="tl-dayc" key={`${key}l`} style={{ gridRow: row }} suppressHydrationWarning>{dayName(e.at, now)}</div>,
      <div className="tl-dayc tl-r" key={`${key}r`} style={{ gridRow: row }} suppressHydrationWarning>{dayLabel(e.at)}</div>,
    ]
  }
  // A day break above a stamp still sits on the spine.
  const between = (e: Entry) => {
    const day = dayRow(e, `d${e.seq}`, 1)
    return day && <div className="tl-run"><div className="tl-spine tl-short" style={{ gridRow: 1 }} aria-hidden="true" />{day}</div>
  }
  // A run is one grid. Each entry takes one row, with an empty ruled cell on the other side, as the prototype does.
  // Where each tethered supersession started and ended: quiet lines between the entries, newest first,
  // each on its own Pluma's side. A tether is temporary; the room keeps the record.
  const marks = m.sittings.flatMap((s) => {
    const side = m.right && s.who === m.right.name && m.left.name !== s.who ? 'right' : 'left'
    const label = s.name ? `: ${s.name}` : ''
    const out = [{ seq: s.fromSeq, at: s.from, side, text: `${s.who} tethered${label}` }]
    if (s.to !== null && s.toSeq !== null) out.push({ seq: s.toSeq, at: s.to, side, text: `${s.who} ended${label}` })
    return out
  }).sort((a, b) => b.seq - a.seq)
  let nextMark = 0
  const markRows = (above: number, row: number) => {
    const cells: ReactNode[] = []
    while (nextMark < marks.length && marks[nextMark].seq > above) {
      const k = marks[nextMark++]
      cells.push(<div key={`k${k.seq}`} className={`tl-sit ${k.side === 'right' ? 'tl-r' : ''}`} style={{ gridRow: row + cells.length }} suppressHydrationWarning>{k.text}, {clock(k.at)}</div>)
    }
    return cells
  }
  const markRun = (above: number, key: string) => {
    const cells = markRows(above, 1)
    return cells.length > 0 && <div className="tl-run" key={key}><div className="tl-spine tl-short" style={{ gridRow: `1 / span ${cells.length}` }} aria-hidden="true" />{cells}</div>
  }
  const runBlock = (entries: Entry[], clause: string, key: string) => {
    let row = 1
    const cells: ReactNode[] = []
    for (const e of entries) {
      const sit = markRows(e.seq, row)
      cells.push(...sit)
      row += sit.length
      const day = dayRow(e, `d${e.seq}`, row)
      if (day) { cells.push(...day); row++ }
      const body = <EntryBody e={e} now={now} open={voucher} />
      cells.push(<div key={`l${e.seq}`} className="tl-cell" style={{ gridRow: row }}>{e.side === 'left' ? body : null}</div>)
      cells.push(<div key={`r${e.seq}`} className="tl-cell tl-r" style={{ gridRow: row }}>{e.side === 'right' ? body : null}</div>)
      row++
    }
    return <div className="tl-run" key={key}><div className="tl-spine" style={{ gridRow: `1 / span ${row - 1}` }} aria-hidden="true"><span>{clause}</span></div>{cells}</div>
  }

  return (
    <div className="tl">
      <svg width="0" height="0" style={{ position: 'absolute' }} aria-hidden="true"><filter id="ink" x="-2%" y="-2%" width="104%" height="104%"><feTurbulence type="fractalNoise" baseFrequency=".9" numOctaves={2} seed={7} result="n" /><feColorMatrix in="n" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 -2.2 2.05" /><feComposite in="SourceGraphic" operator="in" /></filter></svg>
      <div className="tl-wrap">
        <header className="tl-title">
          <div className="tl-lead">
            {/* A shared page keeps the bar to the name; its lead sentence defines it. */}
            {/* The room is the place; a tether is temporary. A shared page keeps the bar to the word. */}
            <div className="tl-bar"><b>{mode === 'shared' ? TERMS.room.label : say([{ term: 'room' }], w)}</b><span suppressHydrationWarning>{dayKey(m.from) === dayKey(m.to) ? dayLabel(m.from) : `${dayLabel(m.from)} to ${dayLabel(m.to)}`}</span></div>
            <p className="tl-done">{say(COPY.whatIs, w)}{m.people.join(' and ')}.</p>
            {mode === 'shared' && <p className="tl-done">{say(COPY.sharedLead, w)} {aboutHref && <><a href={aboutHref}>{say(COPY.sharedAbout, w)}</a>.</>}</p>}
            <p className="tl-done tl-count">{m.sittings.length} {say([{ term: 'tetheredSupersession', plural: m.sittings.length !== 1, lower: true }], w)}</p>
            <h1 className="tl-intent">{m.name}</h1>
            <p className="tl-aim">{m.intent}</p>
            <p className="tl-done"><b>Done means:</b> {m.done}</p>
            <div className="tl-stands">
              <div className="tl-state">{m.standing.state === 'Waiting' && <span className="tl-gem" />}{m.standing.state}<When at={m.standing.at} now={now} stack right /></div>
              <p>{m.standing.line}</p>
              {mode === 'member' && m.right && <p suppressHydrationWarning>{m.left.name}: {m.left.lastSeenAt ? `last seen ${rel(m.left.lastSeenAt, now)}` : 'not seen yet'}. {m.right.name}: {m.right.lastSeenAt ? `last seen ${rel(m.right.lastSeenAt, now)}` : 'not seen yet'}.</p>}
            </div>
            {notice}
            <div className="tl-acts">
              <button type="button" className="tl-act tl-go" onClick={() => setSheet({ title: 'Signatures', body: <><p className="tl-note">{sigLine}</p><p className="tl-note">{who}</p></> })}>{say(COPY.check, w)}</button>
              {mode === 'member' && <button type="button" className="tl-act" onClick={() => setSheet({ title: 'Share a read-only page', body: <p className="tl-note">{say(COPY.shareSheet, w)}</p> })}>{say(COPY.share, w)}</button>}
              {mode === 'member' && <button type="button" className="tl-act" onClick={() => setSheet({ title: 'Full conversation', body: <ol className="tl-list">{m.conversation.map((c) => <li key={c.seq}><span>{c.seq}</span><div><b>{c.who}</b><small suppressHydrationWarning>{rel(c.at, now)}, {abs(c.at)}</small><div>{c.text}</div></div></li>)}</ol> })}>{say(COPY.openConversation, w)}</button>}
              {hostHref && <a className="tl-act" href={hostHref}>{say(COPY.openOnHost, w)}</a>}
            </div>
          </div>
          <div className="tl-more">
            <details className="tl-fold" ref={firstFold}>
              <summary><span className="tl-c">{say(COPY.settled, w)} <b>{m.settled.length}</b></span><span className="tl-c"><span className="tl-gem" />{say(COPY.stillOpen, w)} <b>{m.open.length}</b></span></summary>
              <div className="tl-two">
                <section><ul>{m.settled.map((s) => <li key={s.ref} className={s.person ? 'tl-p' : ''}>{s.text}<small>{s.ref}</small></li>)}</ul></section>
                <section><ul>{m.open.map((o) => <li key={o.text}>{o.text}<small>{o.ref}</small></li>)}</ul></section>
              </div>
            </details>
            <details className="tl-fold">
              <summary><span className="tl-c">{say(COPY.story, w)}</span></summary>
              <p className="tl-tale">{m.story.join(' ')}</p>
            </details>
            <details className="tl-fold">
              <summary><span className="tl-c">{say(COPY.howToRead, w)}</span></summary>
              <p className="tl-key">{say(COPY.keyIntro, w)} <i>{say(COPY.keyViolet, w)}</i> {say(COPY.keyTick, w)} {say(COPY.keySide, w)} {say(COPY.keyTap, w)} {say(COPY.keyRoom, w)}</p>
            </details>
          </div>
        </header>

        <div className="tl-head" ref={head}>
          <div className="tl-side"><b>{m.left.name}</b><small>Answers to {m.left.answersTo}</small><output>{counted('left')}</output></div>
          <div className="tl-at" aria-hidden="true">{at}</div>
          {m.right && <div className="tl-side tl-r"><b>{m.right.name}</b><small>Answers to {m.right.answersTo}</small><output>{counted('right')}</output></div>}
        </div>

        <main className="tl-book" ref={book}>
          {blocks.map((b, i) => b.kind === 'stamp'
            ? <div key={`s${b.entry.seq}`}>{markRun(b.entry.seq, `k${b.entry.seq}`)}{between(b.entry)}<Stamp e={b.entry} now={now} open={voucher} noReason={noReason} /></div>
            : runBlock(b.entries, b.clause, `r${i}`))}
          {markRun(-Infinity, 'k-end')}
        </main>

        <section className="tl-end" aria-label="Where the log began">
          <h2>{say(COPY.began, w)}</h2>
          <div className="tl-check"><p aria-live="polite">{sigLine}</p><p>{who}</p></div>
          {mode === 'member' && m.library.length > 0 && <div className="tl-files"><h3>{say(COPY.filed, w)}</h3>{m.library.map((l) => <p key={l.name}><b>{l.name}.</b> {l.why}</p>)}</div>}
          {mode === 'member' && <p className="tl-key"><a href="https://hypercontext.wiki/standards/tether-log/v1">{say(COPY.standard, w)}</a></p>}
        </section>
      </div>
      <dialog ref={dlg} onClose={() => setSheet(null)} onClick={(ev) => { if (ev.target === dlg.current) setSheet(null) }}>
        {sheet && <div className="tl-voucher"><h2>{sheet.title}</h2>{sheet.body}<button type="button" className="tl-act" onClick={() => setSheet(null)}>Close</button></div>}
      </dialog>
    </div>
  )
}
