/**
 * externalGuide.ts
 *
 * Guide programmes for channels the server has none for, from an XMLTV the viewer names or the
 * playlist declares (the iptv-org/epg output format: channel ids are tvg-id bases). The file is
 * cached on disk (guideFileCache), streams into the native store once per window, and is queried
 * per page. Every load emits status events the GuideHUD renders.
 */
import { cachedGuideFile } from "@/services/guideFileCache";
import { closeGuide, guideProgrammes, isLiveSourcesAvailable, loadGuide } from "@/services/liveSources";
import type { JellyfinProgram } from "@/types/jellyfin";
import { EXTERNAL_GUIDE_PREFIX } from "@/utils/guide";
import { logger } from "@/utils/logger";

/** One load covers this far past the requested end, so window extensions rarely reload. */
const WINDOW_SLACK_MS = 24 * 60 * 60 * 1000;
/** A failed guide open is not retried before this passes, or every page fetch re-attempts it. */
const FAILURE_TTL_MS = 5 * 60 * 1000;

export type GuideStatus =
  | { state: "idle" }
  | { state: "downloading"; url: string; progress: number | null }
  | { state: "parsing"; url: string }
  | { state: "ready"; url: string; channels: number; programmes: number; at: number }
  | { state: "error"; url: string };

interface OpenGuide {
  url: string;
  token: string;
  from: number;
  to: number;
}

let open: OpenGuide | null = null;
let opening: Promise<OpenGuide> | null = null;
let failure: { url: string; at: number } | null = null;
/** Set by the HUD's refresh: the next open re-downloads past the cache's freshness window. */
let forceNext = false;

let status: GuideStatus = { state: "idle" };
const listeners = new Set<(status: GuideStatus) => void>();

function emit(next: GuideStatus): void {
  status = next;
  for (const listener of listeners) listener(next);
}

/** The current guide status, for a subscriber's first render. */
export function guideStatus(): GuideStatus {
  return status;
}

export function subscribeGuideStatus(listener: (status: GuideStatus) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** A tvg-id and the base its guide names: `A.us@SD` is listed as `A.us` in iptv-org/epg output. */
function candidates(tvgId: string): string[] {
  const base = tvgId.split("@")[0];
  return base === tvgId ? [tvgId] : [tvgId, base];
}

async function openFromUrl(url: string, target: { from: number; to: number }): Promise<OpenGuide> {
  emit({ state: "downloading", url, progress: null });
  const force = forceNext;
  forceNext = false;
  const fileUri = await cachedGuideFile(
    url,
    ({ bytesWritten, totalBytes }) => {
      emit({ state: "downloading", url, progress: totalBytes > 0 ? Math.min(1, bytesWritten / totalBytes) : null });
    },
    { force },
  );
  emit({ state: "parsing", url });
  const { token, stats } = await loadGuide(fileUri, target);
  emit({ state: "ready", url, channels: stats?.channels ?? 0, programmes: stats?.programmes ?? 0, at: Date.now() });
  return { url, token, from: target.from, to: target.to };
}

async function ensureOpen(url: string, windowMs: { from: number; to: number }): Promise<OpenGuide> {
  if (open && open.url === url && open.from <= windowMs.from && open.to >= windowMs.to) return open;
  if (opening) {
    const pending = await opening.catch(() => null);
    if (pending && pending.url === url && pending.from <= windowMs.from && pending.to >= windowMs.to) return pending;
  }
  if (failure && failure.url === url && Date.now() - failure.at < FAILURE_TTL_MS) throw new Error("Guide open skipped after a recent failure.");
  const target = { from: windowMs.from, to: windowMs.to + WINDOW_SLACK_MS };
  opening = (async () => {
    if (open) {
      closeGuide(open.token).catch(() => {});
      open = null;
    }
    try {
      open = await openFromUrl(url, target);
      failure = null;
      return open;
    } catch (error) {
      failure = { url, at: Date.now() };
      emit({ state: "error", url });
      throw error;
    }
  })();
  try {
    return await opening;
  } finally {
    opening = null;
  }
}

/** The HUD's refresh: drops the open guide and re-downloads past the cache window on the next fetch. */
export function refreshExternalGuide(): void {
  if (open) closeGuide(open.token).catch(() => {});
  open = null;
  failure = null;
  forceNext = true;
}

/** Forgets the loaded guide and its failures, so the next request reloads (URL change, sign-out). */
export function resetExternalGuide(): void {
  if (open) closeGuide(open.token).catch(() => {});
  open = null;
  failure = null;
  emit({ state: "idle" });
}

/**
 * Programmes for the given channels from the guide at `url`, shaped as the server's, with ids the
 * program panel never fetches. Channels the guide does not name come back empty; a failed guide
 * load logs and returns nothing, and playback is untouched either way.
 */
export async function fetchExternalPrograms(url: string, channels: readonly { channelId: string; tvgId: string }[], windowMs: { from: number; to: number }): Promise<JellyfinProgram[]> {
  if (!url || channels.length === 0 || !isLiveSourcesAvailable()) return [];
  try {
    const guide = await ensureOpen(url, windowMs);
    const byGuideId = new Map<string, string[]>();
    for (const channel of channels) {
      for (const candidate of candidates(channel.tvgId)) {
        byGuideId.set(candidate, [...(byGuideId.get(candidate) ?? []), channel.channelId]);
      }
    }
    const programmes = await guideProgrammes(guide.token, Array.from(byGuideId.keys()), windowMs);
    const result: JellyfinProgram[] = [];
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
    return result;
  } catch (error) {
    logger.warn("External guide load failed", error, { service: "ExternalGuide" });
    return [];
  }
}
