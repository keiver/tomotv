/**
 * repackage.ts
 *
 * Rewraps a finished download into MP4 so playback opens it straight through AVPlayer.
 *
 * A downloaded MKV is byte-identical to the server's file, and AVFoundation cannot open
 * that container at all, so playing one stood up a full remux session per press. Rewrapping
 * once, here, turns every later play into a direct open. Nothing is re-encoded.
 *
 * Declining is a normal outcome, not a failure: the source file stays exactly as it was and
 * the item keeps playing through the engine.
 */

import { File, Paths } from "expo-file-system";
import { NativeModules } from "react-native";
import { logger } from "@/utils/logger";
import type { DownloadEntry } from "./manifest";
import { DISK_HEADROOM_BYTES, filePath, repackagedFile } from "./paths";

const { LocalRemuxer } = NativeModules;

/** Containers AVFoundation already opens; rewrapping them would copy bytes for nothing. */
const NATIVE_CONTAINERS = ["mp4", "mov", "m4v", "m4a"];

export interface RepackageOutcome {
  /** What the manifest should record as the playable file. */
  file: File;
  repackaged: boolean;
  /** This source will never rewrap; the sweep must stop offering it. */
  declinedPermanently: boolean;
  subtitleStreamIndices?: number[];
  imageSubtitleIndices?: number[];
}

interface NativeResult {
  repackaged?: boolean;
  reason?: string;
  failed?: boolean;
  permanent?: boolean;
  subtitleStreamIndices?: number[];
  imageSubtitleIndices?: number[];
  droppedAudioIndices?: number[];
  elapsedSeconds?: number;
}

function alreadyNative(entry: DownloadEntry): boolean {
  const container = (entry.item.MediaSources?.[0]?.Container ?? entry.item.Container ?? "").toLowerCase();
  return container.split(",").some((part) => NATIVE_CONTAINERS.includes(part.trim()));
}

/** How many times a file that keeps failing is offered to the sweep before it is left alone. */
export const MAX_REPACKAGE_ATTEMPTS = 3;

/**
 * Whether the sweep should offer this entry. A file already holding the MP4 this writes
 * counts as done even with the flag missing, which is what a crash between the two leaves.
 */
export function needsRepackage(entry: DownloadEntry): boolean {
  if (entry.state !== "ready") return false;
  if (entry.repackaged || entry.repackageDeclined) return false;
  if ((entry.repackageAttempts ?? 0) >= MAX_REPACKAGE_ATTEMPTS) return false;
  if (alreadyNative(entry)) return false;
  return entry.fileUri !== repackagedFile(entry.itemId).uri;
}

/**
 * The rewrap holds the source and the output at once, so the peak is both files. Below
 * that the source is left alone rather than filling the disk to convert it.
 */
function hasRoomFor(sourceBytes: number): boolean {
  return Paths.availableDiskSpace - sourceBytes >= DISK_HEADROOM_BYTES;
}

export async function repackageDownload(entry: DownloadEntry, source: File): Promise<RepackageOutcome> {
  const keepSource: RepackageOutcome = { file: source, repackaged: false, declinedPermanently: false };

  if (!LocalRemuxer?.repackageDownload) return keepSource;
  if (alreadyNative(entry)) return keepSource;

  const output = repackagedFile(entry.itemId);
  if (output.uri === source.uri) return keepSource;

  if (!hasRoomFor(source.size ?? 0)) {
    logger.info("Skipping repackage, not enough free space", { service: "Downloads", itemId: entry.itemId });
    return keepSource;
  }

  // Cleared first, so `output.exists` afterwards can only mean this run wrote it. A
  // leftover from an interrupted attempt would otherwise be accepted as the new media.
  try {
    if (output.exists) output.delete();
  } catch (error) {
    logger.warn("Could not clear a stale repackage target", error, { service: "Downloads", itemId: entry.itemId });
    return keepSource;
  }

  try {
    const result: NativeResult = await LocalRemuxer.repackageDownload({
      itemId: entry.itemId,
      inputPath: filePath(source.uri),
      outputPath: filePath(output.uri),
    });

    if (!result?.repackaged) {
      logger[result?.failed ? "warn" : "info"]("Download kept its original container", {
        service: "Downloads",
        itemId: entry.itemId,
        reason: result?.reason ?? "unknown",
      });
      return { ...keepSource, declinedPermanently: result?.permanent === true };
    }

    // Only once the output exists: a missing file here would strand the item with no media.
    if (!output.exists) {
      logger.warn("Repackage reported success with no output file", { service: "Downloads", itemId: entry.itemId });
      return keepSource;
    }

    try {
      source.delete();
    } catch (error) {
      logger.warn("Could not remove the source after repackaging", error, { service: "Downloads", itemId: entry.itemId });
    }

    logger.info("Download repackaged for direct play", {
      service: "Downloads",
      itemId: entry.itemId,
      seconds: Math.round((result.elapsedSeconds ?? 0) * 100) / 100,
      subtitleTracks: result.subtitleStreamIndices?.length ?? 0,
      imageSubtitleTracks: result.imageSubtitleIndices?.length ?? 0,
      droppedAudio: result.droppedAudioIndices?.length ?? 0,
    });

    return {
      file: output,
      repackaged: true,
      declinedPermanently: false,
      subtitleStreamIndices: result.subtitleStreamIndices,
      imageSubtitleIndices: result.imageSubtitleIndices,
    };
  } catch (error) {
    logger.warn("Repackage call failed", error, { service: "Downloads", itemId: entry.itemId });
    return keepSource;
  }
}

/** Aborts a repackage in flight, for a download being deleted mid-pass. */
export function cancelRepackage(itemId: string): void {
  if (!LocalRemuxer?.cancelRepackage) return;
  void LocalRemuxer.cancelRepackage(itemId);
}
