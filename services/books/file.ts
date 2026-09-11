/**
 * The book file on disk. `/Items/{id}/File` needs no download policy and supports ranges,
 * so it comes down into Caches once and the OS reclaims it under pressure.
 */
import { getBookFileUrl } from "@/services/jellyfinApi";
import type { JellyfinItem } from "@/types/jellyfin";
import { logger } from "@/utils/logger";
import { Directory, File, Paths } from "expo-file-system";
import { bookExtension } from "./kinds";

const BOOKS_DIR = "books";

/** file:// path of the item's book file, downloading it when it is not cached yet. */
export async function ensureBookFile(item: JellyfinItem): Promise<string> {
  const directory = new Directory(Paths.cache, BOOKS_DIR);
  if (!directory.exists) directory.create({ intermediates: true });
  const ext = bookExtension(item) || "bin";
  const destination = new File(directory, `${item.Id}.${ext}`);
  if (destination.exists && destination.size > 0) return destination.uri;

  const url = getBookFileUrl(item.Id);
  if (!url) throw new Error("Server not configured.");
  const file = await File.downloadFileAsync(url, destination, { idempotent: true });
  if (file.size <= 0) {
    logger.warn("Book download was empty", { service: "Books", itemId: item.Id });
    throw new Error("Could not download this book.");
  }
  return file.uri;
}
