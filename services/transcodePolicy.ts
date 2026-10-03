/**
 * Whether the server may be asked to transcode an item: the account's own permission, which the
 * server writes into the item (SupportsTranscoding), capped by the level chosen on this device.
 */
import { serverVideoTranscodingAllowed } from "@/services/jellyfin/media";
import { getUiPreferences } from "@/services/uiPreferences";
import type { JellyfinVideoItem } from "@/types/jellyfin";

/** The server may transcode this item at all: a file this device cannot play, an audio track it cannot carry. */
export function serverTranscodeAllowed(item: JellyfinVideoItem | null | undefined): boolean {
  return serverVideoTranscodingAllowed(item) && getUiPreferences().serverTranscoding !== "never";
}

/** The server may also feed the smaller rungs when the connection cannot carry the file. */
export function linkRungsAllowed(item: JellyfinVideoItem | null | undefined): boolean {
  return serverVideoTranscodingAllowed(item) && getUiPreferences().serverTranscoding === "linkOrFile";
}
