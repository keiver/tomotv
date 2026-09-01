/**
 * Hand one photo to the iOS share sheet.
 *
 * UIActivityViewController takes a file URL, not a remote one: the Jellyfin URL carries the
 * session token and only resolves on the LAN, so the image comes down to the cache directory
 * first and the local copy is what gets shared. tvOS has no share sheet (React Native compiles
 * the module out), so callers gate this to phone and iPad.
 */
import { getPhotoFileUrl, getPhotoUrl } from "@/services/jellyfinApi";
import { JellyfinItem } from "@/types/jellyfin";
import { logger } from "@/utils/logger";
import { Directory, File, Paths } from "expo-file-system";
import { Share } from "react-native";

const SHARE_DIR = "shared-photos";

/** The name the recipient sees. Falls back to the item name when the server reports no path. */
function shareFileName(item: JellyfinItem): string {
  const fromPath = item.Path?.split("/").pop();
  if (fromPath && fromPath.includes(".")) return fromPath;
  const extension = item.Container?.toLowerCase() || "jpg";
  return `${(item.Name || "photo").replace(/[/\\:]/g, "-")}.${extension}`;
}

export async function sharePhoto(item: JellyfinItem): Promise<void> {
  const directory = new Directory(Paths.cache, SHARE_DIR);
  if (!directory.exists) directory.create({ intermediates: true });
  const destination = new File(directory, shareFileName(item));

  // The Download endpoint is policy-gated; the image endpoint answers for anything the
  // viewer could display, so it is the fallback rather than a second failure.
  let downloaded: File | null = null;
  for (const url of [getPhotoFileUrl(item.Id), getPhotoUrl(item.Id)]) {
    if (!url) continue;
    try {
      const file = await File.downloadFileAsync(url, destination, { idempotent: true });
      if (file.size > 0) {
        downloaded = file;
        break;
      }
    } catch (error) {
      logger.warn("Photo share download failed", error, { service: "SharePhoto", itemId: item.Id, url });
    }
  }

  if (!downloaded) throw new Error("Could not download this photo to share.");

  await Share.share({ url: downloaded.uri, title: item.Name });
}
