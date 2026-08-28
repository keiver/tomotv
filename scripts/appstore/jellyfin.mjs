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
    if (url && apiKey) {
      return {
        url: url.replace(/\/+$/, ""),
        apiKey,
        file: path.relative(root, file),
      };
    }
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

/**
 * A session from this device family. Weak on purpose: LastActivityDate does not move on
 * ordinary reads (measured: a library fetch left it ageing 678s -> 691s), so freshness
 * cannot be required, and Jellyfin labels both iPhone and iPad "iOS". This catches a
 * platform that never signed in here, not one that has since moved to another server.
 */
async function appIsOnServer(env, { family, timeoutMs = 8000 } = {}) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const fresh = (await jf(env, "/Sessions")).filter((x) => (x.Client ?? "").toLowerCase().includes("tomo") && (!family || x.DeviceName === family));
      if (fresh.length) return true;
    } catch {
      // Keep polling; one bad read should not decide this.
    }
    await new Promise((r) => setTimeout(r, 1500));
  }
  return false;
}

/** The app has to be on this server, or every resolved id is a 404 where it matters. */
export async function assertAppOnServer(env, { family, timeoutMs = 25000 } = {}) {
  if (await appIsOnServer(env, { family, timeoutMs })) return;
  let seen = [];
  try {
    seen = (await jf(env, "/Sessions"))
      .filter((x) => (x.Client ?? "").toLowerCase().includes("tomo"))
      .map((x) => `${x.DeviceName} ${Math.round((Date.now() - Date.parse(x.LastActivityDate)) / 1000)}s ago`);
  } catch {
    // The listing is a diagnostic; losing it should not mask the real failure.
  }
  throw new Error(`No ${family ?? "TomoTV"} session on ${env.url}.\n   Sessions seen: ${seen.join("; ") || "none"}\n   Sign that simulator in to ${env.url} and re-run.`);
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
