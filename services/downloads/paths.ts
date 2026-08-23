/**
 * paths.ts
 *
 * Where downloaded media lives and how it stays out of iCloud.
 *
 * Documents, not Caches: iOS purges Caches under storage pressure, and a gym playlist that
 * can evaporate on the way to the gym is not offline playback. Documents is backed up by
 * default, which Apple's Data Storage Guidelines forbid for re-downloadable media, so the
 * root carries `isExcludedFromBackup` (native/ios/MultiAudioResourceLoader/FileAttributes.swift —
 * expo-file-system exposes no API for it).
 */

import { Directory, File, Paths } from "expo-file-system";
import { NativeModules, Platform } from "react-native";
import { logger } from "@/utils/logger";

const { FileAttributes } = NativeModules;

const ROOT_NAME = "downloads";
const MANIFEST_NAME = "manifest.json";

/**
 * Apple gives tvOS apps no persistent local storage: no Documents directory, 500 KB of
 * NSUserDefaults, a purgeable Caches. Downloads is a phone and iPad feature.
 */
export function downloadsSupported(): boolean {
  return Platform.OS === "ios" && !Platform.isTV;
}

export function downloadsRoot(): Directory {
  return new Directory(Paths.document, ROOT_NAME);
}

export function manifestFile(): File {
  return new File(downloadsRoot(), MANIFEST_NAME);
}

/** One directory per item, so the media and its poster delete together. */
export function itemDirectory(itemId: string): Directory {
  return new Directory(downloadsRoot(), itemId);
}

export function artworkFile(itemId: string): File {
  return new File(itemDirectory(itemId), "poster.jpg");
}

/**
 * The media filename. The extension matters: FFmpeg and AVFoundation both probe content, but
 * a wrong extension makes the Files app and any future export lie about the type.
 */
export function mediaFile(itemId: string, container: string | null | undefined): File {
  const extension = (container ?? "").replace(/^\./, "").split(",")[0].trim();
  return new File(itemDirectory(itemId), extension ? `media.${extension}` : "media");
}

let exclusionApplied = false;

/**
 * Creates the download root and marks it do-not-back-up, once per launch. Exclusion failure
 * is logged rather than thrown: it costs an App Review conversation, not the feature.
 */
export async function ensureDownloadsRoot(): Promise<Directory> {
  const root = downloadsRoot();
  if (!root.exists) root.create({ intermediates: true, idempotent: true });

  if (!exclusionApplied && FileAttributes?.setExcludedFromBackup) {
    try {
      await FileAttributes.setExcludedFromBackup(root.uri, true);
      exclusionApplied = true;
    } catch (error) {
      logger.warn("Could not exclude downloads from iCloud backup", error, { service: "Downloads" });
    }
  }
  return root;
}

/** Reads the flag back so the exclusion is a measurement rather than a hope. */
export async function downloadsExcludedFromBackup(): Promise<boolean | null> {
  if (!FileAttributes?.isExcludedFromBackup) return null;
  try {
    return await FileAttributes.isExcludedFromBackup(downloadsRoot().uri);
  } catch {
    return null;
  }
}

export function ensureItemDirectory(itemId: string): Directory {
  const directory = itemDirectory(itemId);
  if (!directory.exists) directory.create({ intermediates: true, idempotent: true });
  return directory;
}

/** Removes everything belonging to one item. Safe when the directory was never created. */
export function removeItemDirectory(itemId: string): void {
  const directory = itemDirectory(itemId);
  if (directory.exists) directory.delete();
}
