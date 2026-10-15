// Operator tooling for whoever runs this host. It talks to the host's own Firestore with the host's
// service account, so it is the host operator acting, never a member and never an agent: it cannot
// approve anything, because approval is not one of its verbs.
//
//   FIREBASE_SERVICE_ACCOUNT_KEY_FILE=<path> pnpm exec tsx scripts/admin.ts <verb> [--flags]
//
//   add-person    --key ada --name "Ada" --email ada@example.com [--email ...]
//   create-room   --as ada --name "Room name"                       prints the room id
//   add-member    --as ada --room <id> --person ben
//   invite        --as ada --room <id> --name "Ada's Pluma" [--test] prints a one-time code
//   pin-objective --as ada --room <id> --title "..." --owner ada --done "..."
import { readFileSync } from 'node:fs'
import { parseArgs } from 'node:util'
import { initializeApp, cert } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'
import { FirestoreStore } from '../src/lib/rooms/firestore-store'
import * as rooms from '../src/lib/rooms/service'

const { positionals: [verb], values: v } = parseArgs({
  allowPositionals: true,
  options: {
    key: { type: 'string' }, name: { type: 'string' }, email: { type: 'string', multiple: true }, as: { type: 'string' },
    room: { type: 'string' }, person: { type: 'string' }, test: { type: 'boolean' }, title: { type: 'string' },
    owner: { type: 'string' }, done: { type: 'string' },
  },
})

const file = process.env.FIREBASE_SERVICE_ACCOUNT_KEY_FILE
if (!file) { console.error('FIREBASE_SERVICE_ACCOUNT_KEY_FILE is not set'); process.exit(2) }
let account
try { account = JSON.parse(readFileSync(file, 'utf8')) } catch { console.error('the service account file could not be read as JSON'); process.exit(2) }
const app = initializeApp({ credential: cert(account) })
const db = process.env.ROOMS_FIRESTORE_DATABASE ? getFirestore(app, process.env.ROOMS_FIRESTORE_DATABASE) : getFirestore(app)
const ctx: rooms.Ctx = { store: new FirestoreStore(db), now: () => Date.now() }
const as = () => ({ kind: 'person' as const, person: need('as') })
function need(k: keyof typeof v): string { const x = v[k]; if (typeof x !== 'string' || !x) { console.error(`--${k} is required`); process.exit(2) } return x }

const verbs: Record<string, () => Promise<unknown>> = {
  'add-person': () => rooms.addPerson(ctx, { key: need('key'), name: need('name'), emails: v.email ?? [] }).then(() => ({ ok: true })),
  'create-room': async () => ({ room: await rooms.createRoom(ctx, as(), { name: need('name') }) }),
  'add-member': () => rooms.addPersonToRoom(ctx, as(), need('room'), need('person')).then(() => ({ ok: true })),
  invite: () => rooms.createInvite(ctx, as(), need('room'), { name: need('name'), test: v.test === true }),
  'pin-objective': async () => ({ objective: await rooms.createObjective(ctx, as(), need('room'), { title: need('title'), owner: need('owner'), done: need('done') }) }),
}

const run = verb ? verbs[verb] : undefined
if (!run) { console.error(`verbs: ${Object.keys(verbs).join(', ')}`); process.exit(2) }
run().then((r) => { console.log(JSON.stringify(r)); process.exit(0) }, (e) => { console.error(e.message ?? e); process.exit(1) })
