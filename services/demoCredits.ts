/**
 * The demo server's credits: every clip, album, book, photo, show and Live TV source it
 * holds, with its maker, licence, source page and picture. The app ships the manifest the
 * server published when it was built (constants/demo-credits.json, `npm run demo-credits`)
 * and asks the server for a newer one when the Media Licenses screen opens.
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
  /** The poster, cover or photo the server cut for a list row; null when it has none. */
  image: string | null;
}

export interface DemoCredits {
  /** When the server built the list, ISO 8601 UTC. */
  generated: string;
  items: DemoCredit[];
}

/** The items of one library that share a maker and a licence. */
export interface DemoCreditGroup {
  by: string;
  licence: string;
  licenceUrl: string;
  items: DemoCredit[];
}

export interface DemoCreditSection {
  library: string;
  groups: DemoCreditGroup[];
}

export const DEMO_CREDITS_URL = `${DEMO_SERVER_URL}/credits.json`;
const LIBRARY_ORDER = ["Space", "Music", "Books", "Photos", "Shows", "Live TV"];
const FETCH_TIMEOUT_MS = 10000;

export const BUNDLED_DEMO_CREDITS: DemoCredits = parseDemoCredits(bundled) ?? { generated: "", items: [] };

function isCredit(value: unknown): value is Omit<DemoCredit, "year" | "image"> & { year?: number | null; image?: string | null } {
  if (typeof value !== "object" || value === null) return false;
  const item = value as Record<string, unknown>;
  const strings = ["library", "title", "by", "licence", "licenceUrl", "source"].every((key) => typeof item[key] === "string" && (item[key] as string).length > 0);
  const year = item.year === null || item.year === undefined || typeof item.year === "number";
  const image = item.image === null || item.image === undefined || (typeof item.image === "string" && item.image.length > 0);
  return strings && year && image;
}

/** The manifest when `value` has its full shape, else null. */
export function parseDemoCredits(value: unknown): DemoCredits | null {
  if (typeof value !== "object" || value === null) return null;
  const manifest = value as Record<string, unknown>;
  if (typeof manifest.generated !== "string" || !Array.isArray(manifest.items) || !manifest.items.every(isCredit)) return null;
  return { generated: manifest.generated, items: manifest.items.map((item) => ({ ...item, year: item.year ?? null, image: item.image ?? null })) };
}

/** The fetched manifest when it was generated after the current one, else the current one. */
export function newerManifest(current: DemoCredits, fetched: DemoCredits | null): DemoCredits {
  return fetched && fetched.generated > current.generated ? fetched : current;
}

/**
 * Items by library, in the order the demo lists them (a library the order does not name comes
 * last), each library's items grouped by maker and licence in the order they first appear.
 */
export function creditSections(items: DemoCredit[]): DemoCreditSection[] {
  const sections = new Map<string, DemoCreditGroup[]>();
  for (const item of items) {
    const groups = sections.get(item.library) ?? [];
    const group = groups.find((candidate) => candidate.by === item.by && candidate.licence === item.licence);
    if (group) group.items.push(item);
    else groups.push({ by: item.by, licence: item.licence, licenceUrl: item.licenceUrl, items: [item] });
    sections.set(item.library, groups);
  }
  const rank = (library: string) => (LIBRARY_ORDER.includes(library) ? LIBRARY_ORDER.indexOf(library) : LIBRARY_ORDER.length);
  return [...sections.entries()].sort(([a], [b]) => rank(a) - rank(b)).map(([library, groups]) => ({ library, groups }));
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
