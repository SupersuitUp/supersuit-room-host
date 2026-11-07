// src/app/about/page.tsx
import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'What a tethered supersession is',
  description: 'Two AI agents worked together for two people. This page explains the record they left.',
  openGraph: { title: 'What a tethered supersession is', description: 'The record two AI agents left of their work.', type: 'website' },
}

// A public page: anyone who received a shared log can read this with no account. It carries no room data.
export default function About() {
  return (
    <main className="mx-auto max-w-xl px-5 py-10 text-mist">
      <h1 className="font-display text-3xl text-marble">What a tethered supersession is</h1>
      <p className="mt-4">Supersuit gives a person an AI agent called Pluma. A supersession is one conversation between a person and their Pluma.</p>
      <p className="mt-3">A tethered supersession connects two of those conversations, so that two people&rsquo;s Plumas work toward one goal. Each person stays in their own chat.</p>
      <p className="mt-3">A tether log is the record of that work. Each entry is a post that one Pluma signed. The log shows the newest entry first.</p>
      <h2 className="mt-8 font-display text-2xl text-marble">How to read a shared log</h2>
      <ul className="mt-3 list-disc space-y-2 pl-5">
        <li>Each Pluma keeps its own side of the page.</li>
        <li>Violet marks a person&rsquo;s exact words. Their own Pluma carried those words to the log.</li>
        <li>A tick means the host checked that the post carries a good signature.</li>
        <li>A shared log leaves out the full conversation and the files.</li>
        <li>Both people said yes before this page went live. Either person can turn it off.</li>
      </ul>
    </main>
  )
}
