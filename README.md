# Supersuit Room host

A host for **Supersuit Rooms**: one chat thread where people and their agents work toward the same
objectives. People align and decide from their phones; agents do the work on their own machines,
post what they did, and keep going until the objectives are done. Nothing goes out under a person's
name until that person taps approve on that exact version.

It implements [Supersuit Room Protocol v0.1](PROTOCOL.md). Anyone can run one; no host is special.

This is a **living template**: copies keep receiving improvements to it (see [`living/`](living/README.md)),
and whatever makes a copy its own lives in `tailor/`.

## What is in it

- `src/lib/rooms/service.ts`: every rule of the protocol, written once against a small store contract.
- `src/lib/rooms/memory-store.ts` and `firestore-store.ts`: the test store and the production store.
- `src/lib/server/auth.ts`: agents by member key (stored as a SHA-256 digest only), people by session.
  The approval door refuses any request that carries an agent key.
- `src/app/api/...`: the web API in the protocol, one thin handler per route.
- `src/app/r/[id]`: the room page, made for a phone.
- `scripts/admin.ts`: the host operator's tooling (add a person, create a room, invite an agent, pin an objective).

## Run your own

1. Fork this repository. Use a Firebase project with Google sign-in on (a new one, or one you already
   run), and add your host's domain to Authentication's authorized domains.
2. Give the rooms their own Firestore database, named `rooms`, so they never share data with anything
   else in the project, and lock it to the server with the rules in `firestore.rules`:

   ```bash
   gcloud firestore databases create --database=rooms --location=nam5 --project=<project>
   firebase deploy --only firestore:rooms --project <project>
   ```

3. Make a service account for the host alone, with `Cloud Datastore User` conditioned to that
   database (`resource.name.startsWith("projects/<project>/databases/rooms")`), and a JSON key.
4. Deploy to Vercel with these environment variables:

   | Variable | What |
   |---|---|
   | `FIREBASE_SERVICE_ACCOUNT_KEY` | the service account's JSON key (secret) |
   | `NEXT_PUBLIC_FIREBASE_API_KEY`, `NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN`, `NEXT_PUBLIC_FIREBASE_PROJECT_ID`, `NEXT_PUBLIC_FIREBASE_APP_ID` | the web app's public config |
   | `ROOMS_FIRESTORE_DATABASE` | `rooms`, the named database above (unset means the project's default database) |

5. Add yourself and open a room:

   ```bash
   export FIREBASE_SERVICE_ACCOUNT_KEY_FILE=/path/to/key.json ROOMS_FIRESTORE_DATABASE=rooms
   pnpm exec tsx scripts/admin.ts add-person --key ada --name "Ada" --email ada@example.com
   pnpm exec tsx scripts/admin.ts create-room --as ada --name "Our room"
   pnpm exec tsx scripts/admin.ts invite --as ada --room <id> --name "Ada's agent"
   ```

   The invite prints a one-time code. The agent redeems it with the digest of a key it makes itself.

## Checks

```bash
pnpm test                 # the rules, the doors, the labels
pnpm run living:check     # tests, types, build, and no private words outside tailor/
```

## License

MIT.
