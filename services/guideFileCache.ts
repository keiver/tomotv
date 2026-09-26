/**
 * guideFileCache.ts
 *
 * Downloaded XMLTV guides on disk, keyed by URL — Jellyfin's XmlTvListingsProvider scheme:
 * a fresh copy is served without touching the network, a download lands in a temp file and
 * replaces the cached one atomically, and a recent failure skips the network and serves the
 * stale copy when one exists. Guides regenerate at most daily, so the 1 hour freshness
 * window re-downloads little; the native parser sniffs gzip by magic bytes, so the cached
 * file needs no extension.
 */
import { logger } from "@/utils/logger";
import { Directory, File, Paths } from "expo-file-system";

const FRESH_TTL_MS = 60 * 60 * 1000;
/** A failed download is not retried before this passes; the stale copy serves meanwhile. */
const FAILURE_TTL_MS = 5 * 60 * 1000;
/** Copies nobody asked for in two days are swept on the next open. */
const SWEEP_AGE_MS = 48 * 60 * 60 * 1000;

export type GuideDownloadProgress = { bytesWritten: number; totalBytes: number };

const failedAt = new Map<string, number>();
/** One download per URL; every caller's progress listener rides it. */
const inFlight = new Map<string, { promise: Promise<string>; listeners: Set<(progress: GuideDownloadProgress) => void> }>();

function cacheDir(): Directory {
  return new Directory(Paths.cache, "guides");
}

/** djb2 over the URL: stable, collision-safe enough for a handful of guide URLs. */
function keyFor(url: string): string {
  let hash = 5381;
  for (let i = 0; i < url.length; i++) hash = ((hash << 5) + hash + url.charCodeAt(i)) >>> 0;
  return `guide-${hash.toString(16)}`;
}

function ageMs(file: File): number {
  const modified = file.info().modificationTime;
  return modified ? Date.now() - modified : Number.POSITIVE_INFINITY;
}

function sweep(dir: Directory, keep: string): void {
  try {
    for (const entry of dir.list()) {
      if (entry instanceof File && entry.name !== keep && ageMs(entry) > SWEEP_AGE_MS) entry.delete();
    }
  } catch (error) {
    logger.warn("Guide cache sweep failed", error, { service: "GuideFileCache" });
  }
}

async function fetchToCache(url: string, dir: Directory, file: File, onProgress?: (progress: GuideDownloadProgress) => void): Promise<string> {
  const temp = new File(dir, `${file.name}.part`);
  if (temp.exists) temp.delete();
  await File.downloadFileAsync(url, temp, { idempotent: true, onProgress });
  if (file.exists) file.delete();
  await temp.move(file);
  failedAt.delete(url);
  return file.uri;
}

/**
 * The guide at `url` as a local file URI: the cached copy while it is fresh, otherwise a new
 * download (progress reported), and the stale copy when the network fails or failed recently.
 * `force` (the HUD's refresh) skips the freshness window and the failure backoff, never the
 * stale fallback.
 */
export async function cachedGuideFile(url: string, onProgress?: (progress: GuideDownloadProgress) => void, options?: { force?: boolean }): Promise<string> {
  const pending = inFlight.get(url);
  if (pending) {
    if (onProgress) pending.listeners.add(onProgress);
    return pending.promise;
  }
  const dir = cacheDir();
  if (!dir.exists) dir.create({ intermediates: true });
  const name = keyFor(url);
  const file = new File(dir, name);
  sweep(dir, name);
  if (!options?.force) {
    if (file.exists && ageMs(file) < FRESH_TTL_MS) return file.uri;
    const failed = failedAt.get(url);
    if (failed !== undefined && Date.now() - failed < FAILURE_TTL_MS) {
      if (file.exists) return file.uri;
      throw new Error("Guide download skipped after a recent failure.");
    }
  }
  const listeners = new Set<(progress: GuideDownloadProgress) => void>();
  if (onProgress) listeners.add(onProgress);
  const download = (async () => {
    try {
      return await fetchToCache(url, dir, file, (progress) => {
        for (const listener of listeners) listener(progress);
      });
    } catch (error) {
      failedAt.set(url, Date.now());
      if (file.exists) {
        logger.warn("Guide download failed, serving the cached copy", error, { service: "GuideFileCache" });
        return file.uri;
      }
      throw error;
    } finally {
      inFlight.delete(url);
    }
  })();
  inFlight.set(url, { promise: download, listeners });
  return download;
}

/** Drops every cached guide and forgets failures (storage clear, tests). */
export function clearGuideFileCache(): void {
  failedAt.clear();
  try {
    const dir = cacheDir();
    if (dir.exists) dir.delete();
  } catch (error) {
    logger.warn("Guide cache clear failed", error, { service: "GuideFileCache" });
  }
}
