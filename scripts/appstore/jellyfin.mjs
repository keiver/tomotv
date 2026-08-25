/**
 * Server reads for capture: resolve names to ids, and confirm the simulator's app is
 * signed in to the same server those ids came from.
 */
import fs from "node:fs";
import path from "node:path";

/** First env file that carries both keys wins; capture states which one it used. */
export function loadEnv(root, explicit) {
  const candidates = explicit ? [explicit] : [".env.appstore", ".env.playback-test"];
  for (const name of candidates) {
    const file = path.isAbsolute(name) ? name : path.join(root, name);
    if (!fs.existsSync(file)) continue;
    const text = fs.readFileSync(file, "utf8");
    const read = (key) => text.match(new RegExp(`^${key}=(.*)$`, "m"))?.[1]?.trim();
    const url = read("JELLYFIN_URL");
    const apiKey = read("JELLYFIN_API_KEY");
    if (url && apiKey) return { url: url.replace(/\/+$/, ""), apiKey, file: path.relative(root, file) };
  }
  return null;
}

async function jf(env, route, timeoutMs = 15000) {
  const url = `${env.url}${route}${route.includes("?") ? "&" : "?"}ApiKey=${env.apiKey}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
  if (!res.ok) throw new Error(`${route} -> HTTP ${res.status}`);
  return res.json();
}

/** A library view by display name. */
export async function libraryId(env, name) {
  const { Items = [] } = await jf(env, "/Library/MediaFolders");
  const hit = Items.find((i) => i.Name === name);
  if (!hit) throw new Error(`No library named "${name}" on ${env.url}. Found: ${Items.map((i) => i.Name).join(", ") || "none"}`);
  return hit.Id;
}

/** An item by exact display name, searched across every library. */
export async function itemId(env, name) {
  const { Items = [] } = await jf(env, `/Items?Recursive=true&Limit=200&searchTerm=${encodeURIComponent(name)}`);
  const hit = Items.find((i) => i.Name === name) ?? Items[0];
  if (!hit) throw new Error(`No item named "${name}" on ${env.url}.`);
  return hit.Id;
}

/** The app has to be on this server, or every resolved id is a 404 where it matters. */
export async function assertAppOnServer(env, { timeoutMs = 25000 } = {}) {
  const deadline = Date.now() + timeoutMs;
  let seen = [];
  while (Date.now() < deadline) {
    try {
      const sessions = await jf(env, "/Sessions");
      seen = [...new Set(sessions.map((s) => s.Client).filter(Boolean))];
      if (sessions.some((s) => (s.Client ?? "").toLowerCase().includes("tomo"))) return;
    } catch {
      // Keep polling; one bad read should not end the run.
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
  throw new Error(
    `The app never registered a session on ${env.url}.\n   Clients seen: ${seen.join(", ") || "none"}\n   Sign the simulator in to ${env.url}, or point --env at the server it actually uses.`,
  );
}

/** Playback readiness for the player shot, whose frames never stop moving. */
export async function waitForPlaying(env, id, { timeoutMs = 45000 } = {}) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const sessions = await jf(env, "/Sessions");
      const playing = sessions.find((s) => s.NowPlayingItem?.Id === id && (s.PlayState?.PositionTicks ?? 0) > 0);
      if (playing) return;
    } catch {
      // Same tolerance as above.
    }
    await new Promise((r) => setTimeout(r, 1500));
  }
  throw new Error(`Playback of ${id} never reported a position on ${env.url}.`);
}
