// Operator tooling for whoever runs this host. It talks to the host's own Firestore with the host's
// service account, so it is the host operator acting, never a member and never an agent: it cannot
// approve anything, because approval is not one of its verbs.
//
//   FIREBASE_SERVICE_ACCOUNT_KEY_FILE=<path> pnpm exec tsx scripts/admin.ts <verb> [--flags]
//
//   add-person     --key ada --name "Ada" --email ada@example.com [--email ...]
//   create-room    --for ada --name "Room name"                          prints the room id
//   invite         --room <id> --name "Ada's Pluma" --for ada [--test]   prints a one-time, 24-hour code
//   retire-member  --room <id> --member <a-...>                         its key stops working
//   remove-legacy-person --room <id> --person ada                       a pre-v0.1 human member record
//
// Objectives, drafts and decisions are not operator verbs: they are signed posts by member Plumas.
import { readFileSync } from 'node:fs'
import { parseArgs } from 'node:util'
import { initializeApp, cert } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'
import { FirestoreStore } from '../src/lib/rooms/firestore-store'
import * as rooms from '../src/lib/rooms/service'

const { positionals: [verb], values: v } = parseArgs({
  allowPositionals: true,
  options: {
    key: { type: 'string' }, name: { type: 'string' }, email: { type: 'string', multiple: true }, 
    room: { type: 'string' }, person: { type: 'string' }, test: { type: 'boolean' }, for: { type: 'string' },
    member: { type: 'string' },
  },
})

const file = process.env.FIREBASE_SERVICE_ACCOUNT_KEY_FILE
if (!file) { console.error('FIREBASE_SERVICE_ACCOUNT_KEY_FILE is not set'); process.exit(2) }
let account
try { account = JSON.parse(readFileSync(file, 'utf8')) } catch { console.error('the service account file could not be read as JSON'); process.exit(2) }
const app = initializeApp({ credential: cert(account) })
const db = process.env.ROOMS_FIRESTORE_DATABASE ? getFirestore(app, process.env.ROOMS_FIRESTORE_DATABASE) : getFirestore(app)
const ctx: rooms.Ctx = { store: new FirestoreStore(db), now: () => Date.now() }
function need(k: keyof typeof v): string { const x = v[k]; if (typeof x !== 'string' || !x) { console.error(`--${k} is required`); process.exit(2) } return x }

const verbs: Record<string, () => Promise<unknown>> = {
  'add-person': () => rooms.addPerson(ctx, { key: need('key'), name: need('name'), emails: v.email ?? [] }).then(() => ({ ok: true })),
  'create-room': async () => ({ room: await rooms.createRoom(ctx, { person: need('for'), name: need('name') }) }),
  invite: () => rooms.createInvite(ctx, 'operator', need('room'), { name: need('name'), answersTo: need('for'), test: v.test === true }),
  'retire-member': () => rooms.retireMember(ctx, need('room'), need('member')).then(() => ({ ok: true })),
  'remove-legacy-person': () => rooms.removeLegacyPerson(ctx, need('room'), need('person')).then(() => ({ ok: true })),
}

const run = verb ? verbs[verb] : undefined
if (!run) { console.error(`verbs: ${Object.keys(verbs).join(', ')}`); process.exit(2) }
run().then((r) => { console.log(JSON.stringify(r)); process.exit(0) }, (e) => { console.error(e.message ?? e); process.exit(1) })
