/**
 * Programmes hunted for channels the server and the viewer's own guide both left bare: hosted
 * per-country XMLTV (epgshare01), fetched lazily for the countries the bare channels name, and
 * matched exact-after-normalization against the guide's channel ids and display-names. An
 * ambiguous name matches nothing and every failure is silent: the grid keeps its live pictures.
 */
import { cachedGuideFile } from "@/services/guideFileCache";
import { closeGuide, guideChannels, guideProgrammes, isLiveSourcesAvailable, loadGuide } from "@/services/liveSources";
import type { JellyfinProgram } from "@/types/jellyfin";
import { EXTERNAL_GUIDE_PREFIX } from "@/utils/guide";
import { logger } from "@/utils/logger";

const HOST = "https://epgshare01.online/epgshare01/";
/** Country files open at once; mirrors the native store's own cap, which evicts the oldest. */
export const HUNT_MAX_OPEN = 2;
/** One load covers this far past the requested end, so window extensions rarely reload. */
const WINDOW_SLACK_MS = 24 * 60 * 60 * 1000;
/** The host's file listing is fetched at most this often. */
const LISTING_TTL_MS = 24 * 60 * 60 * 1000;
/** A country whose file failed to land is not asked again before this passes. */
const COUNTRY_FAILURE_TTL_MS = 60 * 60 * 1000;

/** A bare channel the hunt may cover: the playlist's tvg-id names the country. */
export interface HuntChannel {
  channelId: string;
  tvgId: string;
  name: string;
}

/** The matcher's normalization: case, punctuation and quality tokens carry no identity. */
export function cleanKey(value: string): string {
  return value
    .toLowerCase()
    .replace(/\b(hd|sd|fhd|uhd|4k|tv)\b/g, "")
    .replace(/[^a-z0-9]/g, "");
}

/** The country a tvg-id names ("BBCNews.uk@HD" -> "UK"), or null for one without a suffix. */
export function tvgCountry(tvgId: string): string | null {
  const base = tvgId.split("@")[0];
  const match = /\.([a-z]{2})$/i.exec(base);
  return match ? match[1].toUpperCase() : null;
}

/** A playlist channel's match keys: the tvg-id stem, then the display name bare of qualifiers. */
export function channelKeys(tvgId: string, name: string): string[] {
  const stem = tvgId.split("@")[0].replace(/\.\w+$/, "");
  const bareName = name
    .replace(/\s*\(.*\)\s*$/, "")
    .replace(/\s*\[.*\]\s*$/, "")
    .trim();
  return [...new Set([cleanKey(stem), cleanKey(bareName)].filter(Boolean))];
}

/**
 * Every cleaned key (id stem and display-names) of a guide's channels, keys shared by two
 * channels dropped: an ambiguous name matches nothing.
 */
export function buildGuideIndex(channels: readonly { id: string; displayNames: string[] }[]): Map<string, string> {
  const index = new Map<string, string>();
  const ambiguous = new Set<string>();
  for (const channel of channels) {
    const keys = new Set([cleanKey(channel.id.replace(/\.\w+$/, "")), ...channel.displayNames.map(cleanKey)]);
    for (const key of keys) {
      if (!key) continue;
      if (index.has(key) && index.get(key) !== channel.id) ambiguous.add(key);
      else index.set(key, channel.id);
    }
  }
  for (const key of ambiguous) index.delete(key);
  return index;
}

interface OpenCountryGuide {
  file: string;
  token: string;
  from: number;
  to: number;
  index: Map<string, string>;
}

/** Open country guides in use order, newest last; past the cap the oldest closes. */
let open: OpenCountryGuide[] = [];
const opening = new Map<string, Promise<OpenCountryGuide | null>>();
const countryFailures = new Map<string, number>();
let listing: { at: number; files: Set<string> } | null = null;
/** Bumped by reset, so an open that outlived a server switch writes nothing back. */
let epoch = 0;

/** The host's published file names, at most daily; null while the host is unreachable. */
async function hostListing(): Promise<Set<string> | null> {
  if (listing && Date.now() - listing.at < LISTING_TTL_MS) return listing.files;
  try {
    const response = await fetch(HOST, { signal: AbortSignal.timeout(15_000) });
    if (!response.ok) return null;
    const text = await response.text();
    const files = new Set([...text.matchAll(/epg_ripper_([A-Z0-9_]+)\.xml\.gz/g)].map((match) => match[1]));
    if (files.size === 0) return null;
    listing = { at: Date.now(), files };
    return files;
  } catch {
    return null;
  }
}

/** The hosted file for a country ("US" -> "US1"), or null when the host lists none. */
function countryFile(country: string, files: Set<string>): string | null {
  return [1, 2, 3].map((n) => `${country}${n}`).find((name) => files.has(name)) ?? null;
}

async function openCountry(file: string, windowMs: { from: number; to: number }): Promise<OpenCountryGuide | null> {
  const held = open.find((guide) => guide.file === file);
  if (held && held.from <= windowMs.from && held.to >= windowMs.to) {
    // Freshly used: it moves to the back of the eviction order.
    open = [...open.filter((guide) => guide !== held), held];
    return held;
  }
  const pending = opening.get(file);
  if (pending) return pending;
  const gen = epoch;
  const task = (async (): Promise<OpenCountryGuide | null> => {
    try {
      if (held) {
        open = open.filter((guide) => guide !== held);
        closeGuide(held.token).catch(() => {});
      }
      const target = { from: windowMs.from, to: windowMs.to + WINDOW_SLACK_MS };
      const fileUri = await cachedGuideFile(`${HOST}epg_ripper_${file}.xml.gz`);
      const { token, stats } = await loadGuide(fileUri, target);
      if (gen !== epoch) {
        closeGuide(token).catch(() => {});
        return null;
      }
      const index = buildGuideIndex(await guideChannels(token));
      const guide: OpenCountryGuide = { file, token, from: target.from, to: target.to, index };
      open.push(guide);
      while (open.length > HUNT_MAX_OPEN) {
        const oldest = open.shift()!;
        closeGuide(oldest.token).catch(() => {});
      }
      logger.info("Country guide hunted", { service: "GuideHunt", file, channels: index.size, programmes: stats?.programmes ?? 0 });
      return guide;
    } catch (error) {
      countryFailures.set(file, Date.now());
      logger.debug("Country guide hunt failed", { service: "GuideHunt", file, error: String(error) });
      return null;
    } finally {
      opening.delete(file);
    }
  })();
  opening.set(file, task);
  return task;
}

/**
 * Programmes for the given bare channels from hosted per-country guides, shaped as the server's.
 * At most the two most-demanded countries are read per call; anything unmatched, unhosted or
 * failing simply contributes nothing.
 */
export async function huntPrograms(channels: readonly HuntChannel[], windowMs: { from: number; to: number }): Promise<JellyfinProgram[]> {
  if (channels.length === 0 || !isLiveSourcesAvailable()) return [];
  const byCountry = new Map<string, HuntChannel[]>();
  for (const channel of channels) {
    const country = tvgCountry(channel.tvgId);
    if (country) byCountry.set(country, [...(byCountry.get(country) ?? []), channel]);
  }
  if (byCountry.size === 0) return [];
  const files = await hostListing();
  if (!files) return [];
  const wanted = [...byCountry.entries()]
    .sort((a, b) => b[1].length - a[1].length)
    .flatMap(([country, list]) => {
      const file = countryFile(country, files);
      if (!file) return [];
      const failedAt = countryFailures.get(file);
      if (failedAt !== undefined && Date.now() - failedAt < COUNTRY_FAILURE_TTL_MS) return [];
      return [{ file, list }];
    })
    .slice(0, HUNT_MAX_OPEN);
  const result: JellyfinProgram[] = [];
  for (const { file, list } of wanted) {
    const guide = await openCountry(file, windowMs);
    if (!guide) continue;
    const byGuideId = new Map<string, string[]>();
    for (const channel of list) {
      const hit = channelKeys(channel.tvgId, channel.name)
        .map((key) => guide.index.get(key))
        .find(Boolean);
      if (hit) byGuideId.set(hit, [...(byGuideId.get(hit) ?? []), channel.channelId]);
    }
    if (byGuideId.size === 0) continue;
    try {
      const programmes = await guideProgrammes(guide.token, [...byGuideId.keys()], windowMs);
      for (const programme of programmes) {
        for (const channelId of byGuideId.get(programme.channel) ?? []) {
          result.push({
            Id: `${EXTERNAL_GUIDE_PREFIX}${channelId}:${programme.start}`,
            Name: programme.title,
            ChannelId: channelId,
            StartDate: new Date(programme.start).toISOString(),
            EndDate: programme.stop !== null ? new Date(programme.stop).toISOString() : undefined,
            Overview: programme.desc ?? undefined,
            EpisodeTitle: programme.subTitle ?? undefined,
            Genres: programme.categories,
          });
        }
      }
    } catch (error) {
      // The native store evicted the token under us: drop it; the next hunt reopens.
      open = open.filter((held) => held !== guide);
      logger.debug("Country guide read failed", { service: "GuideHunt", file, error: String(error) });
    }
  }
  return result;
}

/** Forgets every open guide and failure (server switch, sign-out). */
export function resetGuideHunt(): void {
  epoch += 1;
  for (const guide of open) closeGuide(guide.token).catch(() => {});
  open = [];
  opening.clear();
  countryFailures.clear();
  listing = null;
}
