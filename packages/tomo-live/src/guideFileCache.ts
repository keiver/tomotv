/**
 * guideFileCache.ts
 *
 * Downloaded live source files on disk, keyed by URL: XMLTV guides and M3U playlists share one
 * scheme, each in its own folder. A fresh copy is served without touching the network, a download
 * lands in a temp file and replaces the cached one atomically, and a recent failure skips the
 * network and serves the stale copy when one exists. Sources regenerate at most daily, so the
 * 1 hour freshness window re-downloads little; the native parser sniffs gzip by magic bytes, so
 * the cached file needs no extension.
 */
import { engineLog } from "@keiver/tomo-engine";
import { Directory, File, Paths, type DownloadTask } from "expo-file-system";
import { isPlaybackHeld, onPlaybackHoldReleased, onPlaybackHoldTaken } from "./playbackHold";

const FRESH_TTL_MS = 60 * 60 * 1000;
/** A release is read again after this: a queue advance lets go of the hold and takes it back around a native await. */
const HOLD_SETTLE_MS = 2000;
/** A failed download is not retried before this passes; the stale copy serves meanwhile. */
const FAILURE_TTL_MS = 5 * 60 * 1000;
/** Copies of files no longer in use, untouched for two days, are swept on the next open. */
const SWEEP_AGE_MS = 48 * 60 * 60 * 1000;

export type GuideDownloadProgress = { bytesWritten: number; totalBytes: number };

export interface CachedFileOptions {
  force?: boolean;
  keep?: readonly string[];
  /** Sent with the download, e.g. a provider's User-Agent. */
  headers?: Record<string, string>;
}

interface FileCache {
  cachedFile(url: string, onProgress?: (progress: GuideDownloadProgress) => void, options?: CachedFileOptions): Promise<string>;
  onRefreshed(listener: (url: string) => void): () => void;
  fileInfo(url: string): { bytes: number; savedAt: number } | null;
  cacheBytes(): number;
  clear(): void;
}

function ageMs(file: File): number {
  const modified = file.info().modificationTime;
  return modified ? Date.now() - modified : Number.POSITIVE_INFINITY;
}

/** Resolves once playback has let go of the link and left it free for HOLD_SETTLE_MS. */
function linkFree(): Promise<void> {
  return new Promise((resolve) => {
    const check = () => {
      if (!isPlaybackHeld()) return resolve();
      const stop = onPlaybackHoldReleased(() => {
        stop();
        setTimeout(check, HOLD_SETTLE_MS);
      });
    };
    check();
  });
}

/** One cache folder's download, read and sweep behavior; guides and playlists each get one. */
function makeFileCache(folder: string, prefix: string, label: string): FileCache {
  const failedAt = new Map<string, number>();
  /** One download per URL; every caller's progress listener rides it. */
  const inFlight = new Map<string, { promise: Promise<string>; listeners: Set<(progress: GuideDownloadProgress) => void>; owe: () => void }>();
  const refreshedListeners = new Set<(url: string) => void>();

  const cacheDir = () => new Directory(Paths.cache, folder);

  /** djb2 over the URL: stable, collision-safe enough for a handful of source URLs. */
  const keyFor = (url: string): string => {
    let hash = 5381;
    for (let i = 0; i < url.length; i++) hash = ((hash << 5) + hash + url.charCodeAt(i)) >>> 0;
    return `${prefix}${hash.toString(16)}`;
  };

  const sweep = (dir: Directory, keep: ReadonlySet<string>): void => {
    try {
      for (const entry of dir.list()) {
        if (entry instanceof File && !keep.has(entry.name) && ageMs(entry) > SWEEP_AGE_MS) entry.delete();
      }
    } catch (error) {
      engineLog().warn(`${label} cache sweep failed`, error, { service: "GuideFileCache" });
    }
  };

  /** Paused while playback holds the link, resumed from its bytes after; without resume data it starts over. */
  const fetchToCache = async (url: string, dir: Directory, file: File, headers: Record<string, string> | undefined, onProgress: (progress: GuideDownloadProgress) => void): Promise<string> => {
    const temp = new File(dir, `${file.name}.part`);
    if (temp.exists) temp.delete();
    // Native start and pause run on different queues, so a pause can reach native before the task
    // exists and be lost: it is sent only once the run has reported bytes, which a live task does.
    const run = { task: null as DownloadTask | null, reported: false, pauseSent: false };
    const pauseRun = () => {
      if (!run.task || run.task.state !== "active" || !run.reported || run.pauseSent) return;
      run.pauseSent = true;
      run.task.pause();
    };
    const progress = (update: GuideDownloadProgress) => {
      run.reported = true;
      if (isPlaybackHeld()) pauseRun();
      onProgress(update);
    };
    let landed: File | null = null;
    while (!landed) {
      await linkFree();
      if (isPlaybackHeld()) continue;
      const resumeData: string | undefined = run.task?.savable().resumeData;
      if (!resumeData || !run.task) run.task = File.createDownloadTask(url, temp, { headers, sessionType: "foreground", onProgress: progress });
      run.reported = false;
      run.pauseSent = false;
      const running = run.task;
      const stopPausing = onPlaybackHoldTaken(pauseRun);
      try {
        landed = resumeData ? await running.resumeAsync() : await running.downloadAsync();
      } finally {
        stopPausing();
      }
    }
    if (file.exists) file.delete();
    await temp.move(file);
    failedAt.delete(url);
    return file.uri;
  };

  /** Starts the one download for `url`; an owed one tells the refreshed listeners when it lands. */
  const startDownload = (
    url: string,
    dir: Directory,
    file: File,
    options: { headers?: Record<string, string>; background: boolean; onProgress?: (progress: GuideDownloadProgress) => void },
  ): Promise<string> => {
    const listeners = new Set<(progress: GuideDownloadProgress) => void>();
    if (options.onProgress) listeners.add(options.onProgress);
    const owing = { owed: options.background };
    const download = (async () => {
      try {
        const uri = await fetchToCache(url, dir, file, options.headers, (progress) => {
          for (const listener of listeners) listener(progress);
        });
        if (owing.owed) for (const listener of [...refreshedListeners]) listener(url);
        return uri;
      } catch (error) {
        failedAt.set(url, Date.now());
        if (file.exists) {
          engineLog().warn(`${label} download failed, serving the cached copy`, error, { service: "GuideFileCache" });
          return file.uri;
        }
        throw error;
      } finally {
        inFlight.delete(url);
      }
    })();
    inFlight.set(url, { promise: download, listeners, owe: () => (owing.owed = true) });
    return download;
  };

  return {
    async cachedFile(url, onProgress, options) {
      const dir = cacheDir();
      if (!dir.exists) dir.create({ intermediates: true });
      const name = keyFor(url);
      const file = new File(dir, name);
      const failed = failedAt.get(url);
      const backedOff = failed !== undefined && Date.now() - failed < FAILURE_TTL_MS;
      const pending = inFlight.get(url);
      // Playback owns the link: the copy on disk serves now, and a refresh it owes downloads after playback lets go.
      if (isPlaybackHeld() && file.exists) {
        const owed = options?.force || (ageMs(file) >= FRESH_TTL_MS && !backedOff);
        // A download already running owes this caller its landing too: it was served the older copy.
        if (pending) pending.owe();
        else if (owed) startDownload(url, dir, file, { headers: options?.headers, background: true }).catch(() => {});
        return file.uri;
      }
      if (pending) {
        if (onProgress) pending.listeners.add(onProgress);
        return pending.promise;
      }
      sweep(dir, new Set([name, ...(options?.keep ?? []).map(keyFor)]));
      if (!options?.force) {
        if (file.exists && ageMs(file) < FRESH_TTL_MS) return file.uri;
        if (backedOff) {
          if (file.exists) return file.uri;
          throw new Error(`${label} download skipped after a recent failure.`);
        }
      }
      return startDownload(url, dir, file, { headers: options?.headers, background: false, onProgress });
    },
    onRefreshed(listener) {
      refreshedListeners.add(listener);
      return () => {
        refreshedListeners.delete(listener);
      };
    },
    fileInfo(url) {
      try {
        const file = new File(cacheDir(), keyFor(url));
        if (!file.exists) return null;
        return { bytes: file.size, savedAt: file.info().modificationTime ?? 0 };
      } catch (error) {
        engineLog().warn(`${label} cache read failed`, error, { service: "GuideFileCache" });
        return null;
      }
    },
    cacheBytes() {
      try {
        const dir = cacheDir();
        if (!dir.exists) return 0;
        return dir.list().reduce((total, entry) => total + (entry instanceof File ? entry.size : 0), 0);
      } catch (error) {
        engineLog().warn(`${label} cache read failed`, error, { service: "GuideFileCache" });
        return 0;
      }
    },
    clear() {
      failedAt.clear();
      try {
        const dir = cacheDir();
        if (dir.exists) dir.delete();
      } catch (error) {
        engineLog().warn(`${label} cache clear failed`, error, { service: "GuideFileCache" });
      }
    },
  };
}

const guides = makeFileCache("guides", "guide-", "Guide");
const playlists = makeFileCache("playlists", "playlist-", "Playlist");

/**
 * The guide at `url` as a local file URI: the cached copy while it is fresh, otherwise a new
 * download (progress reported), and the stale copy when the network fails or failed recently.
 * `force` (the HUD's refresh) skips the freshness window and the failure backoff, never the
 * stale fallback. `keep` names the other guides in use, whose stale copies the sweep spares.
 * While playback holds the link a held copy serves at once and the download waits for it to let go.
 */
export const cachedGuideFile = guides.cachedFile;

/** Runs with a guide URL whose download, owed while playback held the link, has landed. */
export const onGuideFileRefreshed = guides.onRefreshed;

/** The cached copy of `url`: its size and when it landed, or null while none is held. */
export const guideFileInfo = guides.fileInfo;

/** Every guide file on the device, in bytes, partial downloads included. */
export const guideCacheBytes = guides.cacheBytes;

/** Drops every cached guide and forgets failures (storage clear, tests). */
export const clearGuideFileCache = guides.clear;

/** The playlist at `url` as a local file URI, under the guide cache's rules. */
export const cachedPlaylistFile = playlists.cachedFile;

/** Runs with a playlist URL whose download, owed while playback held the link, has landed. */
export const onPlaylistFileRefreshed = playlists.onRefreshed;

/** The cached copy of a playlist `url`: its size and when it landed, or null while none is held. */
export const playlistFileInfo = playlists.fileInfo;

/** Every playlist file on the device, in bytes, partial downloads included. */
export const playlistCacheBytes = playlists.cacheBytes;

/** Drops every cached playlist and forgets failures (storage clear, tests). */
export const clearPlaylistFileCache = playlists.clear;
