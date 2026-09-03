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
import { getConvertedDownloadUrl, getRemoteVideoStreamUrl } from "@/services/jellyfin/streamUrls";
import { getRemoteSubtitleUrl, getTextSubtitleStreams } from "@/services/jellyfin/subtitles";
import { wantsPosterFrame } from "@/services/itemArtwork";
import { requestPosterFrame } from "@/services/localRemux";
import { isPlaybackHeld, onPlaybackHoldReleased } from "@/services/playbackHold";
import { conversionAudioIndex, conversionRung, convertedItem } from "./convert";
import type { JellyfinVideoItem } from "@/types/jellyfin";
import { logger } from "@/utils/logger";
import { flushManifest, loadManifest, manifestEntries, manifestEntry, patchEntry, putEntry, removeEntry, resetManifestCache, type DownloadEntry } from "./manifest";
import { artworkFile, subtitleFile, DISK_HEADROOM_BYTES, downloadsSupported, ensureDownloadsRoot, ensureItemDirectory, mediaFile, removeItemDirectory, repackagedFile, resolveItemFile } from "./paths";
import { cancelRepackage, needsRepackage, repackageDownload } from "./repackage";

/** Concurrent transfers. Two keeps a phone's link busy without starving playback. */
const MAX_ACTIVE = 2;
/** Free space kept clear of downloads, so a full disk cannot wedge the OS. */
/** Progress arrives at 10 Hz per transfer; the row drawing it does not need it that often. */
const PROGRESS_INTERVAL_MS = 400;
/** The one failure a sign-in undoes, so hydrate can tell it from a failure that stands. */
const NO_SESSION_ERROR = "Not connected to a server";

export interface DownloadsUIState {
  entries: DownloadEntry[];
  activeCount: number;
  /** False until the manifest has been read; the Downloads screen shows nothing before then. */
  hydrated: boolean;
}

export interface DownloadProgress {
  bytesWritten: number;
  totalBytes: number;
}

type Listener = (state: DownloadsUIState) => void;
type ProgressListener = (progress: DownloadProgress) => void;

class DownloadManager {
  private tasks = new Map<string, DownloadTask>();
  /** Process-lifetime only; see the note on DownloadEntry for why it never reaches disk. */
  private resumeStates = new Map<string, DownloadPauseState>();
  private listeners = new Set<Listener>();
  private progressListeners = new Map<string, Set<ProgressListener>>();
  private progressTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private hydrated = false;
  private hydrating: Promise<void> | null = null;
  private healOnRelease: (() => void) | null = null;

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
        if (entry.state === "failed") {
          // A row a sign-out failed before transfers learned to park. Rewound so the list
          // offers a resume rather than an error a sign-in has already answered.
          if (entry.error === NO_SESSION_ERROR) patchEntry(entry.itemId, { state: "paused", error: undefined });
          continue;
        }
        // Nothing in JS hears about a transfer that ended while the app was dead, so the
        // file is the only witness. An unknown size can never be called complete.
        const file = resolveItemFile(entry.itemId, entry.fileUri);
        if (entry.state === "ready") {
          // A reinstall leaves ready rows pointing into the previous container. Demoted here
          // so the screen offers a re-download instead of the row failing at play time.
          if (!file.exists) patchEntry(entry.itemId, { state: "failed", error: "No longer on this device" });
          else {
            void this.cacheSubtitles(entry.item);
            if (!entry.artworkUri) void this.cacheArtwork(entry.item);
          }
          continue;
        }
        // A repackage never survives the app dying, and its output is incomplete. The
        // source it was reading is still whole, so the row goes ready on that.
        if (entry.state === "repackaging") {
          const target = repackagedFile(entry.itemId);
          if (target.exists && target.uri !== file.uri) {
            try {
              target.delete();
            } catch (error) {
              logger.warn("Could not clear a half-written repackage", error, { service: "Downloads", itemId: entry.itemId });
            }
          }
          patchEntry(entry.itemId, file.exists ? { state: "ready" } : { state: "failed", error: "No longer on this device" });
          continue;
        }
        const complete = file.exists && entry.totalBytes > 0 && file.size >= entry.totalBytes;
        patchEntry(entry.itemId, complete ? { state: "ready", bytesWritten: entry.totalBytes } : { state: "paused" });
      }
      this.hydrated = true;
      this.notify();
      // Detached: the Downloads screen renders off `hydrated`, and a sweep can run for
      // as long as the files it finds need.
      void this.healRepackages();
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

  /**
   * One transfer's byte counts, for the row drawing them. Separate from `subscribe` because it
   * fires for minutes: routing it through the screen's state re-rendered every row 2.5 times a
   * second, and each render re-registers Reanimated worklets the runtime never releases.
   */
  subscribeProgress(itemId: string, listener: ProgressListener): () => void {
    const listeners = this.progressListeners.get(itemId) ?? new Set<ProgressListener>();
    listeners.add(listener);
    this.progressListeners.set(itemId, listeners);
    const entry = manifestEntry(itemId);
    if (entry) listener({ bytesWritten: entry.bytesWritten, totalBytes: entry.totalBytes });
    return () => {
      const current = this.progressListeners.get(itemId);
      if (!current) return;
      current.delete(listener);
      if (current.size === 0) this.progressListeners.delete(itemId);
    };
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
  async enqueue(item: JellyfinVideoItem, options: { group?: { id: string; name: string }; convert?: boolean } = {}): Promise<void> {
    if (!downloadsSupported()) throw new Error("Downloads need an iPhone or iPad");
    await this.hydrate();
    if (manifestEntry(item.Id)) return;

    // A conversion's size is only known once it lands; the caller checks the estimate.
    const rung = options.convert ? await conversionRung() : undefined;
    const stored = rung ? convertedItem(item, rung) : item;
    const size = rung ? -1 : (item.MediaSources?.[0]?.Size ?? -1);
    if (size > 0 && Paths.availableDiskSpace - size < DISK_HEADROOM_BYTES) {
      throw new Error("Not enough free space for this download");
    }

    await ensureDownloadsRoot();
    ensureItemDirectory(item.Id);

    putEntry({
      itemId: item.Id,
      fileUri: mediaFile(item.Id, stored.MediaSources?.[0]?.Container ?? stored.Container).uri,
      artworkUri: null,
      bytesWritten: 0,
      totalBytes: size,
      state: "queued",
      addedAt: Date.now(),
      group: options.group,
      converted: rung,
      item: stored,
    });
    this.notify();
    void this.cacheArtwork(item);
    void this.cacheSubtitles(stored);
    this.pump();
  }

  /** Pause an in-flight transfer, keeping the bytes already on disk. */
  async pause(itemId: string): Promise<void> {
    const task = this.tasks.get(itemId);
    if (!task) return;
    await task.pauseAsync();
    this.tasks.delete(itemId);
    const saved = task.savable();
    // A pause before any byte landed carries no resume data; the next start opens a fresh request.
    if (saved.resumeData) this.resumeStates.set(itemId, saved);
    this.clearProgressTimer(itemId);
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
    cancelRepackage(itemId);
    this.clearProgressTimer(itemId);
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
   * on purpose, so the storage gauge is the only thing allowed to call this.
   *
   * `hydrated` stays true: the disk has been read, and the empty manifest left behind is the
   * truth. Clearing it renders the screen blank, which nothing re-hydrates.
   */
  async removeAll(): Promise<void> {
    for (const entry of manifestEntries()) {
      await this.remove(entry.itemId);
    }
    await flushManifest();
    resetManifestCache();
    resetDownloadPolicyCache();
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
    // Signed out there is no server to ask, so the transfer parks instead of failing: a failed
    // row wears an error the session outlives and offers a retry that cannot work.
    if (!(await connectedToServer())) {
      patchEntry(entry.itemId, { state: "paused" });
      this.notify();
      this.pump();
      return;
    }

    const saved = this.resumeStates.get(entry.itemId);
    let task: DownloadTask;
    try {
      const options = {
        headers: await authHeaders(),
        onProgress: ({ bytesWritten, totalBytes }: { bytesWritten: number; totalBytes: number }) => {
          // false: byte counts ride the manifest's interval write instead of forcing one.
          patchEntry(entry.itemId, totalBytes > 0 ? { bytesWritten, totalBytes } : { bytesWritten }, false);
          this.emitProgressSoon(entry.itemId);
        },
      };
      task = saved ? DownloadTask.fromSavable(saved, options) : File.createDownloadTask(await downloadUrl(entry), new File(entry.fileUri), options);
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
        // Rewrapped before the row goes ready, so nothing ever plays the source container
        // and a kill mid-pass leaves a `repackaging` row rather than a half file called ready.
        patchEntry(entry.itemId, { state: "repackaging", fileUri: file.uri, bytesWritten: file.size, totalBytes: file.size });
        this.notify();
        await this.runRepackage(entry, file);
        logger.info("Download complete", { service: "Downloads", itemId: entry.itemId });
      }
    } catch (error) {
      this.tasks.delete(entry.itemId);
      this.fail(entry.itemId, error);
    }
    this.clearProgressTimer(entry.itemId);
    this.notify();
    this.pump();
  }

  /**
   * One rewrap attempt, recording what it decided. `repackaging` is entered first so a
   * kill mid-pass leaves a state hydrate can recognise instead of a file called ready.
   */
  private async runRepackage(entry: DownloadEntry, file: File): Promise<void> {
    patchEntry(entry.itemId, { state: "repackaging" });
    this.notify();
    const outcome = await repackageDownload(entry, file);
    patchEntry(entry.itemId, {
      state: "ready",
      fileUri: outcome.file.uri,
      bytesWritten: outcome.file.size,
      totalBytes: outcome.file.size,
      repackaged: outcome.repackaged,
      repackageDeclined: outcome.declinedPermanently || undefined,
      repackageAttempts: outcome.repackaged ? undefined : outcome.skipped ? entry.repackageAttempts : (entry.repackageAttempts ?? 0) + 1,
      subtitleStreamIndices: outcome.subtitleStreamIndices,
      imageSubtitleIndices: outcome.imageSubtitleIndices,
    });
    this.notify();
  }

  /**
   * Rewraps whatever earlier runs left behind: a pass the app was killed during, one that
   * ran out of background time, and every file a build without the subtitle encoder had to
   * decline. Serial and last-first, so a launch never spends the device on all of them at once.
   */
  private async healRepackages(): Promise<void> {
    for (const entry of manifestEntries()) {
      if (!needsRepackage(entry)) continue;
      // A rewrap deletes its source, and a live queue holds file URLs resolved at start:
      // the pass waits for playback to let go rather than pulling a file out from under it.
      if (isPlaybackHeld()) {
        this.healWhenReleased();
        return;
      }
      const file = resolveItemFile(entry.itemId, entry.fileUri);
      if (!file.exists) continue;
      logger.info("Healing a download that never got rewrapped", { service: "Downloads", itemId: entry.itemId });
      await this.runRepackage(entry, file);
    }
  }

  private healWhenReleased(): void {
    if (this.healOnRelease) return;
    logger.info("Heal sweep waiting for playback to end", { service: "Downloads" });
    this.healOnRelease = onPlaybackHoldReleased(() => {
      this.healOnRelease?.();
      this.healOnRelease = null;
      void this.healRepackages();
    });
  }

  private fail(itemId: string, error: unknown): void {
    logger.warn("Download failed", error, { service: "Downloads", itemId });
    patchEntry(itemId, { state: "failed", error: error instanceof Error ? error.message : String(error) });
    this.notify();
  }

  /** The poster, fetched once so the Downloads list works with no server. */
  private async cacheArtwork(item: JellyfinVideoItem): Promise<void> {
    try {
      const file = hasPoster(item) ? await File.downloadFileAsync(getPosterUrl(item.Id, 600), artworkFile(item.Id), { idempotent: true }) : await this.copyPosterFrame(item);
      if (!file) return;
      patchEntry(item.Id, { artworkUri: file.uri });
      this.notify();
    } catch (error) {
      logger.warn("Could not cache download artwork", error, { service: "Downloads", itemId: item.Id });
    }
  }

  /** The engine's keyframe, copied out of the frame pool: the pool trims, a download does not. */
  private async copyPosterFrame(item: JellyfinVideoItem): Promise<File | null> {
    if (!wantsPosterFrame(item)) return null;
    const frame = await requestPosterFrame(item);
    if (!frame) return null;
    const file = artworkFile(item.Id);
    if (!file.exists) await new File(frame).copy(file);
    return file;
  }

  /**
   * Every text subtitle track, converted to WebVTT by the server while it is still reachable.
   * The engine hands AVPlayer a URL for these rather than serving them itself, so a held file
   * without them plays with no subtitles. Image tracks are decoded from the media by the
   * engine and need nothing here.
   */
  private async cacheSubtitles(item: JellyfinVideoItem): Promise<void> {
    const text = getTextSubtitleStreams(item).filter((stream) => stream.Index !== undefined);
    for (const stream of text) {
      const index = stream.Index as number;
      if (subtitleFile(item.Id, index).exists) continue;
      try {
        await File.downloadFileAsync(getRemoteSubtitleUrl(item.Id, index, "vtt"), subtitleFile(item.Id, index), { idempotent: true });
      } catch (error) {
        logger.warn("Could not cache a download subtitle track", error, { service: "Downloads", itemId: item.Id, index });
      }
    }
  }

  private notify(): void {
    const state = this.getState();
    this.listeners.forEach((listener) => listener(state));
  }

  /** Coalesces one transfer's feed and reaches only the row watching that item. */
  private emitProgressSoon(itemId: string): void {
    if (this.progressTimers.has(itemId)) return;
    const timer = setTimeout(() => {
      this.progressTimers.delete(itemId);
      const entry = manifestEntry(itemId);
      const listeners = this.progressListeners.get(itemId);
      if (!entry || !listeners) return;
      const progress = { bytesWritten: entry.bytesWritten, totalBytes: entry.totalBytes };
      listeners.forEach((listener) => listener(progress));
    }, PROGRESS_INTERVAL_MS);
    this.progressTimers.set(itemId, timer);
  }

  /** Drops a pending tick, so a finished or deleted transfer cannot emit after the fact. */
  private clearProgressTimer(itemId: string): void {
    const timer = this.progressTimers.get(itemId);
    if (!timer) return;
    clearTimeout(timer);
    this.progressTimers.delete(itemId);
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

/** Whether a transfer has a session to run against: server plus token, the pair downloadUrl needs. */
async function connectedToServer(): Promise<boolean> {
  const config = await getConfig();
  return Boolean(config.server && config.apiKey);
}

async function downloadUrl(entry: DownloadEntry): Promise<string> {
  const config = await getConfig();
  if (!config.server || !config.apiKey) throw new Error(NO_SESSION_ERROR);
  const { item } = entry;
  if (entry.converted) return getConvertedDownloadUrl(item.Id, item, entry.converted, conversionAudioIndex(item));
  return (await contentDownloadingAllowed(config.server)) ? `${config.server}/Items/${item.Id}/Download` : getRemoteVideoStreamUrl(item.Id, item);
}

export const downloadManager = new DownloadManager();
