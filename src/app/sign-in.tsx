'use client'
import { useState } from 'react'
import { signIn, signInConfigured } from '@/lib/client/firebase'

export function SignIn({ onDone }: { onDone: () => void }) {
  const [state, setState] = useState<'idle' | 'busy' | 'stranger' | 'error'>('idle')
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center gap-8 px-6 text-center">
      <h1 className="font-display text-4xl text-marble">Supersuit Rooms</h1>
      <p className="text-mist/85">Members only.</p>
      {!signInConfigured ? (
        <p className="text-sm text-mist/70">Sign-in is not set up on this host yet.</p>
      ) : (
        <button
          className="hairline border px-6 py-3 text-marble disabled:opacity-50"
          disabled={state === 'busy'}
          onClick={async () => {
            setState('busy')
            try { (await signIn()) === 'ok' ? onDone() : setState('stranger') } catch { setState('error') }
          }}
        >
          Sign in with Google
        </button>
      )}
      {state === 'stranger' && <p className="text-sm text-mist/70">That account is not a member here.</p>}
      {state === 'error' && <p className="text-sm text-mist/70">Sign-in did not finish. Try again.</p>}
    </main>
  )
}
