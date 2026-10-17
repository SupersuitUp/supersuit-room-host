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
//   close-room     --room <id>                                         refuses writes from now on; its context files go 30 days later
//   delete-room    --room <id> --confirm <id>                          the room, its thread, attachments, context files, keys and invites; no undo
//   housekeep                                                           run the declared housekeeping now (the daily cron does this)
//
// Context files (v0.3) live in the bucket named by ROOMS_CONTEXT_BUCKET.
//
// Objectives, drafts and decisions are not operator verbs: they are signed posts by member Plumas.
import { readFileSync } from 'node:fs'
import { parseArgs } from 'node:util'
import { initializeApp, cert } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'
import { getStorage } from 'firebase-admin/storage'
import { GcsObjectStore } from '../src/lib/rooms/gcs-object-store'
import { FirestoreStore } from '../src/lib/rooms/firestore-store'
import * as rooms from '../src/lib/rooms/service'

const { positionals: [verb], values: v } = parseArgs({
  allowPositionals: true,
  options: {
    key: { type: 'string' }, name: { type: 'string' }, email: { type: 'string', multiple: true }, 
    room: { type: 'string' }, person: { type: 'string' }, test: { type: 'boolean' }, for: { type: 'string' },
    member: { type: 'string' }, confirm: { type: 'string' },
  },
})

const file = process.env.FIREBASE_SERVICE_ACCOUNT_KEY_FILE
if (!file) { console.error('FIREBASE_SERVICE_ACCOUNT_KEY_FILE is not set'); process.exit(2) }
let account
try { account = JSON.parse(readFileSync(file, 'utf8')) } catch { console.error('the service account file could not be read as JSON'); process.exit(2) }
const app = initializeApp({ credential: cert(account) })
const db = process.env.ROOMS_FIRESTORE_DATABASE ? getFirestore(app, process.env.ROOMS_FIRESTORE_DATABASE) : getFirestore(app)
const bucket = process.env.ROOMS_CONTEXT_BUCKET
const ctx: rooms.Ctx = { store: new FirestoreStore(db), now: () => Date.now(), objects: bucket ? new GcsObjectStore(getStorage(app).bucket(bucket)) : undefined }
function needObjects() { if (!ctx.objects) { console.error('ROOMS_CONTEXT_BUCKET is not set: the room\'s context files live there'); process.exit(2) } }
function need(k: keyof typeof v): string { const x = v[k]; if (typeof x !== 'string' || !x) { console.error(`--${k} is required`); process.exit(2) } return x }

const verbs: Record<string, () => Promise<unknown>> = {
  'add-person': () => rooms.addPerson(ctx, { key: need('key'), name: need('name'), emails: v.email ?? [] }).then(() => ({ ok: true })),
  'create-room': async () => ({ room: await rooms.createRoom(ctx, { person: need('for'), name: need('name') }) }),
  invite: () => rooms.createInvite(ctx, 'operator', need('room'), { name: need('name'), answersTo: need('for'), test: v.test === true }),
  'retire-member': () => rooms.retireMember(ctx, need('room'), need('member')).then(() => ({ ok: true })),
  'remove-legacy-person': () => rooms.removeLegacyPerson(ctx, need('room'), need('person')).then(() => ({ ok: true })),
  'close-room': () => rooms.closeRoom(ctx, need('room')).then(() => ({ closed: v.room })),
  housekeep: () => { needObjects(); return rooms.housekeep(ctx) },
  'delete-room': async () => {
    const room = need('room')
    if (v.confirm !== room) { console.error('delete-room removes everything in the room, attachments and context files included, with no undo: pass --confirm <the same room id>'); process.exit(2) }
    needObjects()
    const files = await rooms.deleteRoomContext(ctx, room)
    for (const coll of ['memberKeys', 'invites']) {
      const s = await db.collection(coll).where('roomId', '==', room).get()
      for (const d of s.docs) await d.ref.delete()
    }
    await db.recursiveDelete(db.doc(`rooms/${room}`))
    return { deleted: room, contextFiles: files }
  },
}

const run = verb ? verbs[verb] : undefined
if (!run) { console.error(`verbs: ${Object.keys(verbs).join(', ')}`); process.exit(2) }
run().then((r) => { console.log(JSON.stringify(r)); process.exit(0) }, (e) => { console.error(e.message ?? e); process.exit(1) })
