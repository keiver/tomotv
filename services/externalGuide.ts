/**
 * externalGuide.ts
 *
 * Guide programmes for channels the server has none for, from the XMLTV guides the viewer adds
 * and the ones their tuner playlists declare. Each guide is cached on disk (guideFileCache),
 * streams into the native store once per window, and is asked in order: a channel an earlier
 * guide covered is not asked again. Every guide reports its own status and what it matched.
 */
import { cachedGuideFile, clearGuideFileCache } from "@/services/guideFileCache";
import { closeGuide, guideChannels, guideProgrammes, isLiveSourcesAvailable, loadGuide } from "@/services/liveSources";
import type { JellyfinProgram } from "@/types/jellyfin";
import { EXTERNAL_GUIDE_PREFIX, GUIDE_SPAN_MINUTES, guideWindowStart, MINUTE_MS } from "@/utils/guide";
import { buildGuideIndex, matchChannels, type GuideChannelRequest, type GuideIndex, type MatchVia } from "@/utils/guideMatch";
import { logger } from "@/utils/logger";

/** One load covers this far past the requested end, so window extensions rarely reload. */
const WINDOW_SLACK_MS = 24 * 60 * 60 * 1000;
/** A failed guide open is not retried before this passes, or every page fetch re-attempts it. */
const FAILURE_TTL_MS = 5 * 60 * 1000;

export type GuideSourceState = "waiting" | "downloading" | "reading" | "ready" | "error";

export interface GuideMatch {
  channelId: string;
  name: string;
  via: MatchVia;
}

/** What one guide is doing and what it has given, as the Guide Sources screen shows it. */
export interface GuideSourceStatus {
  url: string;
  state: GuideSourceState;
  /** 0..1 while downloading, when the server sends a length. */
  progress: number | null;
  /** The guide's own channel and programme counts inside the loaded window. */
  channels: number | null;
  programmes: number | null;
  loadedAt: number | null;
  /** Channels asked of this guide so far, and the ones it paired. */
  asked: number;
  matched: readonly GuideMatch[];
}

interface OpenGuide {
  token: string;
  from: number;
  to: number;
  index: GuideIndex;
}

interface Source {
  url: string;
  open: OpenGuide | null;
  opening: Promise<OpenGuide> | null;
  failedAt: number | null;
  /** Set by a refresh: the next open re-downloads past the cache's freshness window. */
  force: boolean;
  asked: Set<string>;
  matched: Map<string, GuideMatch>;
  status: GuideSourceStatus;
}

const sources = new Map<string, Source>();
let snapshot: Readonly<Record<string, GuideSourceStatus>> = {};
let busy = false;
const listeners = new Set<() => void>();

function publish(): void {
  const next: Record<string, GuideSourceStatus> = {};
  for (const [url, source] of sources) next[url] = source.status;
  snapshot = next;
  busy = Object.values(next).some((status) => status.state === "downloading" || status.state === "reading");
  for (const listener of listeners) listener();
}

function setStatus(source: Source, patch: Partial<GuideSourceStatus>): void {
  source.status = { ...source.status, ...patch };
  publish();
}

function sourceFor(url: string): Source {
  let source = sources.get(url);
  if (!source) {
    source = {
      url,
      open: null,
      opening: null,
      failedAt: null,
      force: false,
      asked: new Set(),
      matched: new Map(),
      status: { url, state: "waiting", progress: null, channels: null, programmes: null, loadedAt: null, asked: 0, matched: [] },
    };
    sources.set(url, source);
  }
  return source;
}

function close(source: Source): void {
  if (source.open) closeGuide(source.open.token).catch(() => {});
  source.open = null;
}

/** Every guide's status by URL; a guide nothing has asked yet is absent. */
export function guideSourceStatuses(): Readonly<Record<string, GuideSourceStatus>> {
  return snapshot;
}

/** Whether any guide is downloading or being read, for the HUD's scan. */
export function guideSourcesBusy(): boolean {
  return busy;
}

export function subscribeGuideSources(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** The guides to ask, in order: the viewer's own, then the playlists' declared ones, less those switched off. */
export function activeGuideUrls(preferences: { guideUrls: readonly string[]; guideSourcesOff: readonly string[] }, declared: readonly string[]): string[] {
  const off = new Set(preferences.guideSourcesOff);
  return [...new Set([...preferences.guideUrls, ...declared])].filter((url) => !off.has(url));
}

async function openFromUrl(source: Source, target: { from: number; to: number }): Promise<OpenGuide> {
  setStatus(source, { state: "downloading", progress: null });
  const force = source.force;
  source.force = false;
  const fileUri = await cachedGuideFile(
    source.url,
    ({ bytesWritten, totalBytes }) => setStatus(source, { state: "downloading", progress: totalBytes > 0 ? Math.min(1, bytesWritten / totalBytes) : null }),
    { force },
  );
  setStatus(source, { state: "reading", progress: null });
  // 0: this service closes its own guides, so the native store never evicts one still asked.
  const { token, stats } = await loadGuide(fileUri, target, "external", 0);
  try {
    const channels = await guideChannels(token);
    setStatus(source, { state: "ready", channels: stats?.channels ?? channels.length, programmes: stats?.programmes ?? null, loadedAt: Date.now() });
    return { token, from: target.from, to: target.to, index: buildGuideIndex(channels) };
  } catch (error) {
    closeGuide(token).catch(() => {});
    throw error;
  }
}

async function ensureOpen(source: Source, windowMs: { from: number; to: number }): Promise<OpenGuide> {
  const covers = (guide: OpenGuide | null): guide is OpenGuide => !!guide && guide.from <= windowMs.from && guide.to >= windowMs.to;
  if (covers(source.open)) return source.open;
  if (source.opening) {
    const pending = await source.opening.catch(() => null);
    if (covers(pending)) return pending;
  }
  if (source.failedAt !== null && Date.now() - source.failedAt < FAILURE_TTL_MS) throw new Error("Guide open skipped after a recent failure.");
  const target = { from: windowMs.from, to: windowMs.to + WINDOW_SLACK_MS };
  const opening = (async () => {
    close(source);
    try {
      const guide = await openFromUrl(source, target);
      // A reset or removal while this loaded dropped the source: its guide goes with it.
      if (sources.get(source.url) !== source) {
        closeGuide(guide.token).catch(() => {});
        throw new Error("Guide source was removed while it loaded.");
      }
      source.open = guide;
      source.failedAt = null;
      return guide;
    } catch (error) {
      source.failedAt = Date.now();
      if (sources.get(source.url) === source) setStatus(source, { state: "error", progress: null });
      throw error;
    }
  })();
  source.opening = opening;
  try {
    return await opening;
  } finally {
    if (source.opening === opening) source.opening = null;
  }
}

/** Closes and forgets the guides no longer in `urls` (removed or switched off). */
function prune(urls: readonly string[]): void {
  const keep = new Set(urls);
  let changed = false;
  for (const [url, source] of sources) {
    if (keep.has(url)) continue;
    close(source);
    sources.delete(url);
    changed = true;
  }
  if (changed) publish();
}

/** Loads a guide for the window the guide screen opens on, so a URL just added reports what it holds. */
export async function preloadGuide(url: string): Promise<void> {
  if (!isLiveSourcesAvailable()) return;
  const from = guideWindowStart(Date.now());
  await ensureOpen(sourceFor(url), { from, to: from + GUIDE_SPAN_MINUTES * MINUTE_MS }).catch((error) => logger.warn("Guide preload failed", error, { service: "ExternalGuide", url }));
}

/** Closes and forgets one guide at once (removed or switched off); its file stays until cleared. */
export function forgetGuide(url: string): void {
  const source = sources.get(url);
  if (!source) return;
  close(source);
  sources.delete(url);
  publish();
}

/** The HUD's refresh: drops every open guide; each re-downloads past the cache window when next asked. */
export function refreshExternalGuide(): void {
  for (const source of sources.values()) {
    close(source);
    source.failedAt = null;
    source.force = true;
  }
}

/** Forgets every guide and its failures, so the next request reloads (sign-out, server switch). */
export function resetExternalGuide(): void {
  for (const source of sources.values()) close(source);
  sources.clear();
  publish();
}

/** Deletes every downloaded guide from the device and forgets them; the next guide load downloads again. */
export function clearDownloadedGuides(): void {
  resetExternalGuide();
  clearGuideFileCache();
}

/**
 * Programmes for the given channels from the guides at `urls`, asked in order, shaped as the
 * server's with ids the program panel never fetches. A guide that fails logs and gives nothing,
 * and the next guide is still asked.
 */
export async function fetchExternalPrograms(urls: readonly string[], channels: readonly GuideChannelRequest[], windowMs: { from: number; to: number }): Promise<JellyfinProgram[]> {
  prune(urls);
  if (urls.length === 0 || channels.length === 0 || !isLiveSourcesAvailable()) return [];
  const names = new Map(channels.map((channel) => [channel.channelId, channel.name]));
  const result: JellyfinProgram[] = [];
  let remaining = channels;
  for (const url of urls) {
    if (remaining.length === 0) break;
    const source = sourceFor(url);
    let guide: OpenGuide | null = null;
    try {
      guide = await ensureOpen(source, windowMs);
      const matches = matchChannels(guide.index, remaining);
      for (const channel of remaining) source.asked.add(channel.channelId);
      for (const [channelId, { via }] of matches) source.matched.set(channelId, { channelId, name: names.get(channelId) ?? "", via });
      setStatus(source, { asked: source.asked.size, matched: Array.from(source.matched.values()) });
      if (matches.size === 0) continue;
      const byGuideId = new Map<string, string[]>();
      for (const [channelId, { guideId }] of matches) byGuideId.set(guideId, [...(byGuideId.get(guideId) ?? []), channelId]);
      const programmes = await guideProgrammes(guide.token, Array.from(byGuideId.keys()), windowMs);
      const covered = new Set<string>();
      for (const programme of programmes) {
        for (const channelId of byGuideId.get(programme.channel) ?? []) {
          covered.add(channelId);
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
      // A channel this guide names but lists nothing for in the window is still asked of the next one.
      remaining = remaining.filter((channel) => !covered.has(channel.channelId));
    } catch (error) {
      // A read of an open guide failed (the native store closed it): the next fetch reopens it.
      if (guide && source.open === guide) source.open = null;
      logger.warn("External guide load failed", error, { service: "ExternalGuide", url });
    }
  }
  return result;
}
