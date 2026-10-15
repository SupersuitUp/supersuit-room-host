'use client'
import { initializeApp, getApps, getApp } from 'firebase/app'
import { getAuth, GoogleAuthProvider, signInWithPopup, signOut } from 'firebase/auth'

// The host's public web config, from its own environment. Nothing here is a secret.
const config = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
}
export const signInConfigured = Boolean(config.apiKey && config.authDomain && config.projectId)

const auth = () => getAuth(getApps().length ? getApp() : initializeApp(config))

/** Google sign-in by popup (Firebase's documented path for browsers that block third-party storage),
 * then the ID token is exchanged for this host's own session cookie. */
export async function signIn(): Promise<'ok' | 'not-a-member'> {
  const p = new GoogleAuthProvider()
  p.setCustomParameters({ prompt: 'select_account' })
  const result = await signInWithPopup(auth(), p)
  const idToken = await result.user.getIdToken()
  const res = await fetch('/api/session', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ idToken }) })
  await signOut(auth())
  if (res.status === 403) return 'not-a-member'
  if (!res.ok) throw new Error('sign-in failed')
  return 'ok'
}
