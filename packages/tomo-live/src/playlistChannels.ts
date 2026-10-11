/**
 * playlistChannels.ts
 *
 * A channel table built from M3U playlists, parsed on device: the app names its sources and how
 * an entry becomes its channel id, and every list surface reads channels from here without any
 * server ingest. Rows are kept light (one object per channel), lookups are O(1), and a failed
 * reload serves the last good table. Identity is the app's: ids must be stable across reloads,
 * since favorites, health and frame caches key on them.
 */
import { closePlaylist, engineLog, loadPlaylist, playlistEntries, type PlaylistEntry } from "@keiver/tomo-engine";
import { cachedPlaylistFile } from "./guideFileCache";

/** Entries per native call when paging a playlist store out to JS: bounds each call's JSI
 *  conversion and JS object materialization, whatever the playlist's size. */
const ENTRY_PAGE = 1000;
/** A source is not reloaded before this passes, unless the app forces it. */
const FRESH_TTL_MS = 60 * 60 * 1000;
/** A failed load is not retried before this passes; the last good rows serve meanwhile. */
const FAILURE_TTL_MS = 5 * 60 * 1000;

export interface PlaylistChannel {
  /** The app's channel identity; stable across reloads. */
  id: string;
  name: string;
  /** tvg-chno / ch-number. */
  number: string | null;
  /** tvg-logo, loaded lazily by whichever tile renders it. */
  logoUrl: string | null;
  /** The stream URL, pipe headers stripped. */
  streamUrl: string;
  /** HTTP headers from #EXTVLCOPT lines and `url|Header=value` suffixes. */
  headers: Record<string, string>;
  /** The provider host whose connection budget a read spends. */
  originKey: string;
  groups: string[];
  tvgId: string | null;
  tvgName: string | null;
  radio: boolean;
  drm: boolean;
}

export interface PlaylistRows {
  rows: PlaylistChannel[];
  /** Guide URLs the playlist header declares (x-tvg-url / url-tvg). */
  tvgUrls: string[];
}

export interface PlaylistChannelSource {
  /** Stable identity for the source (a tuner's stored URL); the status key. */
  key: string;
  url: string;
  /** Where this device reads the playlist when that differs from `url`. */
  fetchUrl?: string;
  headers?: Record<string, string>;
  /** Streams and maps the playlist to rows; `enginePlaylistRows` is the stock loader. */
  loadRows: (source: PlaylistChannelSource) => Promise<PlaylistRows>;
}

export type PlaylistSourceState = "waiting" | "loading" | "ready" | "error";

export interface PlaylistSourceStatus {
  key: string;
  url: string;
  state: PlaylistSourceState;
  channels: number | null;
  loadedAt: number | null;
}

interface SourceRecord {
  source: PlaylistChannelSource;
  rows: PlaylistChannel[];
  tvgUrls: string[];
  loadedAt: number | null;
  failedAt: number | null;
  loading: Promise<void> | null;
  status: PlaylistSourceStatus;
}

const records = new Map<string, SourceRecord>();
/** Rebuilt from the records whenever one lands: the merged table every lookup reads. */
let byId = new Map<string, PlaylistChannel>();
let ordered: PlaylistChannel[] = [];
let groups = new Map<string, string[]>();
let tvgUrls: string[] = [];
let tvgUrlSources = new Map<string, string[]>();
let statuses: Readonly<Record<string, PlaylistSourceStatus>> = {};
const listeners = new Set<() => void>();
/** Bumped by reset, so a load that outlived a sign-out writes nothing back. */
let generation = 0;

/** The provider host of a stream URL, the key its connection budget hangs on. */
export function playlistOriginKey(url: string): string {
  const match = /^[a-z][a-z0-9+.-]*:\/\/(?:[^@/]*@)?(\[[^\]]+\]|[^/:?#]+)/i.exec(url);
  return match ? match[1].toLowerCase() : url;
}

/** One parsed entry as a channel row; null when the app's `channelId` rejects the entry. */
export function playlistChannelFromEntry(entry: PlaylistEntry, id: string | null): PlaylistChannel | null {
  if (!id) return null;
  return {
    id,
    name: entry.name,
    number: entry.tvgChno,
    logoUrl: entry.tvgLogo,
    streamUrl: entry.url,
    headers: entry.headers,
    originKey: playlistOriginKey(entry.url),
    groups: entry.groups,
    tvgId: entry.tvgId,
    tvgName: entry.tvgName,
    radio: entry.radio,
    drm: entry.drm,
  };
}

/**
 * The stock loader: the playlist lands in the disk cache, streams into the engine's native store,
 * and pages out in ENTRY_PAGE chunks, so no single native call carries the whole list.
 */
export async function enginePlaylistRows(source: PlaylistChannelSource, channelId: (entry: PlaylistEntry, index: number) => string | null): Promise<PlaylistRows> {
  const fileUri = await cachedPlaylistFile(source.fetchUrl ?? source.url);
  const { token, header, stats } = await loadPlaylist(fileUri, source.headers ?? {});
  try {
    const rows: PlaylistChannel[] = [];
    for (let offset = 0; offset < stats.entries; offset += ENTRY_PAGE) {
      const entries = await playlistEntries(token, { offset, limit: ENTRY_PAGE });
      if (entries.length === 0) break;
      for (let i = 0; i < entries.length; i++) {
        const row = playlistChannelFromEntry(entries[i], channelId(entries[i], offset + i));
        if (row) rows.push(row);
      }
    }
    return { rows, tvgUrls: header.tvgUrls.filter((url) => /^https?:\/\//i.test(url)) };
  } finally {
    closePlaylist(token).catch(() => {});
  }
}

function rebuild(): void {
  const nextById = new Map<string, PlaylistChannel>();
  const nextOrdered: PlaylistChannel[] = [];
  const nextGroups = new Map<string, string[]>();
  const nextTvgUrls: string[] = [];
  const nextTvgUrlSources = new Map<string, string[]>();
  const nextStatuses: Record<string, PlaylistSourceStatus> = {};
  for (const record of records.values()) {
    nextStatuses[record.source.key] = record.status;
    for (const row of record.rows) {
      if (nextById.has(row.id)) continue;
      nextById.set(row.id, row);
      nextOrdered.push(row);
      for (const group of row.groups) {
        const ids = nextGroups.get(group);
        if (ids) ids.push(row.id);
        else nextGroups.set(group, [row.id]);
      }
    }
    for (const url of record.tvgUrls) {
      if (!nextTvgUrls.includes(url)) nextTvgUrls.push(url);
      const sources = nextTvgUrlSources.get(url);
      if (sources) {
        if (!sources.includes(record.source.key)) sources.push(record.source.key);
      } else nextTvgUrlSources.set(url, [record.source.key]);
    }
  }
  byId = nextById;
  ordered = nextOrdered;
  groups = nextGroups;
  tvgUrls = nextTvgUrls;
  tvgUrlSources = nextTvgUrlSources;
  statuses = nextStatuses;
  for (const listener of listeners) listener();
}

function setStatus(record: SourceRecord, patch: Partial<PlaylistSourceStatus>): void {
  record.status = { ...record.status, ...patch };
  rebuild();
}

function loadSource(record: SourceRecord): Promise<void> {
  if (record.loading) return record.loading;
  const gen = generation;
  const loading = (async () => {
    setStatus(record, { state: "loading" });
    try {
      const { rows, tvgUrls: declared } = await record.source.loadRows(record.source);
      if (gen !== generation || records.get(record.source.key) !== record) return;
      record.rows = rows;
      record.tvgUrls = declared;
      record.loadedAt = Date.now();
      record.failedAt = null;
      setStatus(record, { state: "ready", channels: rows.length, loadedAt: record.loadedAt });
    } catch (error) {
      if (gen !== generation || records.get(record.source.key) !== record) return;
      record.failedAt = Date.now();
      // The last good rows keep serving; the status carries the failure so callers see a partial table.
      setStatus(record, { state: "error" });
      engineLog().warn("Playlist channels load failed", error, { service: "PlaylistChannels", url: record.source.url });
    } finally {
      if (records.get(record.source.key) === record) record.loading = null;
    }
  })();
  record.loading = loading;
  return loading;
}

/**
 * Points the table at these sources: removed ones leave it, new or stale ones load (each at most
 * once per freshness window, failures backed off serving the last good rows). Resolves when every
 * load this call started has settled; the table is readable throughout.
 */
export async function syncPlaylistSources(sources: readonly PlaylistChannelSource[], options: { force?: boolean } = {}): Promise<void> {
  const keep = new Set(sources.map((source) => source.key));
  let pruned = false;
  for (const key of records.keys()) {
    if (!keep.has(key)) {
      records.delete(key);
      pruned = true;
    }
  }
  if (pruned) rebuild();
  const loads: Promise<void>[] = [];
  for (const source of sources) {
    let record = records.get(source.key);
    if (!record) {
      record = {
        source,
        rows: [],
        tvgUrls: [],
        loadedAt: null,
        failedAt: null,
        loading: null,
        status: { key: source.key, url: source.url, state: "waiting", channels: null, loadedAt: null },
      };
      records.set(source.key, record);
    } else {
      record.source = source;
    }
    const fresh = record.loadedAt !== null && Date.now() - record.loadedAt < FRESH_TTL_MS;
    const backedOff = record.failedAt !== null && Date.now() - record.failedAt < FAILURE_TTL_MS;
    if (options.force || (!fresh && !backedOff)) loads.push(loadSource(record));
    else if (record.loading) loads.push(record.loading);
  }
  await Promise.all(loads);
}

/** The channel a list, tile or tune reads for `id`; null when no playlist carries it. */
export function playlistChannelById(id: string): PlaylistChannel | null {
  return byId.get(id) ?? null;
}

/** Every channel id across the sources, playlist order, duplicates folded. */
export function allPlaylistChannelIds(): string[] {
  return ordered.map((row) => row.id);
}

export function playlistChannelCount(): number {
  return ordered.length;
}

/** A page of channels in playlist order, of one group when `group` is given. */
export function playlistChannelsPage(page: { offset: number; limit: number; group?: string }): PlaylistChannel[] {
  if (page.group !== undefined) {
    const ids = groups.get(page.group) ?? [];
    return ids.slice(page.offset, page.offset + page.limit).map((id) => byId.get(id)!);
  }
  return ordered.slice(page.offset, page.offset + page.limit);
}

/** Every group across the sources in first-seen order, with its channel ids in playlist order. */
export function playlistGroupList(): { name: string; channelIds: string[] }[] {
  return Array.from(groups, ([name, channelIds]) => ({ name, channelIds }));
}

/** Guide URLs the playlists declare, deduped in order. */
export function playlistTvgUrls(): string[] {
  return tvgUrls;
}

/** The source keys that declare each guide URL. */
export function playlistTvgUrlSources(): Record<string, string[]> {
  return Object.fromEntries(tvgUrlSources);
}

/** Every source's status by key. */
export function playlistSourceStatuses(): Readonly<Record<string, PlaylistSourceStatus>> {
  return statuses;
}

export function subscribePlaylistChannels(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Forgets every source and row (sign-out, server switch); loads in flight write nothing back. */
export function resetPlaylistChannels(): void {
  generation += 1;
  records.clear();
  rebuild();
}
