/**
 * Whether the server may be asked to transcode an item: the account's own permission, which the
 * server writes into the item (SupportsTranscoding), capped by the level chosen on this device.
 */
import { serverVideoTranscodingAllowed } from "@/services/jellyfin/media";
import { getUiPreferences } from "@/services/uiPreferences";
import type { JellyfinVideoItem } from "@/types/jellyfin";

/** Who keeps the server from transcoding an item: the account's permission or this device's level. */
export type ServerTranscodeBlock = "account" | "device";

export function serverTranscodeBlock(item: JellyfinVideoItem | null | undefined): ServerTranscodeBlock | null {
  if (!serverVideoTranscodingAllowed(item)) return "account";
  return getUiPreferences().serverTranscoding === "never" ? "device" : null;
}

/** The server may transcode this item at all: a file this device cannot play, an audio track it cannot carry. */
export function serverTranscodeAllowed(item: JellyfinVideoItem | null | undefined): boolean {
  return serverTranscodeBlock(item) === null;
}

/** The server may also feed the smaller rungs when the connection cannot carry the file. */
export function linkRungsAllowed(item: JellyfinVideoItem | null | undefined): boolean {
  return serverVideoTranscodingAllowed(item) && getUiPreferences().serverTranscoding === "linkOrFile";
}
