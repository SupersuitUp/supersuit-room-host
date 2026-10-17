#!/usr/bin/env node
// Vendor @supersuit/firestore-double into src/lib/vendor/firestore-double/.
//
//   node scripts/vendor-firestore-double.mjs                # from ../../supersuit-repos/firestore-double
//   node scripts/vendor-firestore-double.mjs --from <dir>   # a checkout or an unpacked tarball
//   node scripts/vendor-firestore-double.mjs --check        # exit 3 if the vendored copy was hand-edited
//
// WHY VENDORED. This repo's tests ran on a hand-rolled MemoryStore, and on 2026-10-15 a laxer
// version of it let retireMember read after writing inside a transaction, which Firestore refuses:
// tests green, production broken. The account server hit the same class of bug two days later.
// The strict double now lives once, in @supersuit/firestore-double (SupersuitUp/firestore-double),
// shared with continental-works-web, and is vendored here until it is on npm. VENDORED.json pins
// the version and the sha256 of every file.
//
// NEVER EDIT THE VENDORED FILES. A fix goes to the package, gets released, and is re-vendored
// with this script. `--check` (run by src/lib/rooms/firestore-double.test.ts) refuses a
// copy whose bytes no longer match the manifest, because a patch made here is a fork that the
// next re-vendor silently erases.
import { readFileSync, writeFileSync, readdirSync, statSync, mkdirSync, rmSync, cpSync, existsSync } from "node:fs";
import { join, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
export const DEST = join(ROOT, "src", "lib", "vendor", "firestore-double");
const PARTS = ["src", "package.json", "LICENSE"];

const sha = (p) => createHash("sha256").update(readFileSync(p)).digest("hex");

function walk(dir, out = []) {
  for (const n of readdirSync(dir).sort()) {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) walk(p, out); else out.push(p);
  }
  return out;
}

/** Every vendored file except the manifest, keyed by path relative to DEST. */
export function hashes(dir = DEST) {
  return Object.fromEntries(walk(dir).filter((p) => !p.endsWith("VENDORED.json")).map((p) => [relative(dir, p), sha(p)]));
}

export function check(dir = DEST) {
  const manifest = JSON.parse(readFileSync(join(dir, "VENDORED.json"), "utf8"));
  const now = hashes(dir);
  const problems = [];
  for (const [f, h] of Object.entries(manifest.files)) {
    if (!now[f]) problems.push(`missing: ${f}`);
    else if (now[f] !== h) problems.push(`edited by hand: ${f}`);
  }
  for (const f of Object.keys(now)) if (!manifest.files[f]) problems.push(`not in the manifest: ${f}`);
  return { version: manifest.version, problems };
}

function vendor(from) {
  const pkg = JSON.parse(readFileSync(join(from, "package.json"), "utf8"));
  if (pkg.name !== "@supersuit/firestore-double") throw new Error(`${from} is not @supersuit/firestore-double`);
  rmSync(DEST, { recursive: true, force: true });
  mkdirSync(DEST, { recursive: true });
  for (const part of PARTS) if (existsSync(join(from, part))) cpSync(join(from, part), join(DEST, part), { recursive: true });
  const manifest = {
    package: pkg.name,
    version: pkg.version,
    note: "Vendored by scripts/vendor-firestore-double.mjs. Never edit these files; fix the package and re-vendor.",
    files: hashes(),
  };
  writeFileSync(join(DEST, "VENDORED.json"), JSON.stringify(manifest, null, 2) + "\n");
  return manifest;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  if (args.includes("--check")) {
    const { version, problems } = check();
    if (problems.length) { console.error(problems.join("\n")); process.exit(3); }
    console.log(`@supersuit/firestore-double ${version}: vendored copy intact`);
  } else {
    const i = args.indexOf("--from");
    const from = i >= 0 ? args[i + 1] : join(ROOT, "..", "..", "supersuit-repos", "firestore-double");
    const m = vendor(from);
    console.log(`vendored @supersuit/firestore-double ${m.version} (${Object.keys(m.files).length} files)`);
  }
}
