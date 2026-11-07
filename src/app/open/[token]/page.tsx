'use client'
import { use, useState } from 'react'

// One tap spends the link. The page itself spends nothing, so a link preview cannot.
export default function Open({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const open = async () => {
    setBusy(true)
    const r = await fetch('/api/open', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token }) })
    const d = await r.json().catch(() => ({}))
    if (r.ok) { window.location.assign(`/r/${d.room}`); return }
    setError(d.error ?? 'This link did not open.')
    setBusy(false)
  }
  return (
    <main className="mx-auto max-w-xl px-5 py-10">
      <h1 className="font-display text-3xl text-marble">Your tether log</h1>
      <p className="mt-3 text-mist/80">This link opens the log once, on this phone or computer.</p>
      <button type="button" onClick={open} disabled={busy} className="mt-6 rounded-full bg-bronze px-6 py-3 text-night disabled:opacity-60">Open the tether log</button>
      {error && <p className="mt-4 text-craft">{error}</p>}
    </main>
  )
}
