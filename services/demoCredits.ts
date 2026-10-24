/**
 * The demo server's credits: every clip, album, book, photo, show and Live TV source it
 * holds, with its maker, licence and source page. The app ships the manifest the server
 * published when it was built (constants/demo-credits.json, `npm run demo-credits`) and
 * asks the server for a newer one when the Credits screen opens.
 */
import bundled from "@/constants/demo-credits.json";
import { logger } from "@/utils/logger";
import { DEMO_SERVER_URL } from "./jellyfin/constants";
import { fetchWithTimeout } from "./jellyfin/http";

export interface DemoCredit {
  library: string;
  title: string;
  by: string;
  year: number | null;
  licence: string;
  licenceUrl: string;
  source: string;
}

export interface DemoCredits {
  /** When the server built the list, ISO 8601 UTC. */
  generated: string;
  items: DemoCredit[];
}

export interface DemoCreditGroup {
  library: string;
  items: DemoCredit[];
}

export const DEMO_CREDITS_URL = `${DEMO_SERVER_URL}/credits.json`;
const LIBRARY_ORDER = ["Space", "Music", "Books", "Photos", "Shows", "Live TV"];
const FETCH_TIMEOUT_MS = 10000;

export const BUNDLED_DEMO_CREDITS: DemoCredits = bundled as DemoCredits;

function isCredit(value: unknown): value is DemoCredit {
  if (typeof value !== "object" || value === null) return false;
  const item = value as Record<string, unknown>;
  const strings = ["library", "title", "by", "licence", "licenceUrl", "source"].every((key) => typeof item[key] === "string" && (item[key] as string).length > 0);
  return strings && (item.year === null || item.year === undefined || typeof item.year === "number");
}

/** The manifest when `value` has its full shape, else null. */
export function parseDemoCredits(value: unknown): DemoCredits | null {
  if (typeof value !== "object" || value === null) return null;
  const manifest = value as Record<string, unknown>;
  if (typeof manifest.generated !== "string" || !Array.isArray(manifest.items) || !manifest.items.every(isCredit)) return null;
  return { generated: manifest.generated, items: manifest.items.map((item) => ({ ...item, year: item.year ?? null })) };
}

/** The fetched manifest when it was generated after the current one, else the current one. */
export function newerManifest(current: DemoCredits, fetched: DemoCredits | null): DemoCredits {
  return fetched && fetched.generated > current.generated ? fetched : current;
}

/** Items by library, in the order the demo lists them; a library the order does not name comes last. */
export function groupCredits(items: DemoCredit[]): DemoCreditGroup[] {
  const groups = new Map<string, DemoCredit[]>();
  for (const item of items) groups.set(item.library, [...(groups.get(item.library) ?? []), item]);
  const rank = (library: string) => (LIBRARY_ORDER.includes(library) ? LIBRARY_ORDER.indexOf(library) : LIBRARY_ORDER.length);
  return [...groups.entries()].sort(([a], [b]) => rank(a) - rank(b)).map(([library, group]) => ({ library, items: group }));
}

/** The server's manifest, or null when it cannot be read; the caller keeps what it has. */
export async function fetchDemoCredits(): Promise<DemoCredits | null> {
  try {
    const response = await fetchWithTimeout(DEMO_CREDITS_URL, { headers: { Accept: "application/json" } }, FETCH_TIMEOUT_MS);
    if (!response.ok) return null;
    return parseDemoCredits(await response.json());
  } catch (error) {
    logger.warn("Demo credits not refreshed", error, { service: "demoCredits" });
    return null;
  }
}
