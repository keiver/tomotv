/**
 * externalGuide.ts
 *
 * Guide programmes for channels the server has none for, from the XMLTV guides the viewer adds
 * and the ones their tuner playlists declare. Each guide is cached on disk (guideFileCache),
 * streams into the native store once per window, and is asked in order: a channel an earlier
 * guide covered is not asked again. Every guide reports its own status and what it matched.
 */
import { closeGuide, engineLog, guideChannels, guideProgrammes, isLiveSourcesAvailable, loadGuide, searchGuide, type GuideProgramme } from "@keiver/tomo-engine";
import { liveGuideChannels, type GuideChannelCandidate } from "./config";
import { cachedGuideFile, clearGuideFileCache, guideFileInfo, onGuideFileRefreshed, PlaybackHoldError } from "./guideFileCache";
import { buildGuideIndex, matchChannels, type GuideChannelRequest, type GuideIndex, type MatchVia } from "./guideMatch";
import { isPlaybackHeld, onPlaybackHoldChange } from "./playbackHold";
import { GUIDE_SPAN_MINUTES, guideWindowStart, MINUTE_MS } from "./time";
import { AppState } from "react-native";

/** One load covers this far past the requested end, so window extensions rarely reload. */
const WINDOW_SLACK_MS = 24 * 60 * 60 * 1000;
/** A failed guide open is not retried before this passes, or every page fetch re-attempts it. */
const FAILURE_TTL_MS = 5 * 60 * 1000;

/** `paused`: its download waits for playback to let go of the link. */
export type GuideSourceState = "waiting" | "paused" | "downloading" | "reading" | "ready" | "error";

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
  /** The asked channels it did not pair. */
  unmatched: readonly { channelId: string; name: string }[];
}

interface OpenGuide {
  token: string;
  from: number;
  to: number;
  index: GuideIndex;
  /** When the file it was parsed from was saved: a newer file on disk reopens the guide. */
  savedAt: number;
  /** The channels it kept programmes for; a read asking about another reopens it. */
  coverage: Coverage;
  /** Reads in flight on this token; a retired guide closes when the last one ends. */
  readers: number;
  retired: boolean;
}

interface Source {
  url: string;
  open: OpenGuide | null;
  opening: Promise<OpenGuide> | null;
  failedAt: number | null;
  /** Set by a refresh: the next open re-downloads past the cache's freshness window. */
  force: boolean;
  /** Bumped by a refresh, so an open that started before it lands closed instead of kept. */
  epoch: number;
  /** A read found no copy during playback, so its file downloads after: the status reads paused while playback lasts, waiting after. */
  downloadAfterPlayback: boolean;
  /** Channel name by id. */
  asked: Map<string, string>;
  /** Requests this guide was asked that the app's channel list lacks, kept for every later load. */
  extras: GuideChannelCandidate[];
  extraKeys: Set<string>;
  matched: Map<string, GuideMatch>;
  status: GuideSourceStatus;
}

/** Each channel a guide kept programmes for, with the tvg keys and names it paired by; null keeps every channel. */
type Coverage = Map<string, { tvgIds: Set<string>; tvgNames: Set<string>; names: Set<string> }> | null;

function coverageOf(list: readonly GuideChannelCandidate[]): NonNullable<Coverage> {
  const coverage: NonNullable<Coverage> = new Map();
  for (const candidate of list) {
    let entry = coverage.get(candidate.channelId);
    if (!entry) coverage.set(candidate.channelId, (entry = { tvgIds: new Set(), tvgNames: new Set(), names: new Set() }));
    if (candidate.tvgId) entry.tvgIds.add(candidate.tvgId);
    if (candidate.tvgName) entry.tvgNames.add(candidate.tvgName);
    for (const name of candidate.names) if (name) entry.names.add(name);
  }
  return coverage;
}

/** Each matching pass reads one field, so a request is covered when every field it has was in the list. */
function requestCovered(coverage: Coverage, request: GuideChannelRequest): boolean {
  if (!coverage) return true;
  const entry = coverage.get(request.channelId);
  return !!entry && (!request.tvgId || entry.tvgIds.has(request.tvgId)) && (!request.tvgName || entry.tvgNames.has(request.tvgName)) && (!request.name || entry.names.has(request.name));
}

/** The app's channels whose programmes a load keeps, plus what this source was asked beyond them; null keeps every channel. */
async function channelsToKeep(source: Source, asked: readonly GuideChannelRequest[]): Promise<GuideChannelCandidate[] | null> {
  const provider = liveGuideChannels();
  const all = provider ? await provider().catch(() => null) : null;
  if (!all || all.length === 0) return null;
  const listed = coverageOf(all);
  for (const request of asked) {
    const key = [request.channelId, request.tvgId ?? "", request.tvgName ?? "", request.name].join("\u0000");
    if (requestCovered(listed, request) || source.extraKeys.has(key)) continue;
    source.extraKeys.add(key);
    source.extras.push({ channelId: request.channelId, tvgId: request.tvgId, tvgName: request.tvgName, names: request.name ? [request.name] : [] });
  }
  return [...all, ...source.extras];
}

const sources = new Map<string, Source>();
let snapshot: Readonly<Record<string, GuideSourceStatus>> = {};
let busy = false;
const listeners = new Set<() => void>();
/** The guides the last fetch asked, whose cached files the download sweep keeps. */
let activeUrls: readonly string[] = [];

class StaleOpenError extends Error {}

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
      epoch: 0,
      downloadAfterPlayback: false,
      asked: new Map(),
      extras: [],
      extraKeys: new Set(),
      matched: new Map(),
      status: { url, state: "waiting", progress: null, channels: null, programmes: null, loadedAt: null, asked: 0, matched: [], unmatched: [] },
    };
    sources.set(url, source);
  }
  return source;
}

/** Marks the guide done with; the token closes at once, or when its last in-flight read ends. */
function retire(guide: OpenGuide): void {
  guide.retired = true;
  if (guide.readers === 0) closeGuide(guide.token).catch(() => {});
}

function close(source: Source): void {
  if (source.open) retire(source.open);
  source.open = null;
}

/** Holds the token open across `read`, so a reopen landing meanwhile cannot close it mid-read. */
async function readGuide<T>(guide: OpenGuide, read: () => Promise<T>): Promise<T> {
  guide.readers++;
  try {
    return await read();
  } finally {
    guide.readers--;
    if (guide.retired && guide.readers === 0) closeGuide(guide.token).catch(() => {});
  }
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

/** When the guide file at `url` was saved to disk; 0 while there is none. */
function fileSavedAt(url: string): number {
  return guideFileInfo(url)?.savedAt ?? 0;
}

async function openFromUrl(source: Source, target: { from: number; to: number }, asked: readonly GuideChannelRequest[]): Promise<OpenGuide> {
  setStatus(source, { state: "downloading", progress: null });
  const force = source.force;
  source.force = false;
  const fileUri = await cachedGuideFile(
    source.url,
    ({ bytesWritten, totalBytes }) => setStatus(source, { state: "downloading", progress: totalBytes > 0 ? Math.min(1, bytesWritten / totalBytes) : null }),
    { force, keep: activeUrls },
  );
  setStatus(source, { state: "reading", progress: null });
  // Read before the parse: a new file arriving meanwhile can cost one extra reopen, never a stale guide.
  const savedAt = fileSavedAt(source.url);
  const keep = await channelsToKeep(source, asked);
  const channelsSent = keep?.map(({ tvgId, tvgName, names }) => ({ tvgId, tvgName, names }));
  // 0: this service closes its own guides, so the native store never evicts one still asked.
  const { token, stats } = await loadGuide(fileUri, target, "external", 0, channelsSent);
  try {
    const channels = await guideChannels(token);
    // The device-measurement line: parse and pre-fold cost, and app memory before, at the peak and after,
    // so this guide's own share is the difference.
    engineLog().info("External guide loaded", {
      service: "ExternalGuide",
      url: source.url,
      channels: stats?.channels ?? channels.length,
      programmes: stats?.programmes ?? null,
      workMs: stats?.workMs ?? null,
      foldMs: stats?.foldMs ?? null,
      inflatedBytes: stats?.inflatedBytes ?? null,
      footprintBeforeBytes: stats?.footprintBeforeBytes ?? null,
      peakFootprintBytes: stats?.peakFootprintBytes ?? null,
      footprintAfterBytes: stats?.footprintAfterBytes ?? null,
      appChannels: keep?.length ?? null,
      unmatchedSkipped: stats?.unmatched ?? null,
      passes: stats?.passes ?? null,
    });
    setStatus(source, { state: "ready", channels: stats?.channels ?? channels.length, programmes: stats?.programmes ?? null, loadedAt: Date.now() });
    return { token, from: target.from, to: target.to, index: buildGuideIndex(channels), savedAt, coverage: keep ? coverageOf(keep) : null, readers: 0, retired: false };
  } catch (error) {
    closeGuide(token).catch(() => {});
    throw error;
  }
}

let memoryWired = false;

/** Under memory pressure every open guide is released (a guide being read closes when the read ends); the next read opens it again. */
function wireMemoryWarning(): void {
  if (memoryWired) return;
  memoryWired = true;
  AppState.addEventListener("memoryWarning", () => {
    const open = [...sources.values()].filter((source) => source.open);
    if (open.length === 0) return;
    for (const source of open) close(source);
    engineLog().info("Guides released under memory pressure", { service: "ExternalGuide", count: open.length });
  });
}

async function ensureOpen(source: Source, windowMs: { from: number; to: number }, asked: readonly GuideChannelRequest[]): Promise<OpenGuide> {
  wireMemoryWarning();
  const covers = (guide: OpenGuide | null): guide is OpenGuide =>
    !!guide && guide.from <= windowMs.from && guide.to >= windowMs.to && guide.savedAt === fileSavedAt(source.url) && asked.every((request) => requestCovered(guide.coverage, request));
  const startsBefore = (guide: OpenGuide | null) => guide !== null && windowMs.from < guide.from;
  if (covers(source.open)) return source.open;
  // Waits out every open in flight, so two callers never each open one and orphan the other's handle.
  let pending = source.opening;
  while (pending) {
    const landed = await pending.catch(() => null);
    if (covers(landed)) return landed;
    if (covers(source.open)) return source.open;
    pending = source.opening !== pending ? source.opening : null;
  }
  if (source.failedAt !== null && Date.now() - source.failedAt < FAILURE_TTL_MS) throw new Error("Guide open skipped after a recent failure.");
  // The load takes the union of the open window and the asked one (plus slack past the end, and
  // further back when the view rewinds), so callers with different windows settle on one guide.
  // The awaited pending opens above repopulate source.open: the control-flow narrowing to null is stale.
  const open = source.open as OpenGuide | null;
  const from = startsBefore(open) ? windowMs.from - WINDOW_SLACK_MS : windowMs.from;
  const target = { from: Math.min(open?.from ?? from, from), to: Math.max(open?.to ?? 0, windowMs.to + WINDOW_SLACK_MS) };
  const epoch = source.epoch;
  const opening = (async () => {
    try {
      const guide = await openFromUrl(source, target, asked);
      // A reset, removal or refresh while this loaded retired it: its guide goes with it.
      if (sources.get(source.url) !== source || source.epoch !== epoch) {
        closeGuide(guide.token).catch(() => {});
        throw new StaleOpenError("Guide open was retired while it loaded.");
      }
      // The outgoing guide serves its readers to the end; the token closes when the last one is done.
      const previous = source.open;
      source.open = guide;
      source.failedAt = null;
      source.downloadAfterPlayback = false;
      if (previous) retire(previous);
      return guide;
    } catch (error) {
      if (error instanceof StaleOpenError) throw error;
      // No copy while playback holds the link: not a failure, the file arrives after playback.
      const held = error instanceof PlaybackHoldError;
      if (held) source.downloadAfterPlayback = true;
      else source.failedAt = Date.now();
      if (sources.get(source.url) === source) setStatus(source, { state: held ? "paused" : "error", progress: null });
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
  activeUrls = urls;
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
  await ensureOpen(sourceFor(url), { from, to: from + GUIDE_SPAN_MINUTES * MINUTE_MS }, []).catch((error) => {
    if (!(error instanceof PlaybackHoldError)) engineLog().warn("Guide preload failed", error, { service: "ExternalGuide", url });
  });
}

const refreshedListeners = new Set<() => void>();

/** Runs when a guide file that playback held back has finished downloading: a screen showing listings reads them again. */
export function subscribeGuideRefreshed(listener: () => void): () => void {
  refreshedListeners.add(listener);
  return () => {
    refreshedListeners.delete(listener);
  };
}

// A guide open on the older file is replaced at the next read (`savedAt`). A guide a read asked for
// during playback opens now, so its screens show what it holds; any other republishes its status, so
// a screen showing the file's time sees the new one.
onGuideFileRefreshed((url) => {
  const source = sources.get(url);
  if (!source) return;
  if (source.downloadAfterPlayback) {
    source.downloadAfterPlayback = false;
    void preloadGuide(url);
  } else {
    setStatus(source, {});
  }
  for (const listener of [...refreshedListeners]) listener();
});

// A guide waiting for its file reads paused while playback lasts, and waiting after it.
onPlaybackHoldChange(() => {
  const state: GuideSourceState = isPlaybackHeld() ? "paused" : "waiting";
  for (const source of sources.values()) {
    if (source.downloadAfterPlayback && !source.opening && source.status.state !== state) setStatus(source, { state, progress: null });
  }
});

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
    source.epoch++;
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

/** One guide programme, paired with the app channel it was matched to. */
export interface GuideListing {
  channelId: string;
  programme: GuideProgramme;
}

/** Match results per open guide, keyed by the request array's identity: a table-generation request
 *  list stays one object across queries, so repeat searches skip re-folding every channel name. */
const matchCache = new WeakMap<OpenGuide, WeakMap<readonly GuideChannelRequest[], ReturnType<typeof matchChannels>>>();

function matchFor(guide: OpenGuide, requests: readonly GuideChannelRequest[]): ReturnType<typeof matchChannels> {
  let byRequests = matchCache.get(guide);
  if (!byRequests) matchCache.set(guide, (byRequests = new WeakMap()));
  let found = byRequests.get(requests);
  if (!found) byRequests.set(requests, (found = matchChannels(guide.index, requests)));
  return found;
}

/**
 * Programmes for the given channels from the guides at `urls`, asked in order. A guide that fails
 * logs and gives nothing, and the next guide is still asked. A refresh distinguishes a successful
 * empty window from channels whose guides could not be read.
 */
export async function fetchExternalListingWindow(
  urls: readonly string[],
  channels: readonly GuideChannelRequest[],
  windowMs: { from: number; to: number },
  options: { openOnly?: boolean } = {},
): Promise<{ listings: GuideListing[]; failedChannelIds: string[] }> {
  prune(urls);
  if (urls.length === 0 || channels.length === 0) return { listings: [], failedChannelIds: [] };
  if (!isLiveSourcesAvailable()) return { listings: [], failedChannelIds: channels.map((channel) => channel.channelId) };
  const names = new Map(channels.map((channel) => [channel.channelId, channel.name]));
  const result: GuideListing[] = [];
  const failed = new Set<string>();
  let remaining = channels;
  for (const url of urls) {
    if (remaining.length === 0) break;
    const source = sourceFor(url);
    let guide: OpenGuide | null = null;
    let attempted = remaining.map((channel) => channel.channelId);
    try {
      if (options.openOnly) {
        // A guide not open over the window is passed over: this read never waits on a download or a parse.
        const open = source.open;
        if (!open || open.from > windowMs.from || open.to < windowMs.to) continue;
        guide = open;
      } else {
        guide = await ensureOpen(source, windowMs, remaining);
      }
      const matches = matchFor(guide, remaining);
      attempted = Array.from(matches.keys());
      for (const channel of remaining) source.asked.set(channel.channelId, channel.name);
      for (const [channelId, { via }] of matches) source.matched.set(channelId, { channelId, name: names.get(channelId) ?? "", via });
      const unmatched = Array.from(source.asked, ([channelId, name]) => ({ channelId, name })).filter((channel) => !source.matched.has(channel.channelId));
      setStatus(source, { asked: source.asked.size, matched: Array.from(source.matched.values()), unmatched });
      if (matches.size === 0) continue;
      const byGuideId = new Map<string, string[]>();
      for (const [channelId, { guideId }] of matches) byGuideId.set(guideId, [...(byGuideId.get(guideId) ?? []), channelId]);
      const open = guide;
      const programmes = await readGuide(open, () => guideProgrammes(open.token, Array.from(byGuideId.keys()), windowMs));
      const covered = new Set<string>();
      for (const programme of programmes) {
        for (const channelId of byGuideId.get(programme.channel) ?? []) {
          covered.add(channelId);
          result.push({ channelId, programme });
        }
      }
      // A channel this guide names but lists nothing for in the window is still asked of the next one.
      remaining = remaining.filter((channel) => !covered.has(channel.channelId));
    } catch (error) {
      for (const channelId of attempted) failed.add(channelId);
      // A read of an open guide failed (the native store lost it): the next fetch reopens it.
      if (guide && source.open === guide) close(source);
      if (!(error instanceof PlaybackHoldError)) engineLog().warn("External guide load failed", error, { service: "ExternalGuide", url });
    }
  }
  // A later guide with listings answers for a failed source. An empty fallback cannot tell us
  // whether the failed source removed its programmes, so retain those channels until a good read.
  return { listings: result, failedChannelIds: remaining.filter((channel) => failed.has(channel.channelId)).map((channel) => channel.channelId) };
}

/**
 * The programme airing at `atMs` on each channel, from the guides at `urls` already open, asked in
 * order: the latest programme already started. Channels nothing airs on are simply absent.
 */
export async function fetchExternalAiring(urls: readonly string[], channels: readonly GuideChannelRequest[], atMs: number): Promise<{ listings: GuideListing[]; failedChannelIds: string[] }> {
  const { listings, failedChannelIds } = await fetchExternalListingWindow(urls, channels, { from: atMs, to: atMs + MINUTE_MS }, { openOnly: true });
  const airing = new Map<string, GuideListing>();
  for (const listing of listings) {
    if (listing.programme.start > atMs) continue;
    const held = airing.get(listing.channelId);
    if (!held || listing.programme.start > held.programme.start) airing.set(listing.channelId, listing);
  }
  return { listings: [...airing.values()], failedChannelIds };
}

/**
 * Programmes in the window whose title, sub-title or description carries every word of `query`,
 * from the guides at `urls` asked in order, for the given channels: a channel an earlier guide
 * pairs is not asked again. Matched natively (searchGuide); a guide that fails logs and gives nothing.
 */
export async function searchExternalListings(
  urls: readonly string[],
  channels: readonly GuideChannelRequest[],
  windowMs: { from: number; to: number },
  query: string,
  limit: number,
): Promise<GuideListing[]> {
  if (urls.length === 0 || channels.length === 0 || !isLiveSourcesAvailable()) return [];
  const result: GuideListing[] = [];
  let remaining = channels;
  for (const url of urls) {
    if (remaining.length === 0) break;
    const source = sourceFor(url);
    let guide: OpenGuide | null = null;
    try {
      guide = await ensureOpen(source, windowMs, remaining);
      const matches = matchFor(guide, remaining);
      if (matches.size === 0) continue;
      const byGuideId = new Map<string, string[]>();
      for (const [channelId, { guideId }] of matches) byGuideId.set(guideId, [...(byGuideId.get(guideId) ?? []), channelId]);
      const open = guide;
      for (const programme of await readGuide(open, () => searchGuide(open.token, Array.from(byGuideId.keys()), windowMs, query, limit))) {
        for (const channelId of byGuideId.get(programme.channel) ?? []) result.push({ channelId, programme });
      }
      remaining = remaining.filter((channel) => !matches.has(channel.channelId));
    } catch (error) {
      if (guide && source.open === guide) close(source);
      if (!(error instanceof PlaybackHoldError)) engineLog().warn("External guide search failed", error, { service: "ExternalGuide", url });
    }
  }
  return result.sort((a, b) => a.programme.start - b.programme.start).slice(0, limit);
}
