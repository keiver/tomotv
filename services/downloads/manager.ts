/**
 * manager.ts
 *
 * Singleton lifecycle for offline downloads, in the same shape as audioPlayerManager:
 * everything with a lifetime lives here and screens subscribe for display state.
 *
 * Transfers are expo-file-system DownloadTasks on a background URLSession, so they survive
 * the app being suspended. They do NOT survive the app being terminated: the completion
 * delegate belongs to the JS runtime, so a transfer in flight when the app dies is lost and
 * restarts. Every entry is therefore re-checked against the file on disk at launch.
 */

import { DownloadTask, File, Paths, type DownloadPauseState } from "expo-file-system";
import { API_TIMEOUTS } from "@/services/jellyfin/constants";
import { fetchWithTimeout } from "@/services/jellyfin/http";
import { getPosterUrl, hasPoster } from "@/services/jellyfin/images";
import { getAuthHeader, getConfig } from "@/services/jellyfin/session";
import { getRemoteVideoStreamUrl } from "@/services/jellyfin/streamUrls";
import type { JellyfinVideoItem } from "@/types/jellyfin";
import { logger } from "@/utils/logger";
import { flushManifest, loadManifest, manifestEntries, manifestEntry, patchEntry, putEntry, removeEntry, resetManifestCache, type DownloadEntry } from "./manifest";
import { artworkFile, downloadsSupported, ensureDownloadsRoot, ensureItemDirectory, mediaFile, removeItemDirectory, resolveItemFile } from "./paths";

/** Concurrent transfers. Two keeps a phone's link busy without starving playback. */
const MAX_ACTIVE = 2;
/** Free space kept clear of downloads, so a full disk cannot wedge the OS. */
const DISK_HEADROOM_BYTES = 500 * 1024 * 1024;
/** Progress arrives at 10 Hz per transfer; subscribers do not need it that often. */
const NOTIFY_INTERVAL_MS = 400;

export interface DownloadsUIState {
  entries: DownloadEntry[];
  activeCount: number;
  /** False until the manifest has been read; the Downloads screen shows nothing before then. */
  hydrated: boolean;
}

type Listener = (state: DownloadsUIState) => void;

class DownloadManager {
  private tasks = new Map<string, DownloadTask>();
  /** Process-lifetime only; see the note on DownloadEntry for why it never reaches disk. */
  private resumeStates = new Map<string, DownloadPauseState>();
  private listeners = new Set<Listener>();
  private hydrated = false;
  private hydrating: Promise<void> | null = null;
  private notifyTimer: ReturnType<typeof setTimeout> | null = null;

  isSupported(): boolean {
    return downloadsSupported();
  }

  /**
   * Reads the manifest and reconciles every entry with what is actually on disk. Runs once;
   * concurrent callers share the same promise.
   */
  hydrate(): Promise<void> {
    if (this.hydrating) return this.hydrating;
    this.hydrating = (async () => {
      if (!downloadsSupported()) {
        this.hydrated = true;
        this.notify();
        return;
      }
      await loadManifest();
      for (const entry of manifestEntries()) {
        if (entry.state === "failed") continue;
        // Nothing in JS hears about a transfer that ended while the app was dead, so the
        // file is the only witness. An unknown size can never be called complete.
        const file = resolveItemFile(entry.itemId, entry.fileUri);
        if (entry.state === "ready") {
          // A reinstall leaves ready rows pointing into the previous container. Demoted here
          // so the screen offers a re-download instead of the row failing at play time.
          if (!file.exists) patchEntry(entry.itemId, { state: "failed", error: "No longer on this device" });
          continue;
        }
        const complete = file.exists && entry.totalBytes > 0 && file.size >= entry.totalBytes;
        patchEntry(entry.itemId, complete ? { state: "ready", bytesWritten: entry.totalBytes } : { state: "paused" });
      }
      this.hydrated = true;
      this.notify();
    })();
    return this.hydrating;
  }

  getState(): DownloadsUIState {
    return {
      entries: manifestEntries().sort((a, b) => b.addedAt - a.addedAt),
      activeCount: this.tasks.size,
      hydrated: this.hydrated,
    };
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    listener(this.getState());
    return () => this.listeners.delete(listener);
  }

  /** True once the item's media is complete on disk. The playback path's only question. */
  isReady(itemId: string): boolean {
    return manifestEntry(itemId)?.state === "ready";
  }

  /** Known at all, in any state. A folder download uses this to offer only the difference. */
  has(itemId: string): boolean {
    return manifestEntry(itemId) !== undefined;
  }

  /**
   * Queue an item for download. Re-queuing something already known is a no-op, so a
   * double-tap on the download button cannot start two transfers for one item.
   */
  async enqueue(item: JellyfinVideoItem, options: { group?: { id: string; name: string } } = {}): Promise<void> {
    if (!downloadsSupported()) throw new Error("Downloads need an iPhone or iPad");
    await this.hydrate();
    if (manifestEntry(item.Id)) return;

    const size = item.MediaSources?.[0]?.Size ?? -1;
    if (size > 0 && Paths.availableDiskSpace - size < DISK_HEADROOM_BYTES) {
      throw new Error("Not enough free space for this download");
    }

    await ensureDownloadsRoot();
    ensureItemDirectory(item.Id);

    putEntry({
      itemId: item.Id,
      fileUri: mediaFile(item.Id, item.MediaSources?.[0]?.Container ?? item.Container).uri,
      artworkUri: null,
      bytesWritten: 0,
      totalBytes: size,
      state: "queued",
      addedAt: Date.now(),
      group: options.group,
      item,
    });
    this.notify();
    void this.cacheArtwork(item);
    this.pump();
  }

  /** Pause an in-flight transfer, keeping the bytes already on disk. */
  async pause(itemId: string): Promise<void> {
    const task = this.tasks.get(itemId);
    if (!task) return;
    await task.pauseAsync();
    this.tasks.delete(itemId);
    this.resumeStates.set(itemId, task.savable());
    patchEntry(itemId, { state: "paused" });
    this.notify();
    this.pump();
  }

  resume(itemId: string): void {
    const entry = manifestEntry(itemId);
    if (!entry || entry.state === "ready" || entry.state === "downloading") return;
    patchEntry(itemId, { state: "queued", error: undefined });
    this.notify();
    this.pump();
  }

  /** Cancel and delete: the item's whole directory goes, media and poster together. */
  async remove(itemId: string): Promise<void> {
    const task = this.tasks.get(itemId);
    if (task) {
      task.cancel();
      this.tasks.delete(itemId);
    }
    this.resumeStates.delete(itemId);
    removeEntry(itemId);
    try {
      removeItemDirectory(itemId);
    } catch (error) {
      logger.warn("Could not delete download directory", error, { service: "Downloads", itemId });
    }
    this.notify();
    this.pump();
  }

  /**
   * Every transfer stops and every file goes. Downloads outlive sign-out and server switches
   * on purpose, so the storage gauge's long press is the only thing allowed to call this.
   */
  async removeAll(): Promise<void> {
    for (const entry of manifestEntries()) {
      await this.remove(entry.itemId);
    }
    await flushManifest();
    resetManifestCache();
    resetDownloadPolicyCache();
    this.hydrated = false;
    this.hydrating = null;
    this.notify();
  }

  // MARK: - Internals

  /**
   * Starts queued entries up to the concurrency cap, oldest request first.
   *
   * The entry flips to `downloading` here rather than inside start(), which only reaches its
   * first assignment several awaits later, long enough for this loop to pick the same
   * still-queued entry twice.
   */
  private pump(): void {
    let active = manifestEntries().filter((entry) => entry.state === "downloading").length;
    while (active < MAX_ACTIVE) {
      const next = manifestEntries()
        .filter((entry) => entry.state === "queued")
        .sort((a, b) => a.addedAt - b.addedAt)[0];
      if (!next) break;
      patchEntry(next.itemId, { state: "downloading" });
      active += 1;
      void this.start(next);
    }
    this.notify();
  }

  private async start(entry: DownloadEntry): Promise<void> {
    const saved = this.resumeStates.get(entry.itemId);
    let task: DownloadTask;
    try {
      const options = {
        headers: await authHeaders(),
        onProgress: ({ bytesWritten, totalBytes }: { bytesWritten: number; totalBytes: number }) => {
          // false: byte counts ride the manifest's interval write instead of forcing one.
          patchEntry(entry.itemId, totalBytes > 0 ? { bytesWritten, totalBytes } : { bytesWritten }, false);
          this.notifySoon();
        },
      };
      task = saved ? DownloadTask.fromSavable(saved, options) : File.createDownloadTask(await downloadUrl(entry.item), new File(entry.fileUri), options);
    } catch (error) {
      this.fail(entry.itemId, error);
      return;
    }

    this.tasks.set(entry.itemId, task);
    // Consumed: the blob is single-use, and a failed resume has to start a fresh request.
    this.resumeStates.delete(entry.itemId);
    this.notify();

    try {
      const file = saved ? await task.resumeAsync() : await task.downloadAsync();
      this.tasks.delete(entry.itemId);
      // null means the transfer was paused; pause() has already recorded that state.
      if (file) {
        patchEntry(entry.itemId, { state: "ready", fileUri: file.uri, bytesWritten: file.size, totalBytes: file.size });
        logger.info("Download complete", { service: "Downloads", itemId: entry.itemId });
      }
    } catch (error) {
      this.tasks.delete(entry.itemId);
      this.fail(entry.itemId, error);
    }
    this.notify();
    this.pump();
  }

  private fail(itemId: string, error: unknown): void {
    logger.warn("Download failed", error, { service: "Downloads", itemId });
    patchEntry(itemId, { state: "failed", error: error instanceof Error ? error.message : String(error) });
    this.notify();
  }

  /** The poster, fetched once so the Downloads list works with no server. */
  private async cacheArtwork(item: JellyfinVideoItem): Promise<void> {
    if (!hasPoster(item)) return;
    try {
      const file = await File.downloadFileAsync(getPosterUrl(item.Id, 600), artworkFile(item.Id), { idempotent: true });
      patchEntry(item.Id, { artworkUri: file.uri });
      this.notify();
    } catch (error) {
      logger.warn("Could not cache download artwork", error, { service: "Downloads", itemId: item.Id });
    }
  }

  private notify(): void {
    if (this.notifyTimer) {
      clearTimeout(this.notifyTimer);
      this.notifyTimer = null;
    }
    const state = this.getState();
    this.listeners.forEach((listener) => listener(state));
  }

  /** Coalesces the progress feed so subscribers re-render a few times a second, not twenty. */
  private notifySoon(): void {
    if (this.notifyTimer) return;
    this.notifyTimer = setTimeout(() => {
      this.notifyTimer = null;
      const state = this.getState();
      this.listeners.forEach((listener) => listener(state));
    }, NOTIFY_INTERVAL_MS);
  }
}

/** The same Authorization header every other request in the app carries. */
async function authHeaders(): Promise<Record<string, string>> {
  const config = await getConfig();
  return { Authorization: getAuthHeader(config.deviceId, config.apiKey) };
}

/**
 * Which endpoint serves the original file.
 *
 * `/Items/{id}/Download` is the semantic one and the OpenAPI spec gates it on the `Download`
 * policy, which `/Users/Me` reports as `Policy.EnableContentDownloading`. Asking the policy
 * costs one small JSON response; range-probing the media endpoint does not, because React
 * Native's fetch resolves only after the whole body has arrived (whatwg-fetch resolves on
 * xhr.onload), so a server that ignored the Range header would buffer the entire file.
 * Cached per server, so switching servers re-asks.
 */
let downloadPolicy: { server: string; allowed: boolean } | null = null;

export function resetDownloadPolicyCache(): void {
  downloadPolicy = null;
}

async function contentDownloadingAllowed(server: string): Promise<boolean> {
  if (downloadPolicy?.server === server) return downloadPolicy.allowed;
  let allowed = false;
  try {
    const response = await fetchWithTimeout(`${server}/Users/Me`, { headers: await authHeaders() }, API_TIMEOUTS.QUICK);
    if (response.ok) {
      const user = (await response.json()) as { Policy?: { EnableContentDownloading?: boolean } };
      allowed = user.Policy?.EnableContentDownloading === true;
    }
  } catch (error) {
    logger.warn("Could not read the download policy, using the stream endpoint", error, { service: "Downloads" });
  }
  downloadPolicy = { server, allowed };
  logger.info("Download policy resolved", { service: "Downloads", allowed });
  return allowed;
}

async function downloadUrl(item: JellyfinVideoItem): Promise<string> {
  const config = await getConfig();
  if (!config.server || !config.apiKey) throw new Error("Not connected to a server");
  return (await contentDownloadingAllowed(config.server)) ? `${config.server}/Items/${item.Id}/Download` : getRemoteVideoStreamUrl(item.Id, item);
}

export const downloadManager = new DownloadManager();
