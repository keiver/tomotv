/**
 * manifest.ts
 *
 * The record of what is on the device, held as one JSON file beside the media.
 *
 * A file rather than SecureStore: iOS caps a keychain value's practical size, and this grows
 * with the library. Each entry carries the whole Jellyfin item, so the Downloads screen and
 * offline playback need no server at all, which is the point of the feature.
 */

import type { JellyfinVideoItem } from "@/types/jellyfin";
import { logger } from "@/utils/logger";
import { downloadsSupported, ensureDownloadsRoot, manifestFile, resolveItemFile } from "./paths";

export type DownloadState = "queued" | "downloading" | "repackaging" | "paused" | "ready" | "failed";

/**
 * No resume handle is stored here, on purpose.
 *
 * `DownloadTask.savable()` carries the request headers, the URL and iOS's opaque resume blob
 * (NetworkTasks.ts:388), and the access token is inside all three: the header directly, the
 * stream URL as `ApiKey`, and the blob as an archived copy of the original request. This file
 * is plaintext in the app container while the token otherwise lives only in SecureStore, so
 * the manager holds resume state in memory for the life of the process and a paused transfer
 * restarts after a relaunch.
 */
export interface DownloadEntry {
  itemId: string;
  /** `file://` URI of the finished media, or of the file being written into. */
  fileUri: string;
  artworkUri: string | null;
  bytesWritten: number;
  /** -1 when neither the item nor the server declared a size. */
  totalBytes: number;
  state: DownloadState;
  error?: string;
  addedAt: number;
  /** A resume position played with no server to tell; replayed by offlineProgress. */
  pendingProgress?: { ticks: number; played: boolean; at: number };
  /**
   * The container this came down with, recorded at enqueue rather than guessed from the item.
   * An album downloaded whole is one row on the Downloads screen instead of twenty; a single
   * item downloaded on its own has none and stands alone.
   */
  group?: { id: string; name: string };
  /**
   * The file on disk is an MP4 this app wrote, not the container the server holds. Every
   * codec and subtitle fact for playback comes off the local file from here, because
   * the item's Jellyfin metadata still describes the source.
   */
  repackaged?: boolean;
  /**
   * The source itself can never become an MP4 this app writes (VP9 video, image
   * subtitles, no carryable audio). Set once and never retried; a decline this build
   * could undo on the next one leaves it unset so the heal sweep picks the file up.
   */
  repackageDeclined?: boolean;
  /** Bounds the heal sweep, so a file that fails every time stops being retried. */
  repackageAttempts?: number;
  /**
   * Source stream indices of the subtitle tracks the MP4 carries, in its own track order.
   * The player reports a selection by position, and this is what turns that back into a
   * Jellyfin stream index.
   */
  subtitleStreamIndices?: number[];
  /** Which of those are bitmap tracks, carried as empty tx3g and drawn by the app. */
  imageSubtitleIndices?: number[];
  /** The full item: the list, the queue and the player all read it instead of the server. */
  item: JellyfinVideoItem;
}

type Manifest = Record<string, DownloadEntry>;

/**
 * Progress arrives at 10 Hz per transfer (the native delegate's own throttle,
 * FileSystemDownloadTask.swift:334). Serialising the whole manifest and writing it on every
 * tick put a growing synchronous file write on the JS thread twenty times a second, so
 * position updates stay in memory and the file is written on this interval instead.
 */
const WRITE_INTERVAL_MS = 2000;

let entries: Manifest = {};
let loading: Promise<Manifest> | null = null;
// Serialized so two whole-file writes can never interleave.
let writeChain: Promise<void> | null = null;
let pendingWrite: ReturnType<typeof setTimeout> | null = null;

/** Reads the manifest once per launch. A missing or unparseable file starts empty. */
export function loadManifest(): Promise<Manifest> {
  // A promise, not a boolean: a second caller during the read used to be handed the still
  // empty object and conclude nothing was downloaded.
  if (loading) return loading;
  loading = (async () => {
    if (!downloadsSupported()) return entries;
    try {
      const file = manifestFile();
      if (!file.exists) return entries;
      const parsed = JSON.parse(await file.text());
      // Merged, not assigned: an entry added while the read was in flight must survive it.
      if (parsed && typeof parsed === "object") entries = { ...(parsed as Manifest), ...entries };
    } catch (error) {
      logger.warn("Downloads manifest unreadable, starting empty", error, { service: "Downloads" });
    }
    return entries;
  })();
  return loading;
}

export function manifestEntries(): DownloadEntry[] {
  return Object.values(entries);
}

export function manifestEntry(itemId: string): DownloadEntry | undefined {
  return entries[itemId];
}

/**
 * The one thing playback asks: is this item on disk and complete?
 *
 * The path is rebuilt and the file is stat-ed rather than trusted. A stored URI outlives the
 * container it was written in, and handing playback a dead path costs a stalled session
 * instead of an immediate fall back to the server.
 */
export function readyFileUri(itemId: string): string | null {
  const entry = entries[itemId];
  if (entry?.state !== "ready") return null;
  const file = resolveItemFile(itemId, entry.fileUri);
  return file.exists ? file.uri : null;
}

export function putEntry(entry: DownloadEntry): void {
  entries[entry.itemId] = entry;
  scheduleWrite();
}

/**
 * `soon` marks a change worth an immediate write (a state transition). Byte counts pass
 * false and ride the next interval.
 */
export function patchEntry(itemId: string, patch: Partial<DownloadEntry>, soon = true): DownloadEntry | undefined {
  const current = entries[itemId];
  if (!current) return undefined;
  const next = { ...current, ...patch };
  entries[itemId] = next;
  scheduleWrite(soon);
  return next;
}

export function removeEntry(itemId: string): void {
  delete entries[itemId];
  scheduleWrite();
}

/** Drops the in-memory manifest without touching disk. Remove All, and the tests. */
export function resetManifestCache(): void {
  entries = {};
  loading = null;
  if (pendingWrite) clearTimeout(pendingWrite);
  pendingWrite = null;
}

function scheduleWrite(immediate = true): void {
  if (immediate) {
    if (pendingWrite) {
      clearTimeout(pendingWrite);
      pendingWrite = null;
    }
    writeNow();
    return;
  }
  if (pendingWrite) return;
  pendingWrite = setTimeout(() => {
    pendingWrite = null;
    writeNow();
  }, WRITE_INTERVAL_MS);
}

function writeNow(): void {
  const snapshot = JSON.stringify(entries);
  const run = (writeChain ?? Promise.resolve())
    .then(async () => {
      await ensureDownloadsRoot();
      manifestFile().write(snapshot);
    })
    .catch((error) => {
      logger.warn("Downloads manifest write failed", error, { service: "Downloads" });
    });
  writeChain = run;
  void run.then(() => {
    if (writeChain === run) writeChain = null;
  });
}

/** Waits for the manifest to hit disk, running any interval write that is still pending. */
export async function flushManifest(): Promise<void> {
  if (pendingWrite) {
    clearTimeout(pendingWrite);
    pendingWrite = null;
    writeNow();
  }
  await writeChain;
}
