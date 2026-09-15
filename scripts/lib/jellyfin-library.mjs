/**
 * Jellyfin fixture-library helpers shared by make-test-media.mjs and make-test-books.mjs:
 * the .env.playback-test credentials, an authenticated fetch, and library registration.
 */

import fs from "node:fs";
import path from "node:path";

/** `.env.playback-test` at the repo root, or null when it is missing or incomplete. */
export function loadEnv(envPath) {
  if (!fs.existsSync(envPath)) return null;
  const env = {};
  for (const line of fs.readFileSync(envPath, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.+?)\s*$/);
    if (m) env[m[1]] = m[2];
  }
  if (!env.JELLYFIN_URL || !env.JELLYFIN_API_KEY) return null;
  env.JELLYFIN_URL = env.JELLYFIN_URL.replace(/\/$/, "");
  return env;
}

export async function jf(env, pathname, init = {}) {
  const res = await fetch(`${env.JELLYFIN_URL}${pathname}`, {
    ...init,
    headers: { Authorization: `MediaBrowser Token="${env.JELLYFIN_API_KEY}"`, ...(init.headers || {}) },
    signal: AbortSignal.timeout(30000),
  });
  if (!res.ok) throw new Error(`Jellyfin ${pathname} -> HTTP ${res.status}`);
  return res;
}

/** True when `a` is `b`, or sits inside it. Compared as path segments, not text. */
export function isInside(a, b) {
  const inner = path.resolve(a);
  const outer = path.resolve(b);
  return inner === outer || inner.startsWith(outer + path.sep);
}

/**
 * Register one fixture library, or leave the server alone.
 *
 * Three guards, each of which is a mistake this script has already made on a
 * real server:
 *
 *   1. Match on NAME as well as path. Matching on path alone means a library
 *      that already covers this directory under a different name is invisible
 *      here, and a second one gets created over it. That is how `Movies` /
 *      `Home Videos and Photos` and `Music` / `Downloaded` ended up as identical
 *      pairs, one of which then had to be deleted.
 *   2. Refuse to nest. Jellyfin attributes a file to the top-level physical
 *      folder that owns it, so a library inside another library's path has its
 *      items claimed by the outer one: the inner library reads as empty or
 *      duplicated, and the outer one fills with things that are not its content.
 *   3. Verify the content type after creating. `collectionType` is a query
 *      param, and a library that does not receive it comes back with a null type
 *      (no `*.collection` marker on disk) and behaves as a mixed library.
 *
 * `log` prints progress; `failures` collects non-fatal problems for the caller's summary.
 */
export async function ensureLibrary(env, name, collectionType, dir, { log, failures }) {
  if (!fs.existsSync(dir)) {
    console.warn(`  library ${name} skipped, no such directory: ${dir}`);
    failures.push(`library ${name}: ${dir} does not exist`);
    return;
  }

  const existing = await (await jf(env, "/Library/VirtualFolders")).json();
  const match = existing.find((v) => v.Name === name || v.Locations?.some((p) => path.resolve(p) === path.resolve(dir)));
  if (match) {
    log(`  = library ${match.Name} -> ${match.Locations?.join(", ")}`);
    if ((match.CollectionType ?? null) !== collectionType) {
      console.warn(`  ✗ library ${match.Name} is type ${match.CollectionType ?? "none"}, expected ${collectionType}`);
      failures.push(`library ${match.Name} has type ${match.CollectionType ?? "none"}, expected ${collectionType}`);
    }
    return;
  }

  const overlap = existing.find((v) => v.Locations?.some((p) => isInside(dir, p) || isInside(p, dir)));
  if (overlap) {
    console.warn(`  ✗ library ${name} not created: ${dir} overlaps ${overlap.Name} (${overlap.Locations.join(", ")})`);
    failures.push(`library ${name}: ${dir} overlaps existing library ${overlap.Name}`);
    return;
  }

  const qs = new URLSearchParams({ name, collectionType, refreshLibrary: "true" });
  await jf(env, `/Library/VirtualFolders?${qs}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ LibraryOptions: { PathInfos: [{ Path: dir }] } }),
  });

  // Read it back: a 204 only says the request was accepted.
  const after = await (await jf(env, "/Library/VirtualFolders")).json();
  const created = after.find((v) => v.Name === name);
  if (!created) {
    failures.push(`library ${name} was not created`);
    console.warn(`  ✗ library ${name} did not appear after creation`);
    return;
  }
  if ((created.CollectionType ?? null) !== collectionType) {
    failures.push(`library ${name} created with type ${created.CollectionType ?? "none"}, expected ${collectionType}`);
    console.warn(`  ✗ library ${name} created with type ${created.CollectionType ?? "none"}, expected ${collectionType}`);
    return;
  }
  log(`  + library ${name} (${collectionType}) -> ${dir}`);
}
