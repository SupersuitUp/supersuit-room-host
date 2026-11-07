// src/lib/tether-log/time.ts
// Each entry's relative time and its exact time, in the reader's own zone.
const daysBack = (at: number, now: number) => {
  const a = new Date(at), b = new Date(now)
  return Math.round((new Date(b.getFullYear(), b.getMonth(), b.getDate()).getTime() - new Date(a.getFullYear(), a.getMonth(), a.getDate()).getTime()) / 864e5)
}

export function rel(at: number, now: number): string {
  const m = Math.floor((now - at) / 6e4)
  if (m < 1) return 'just now'
  if (m < 60) return m === 1 ? '1 min ago' : `${m} mins ago`
  const h = Math.floor(m / 60), back = daysBack(at, now)
  if (back === 0 || h < 6) return h === 1 ? '1 hour ago' : `${h} hours ago`
  return back === 1 ? 'yesterday' : `${back} days ago`
}

export const abs = (at: number) => new Date(at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
/** The time of day alone, in the reader's zone: "3:14 PM". */
export const clock = (at: number) => new Date(at).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
export const dayLabel = (at: number) => new Date(at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
export const dayKey = (at: number) => { const d = new Date(at); return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}` }
export function dayName(at: number, now: number): string {
  const b = daysBack(at, now)
  return b === 0 ? 'Today' : b === 1 ? 'Yesterday' : new Date(at).toLocaleDateString('en-US', { weekday: 'long' })
}
