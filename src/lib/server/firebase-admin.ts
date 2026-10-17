import 'server-only'
import { initializeApp, getApps, cert, type ServiceAccount } from 'firebase-admin/app'
import { getFirestore, type Firestore } from 'firebase-admin/firestore'
import { getAuth, type Auth } from 'firebase-admin/auth'
import { getStorage } from 'firebase-admin/storage'

// A missing or unreadable key stops the first use with words naming the setting. The JSON parse
// error is replaced rather than passed on, because Node's message quotes the text: the private key.
function serviceAccount(): ServiceAccount {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT_KEY
  if (!raw) throw new Error('FIREBASE_SERVICE_ACCOUNT_KEY is not set')
  try { return JSON.parse(raw) as ServiceAccount } catch { throw new Error('FIREBASE_SERVICE_ACCOUNT_KEY is not valid JSON') }
}

function app() {
  return getApps()[0] ?? initializeApp({ credential: cert(serviceAccount()) })
}

let db: Firestore | null = null
export function getAdminDb(): Firestore {
  if (!db) {
    const name = process.env.ROOMS_FIRESTORE_DATABASE
    db = name ? getFirestore(app(), name) : getFirestore(app())
  }
  return db
}
export function getAdminAuth(): Auth { return getAuth(app()) }

/** The private bucket context bytes live in (v0.3), or null when ROOMS_CONTEXT_BUCKET is unset. */
export function getContextBucket() {
  const name = process.env.ROOMS_CONTEXT_BUCKET
  return name ? getStorage(app()).bucket(name) : null
}
