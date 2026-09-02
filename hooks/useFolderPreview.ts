import { fetchFolderPreviewItems } from "@/services/jellyfinApi";
import type { JellyfinItem, JellyfinVideoItem } from "@/types/jellyfin";
import { useEffect, useState } from "react";

/** Folder kinds whose children can be videos; albums, artists and photo albums never ask. */
const PREVIEW_TYPES = new Set(["Folder", "CollectionFolder", "UserView", "Series", "Season", "BoxSet", "Playlist"]);

const NONE: JellyfinVideoItem[] = [];

/**
 * The first videos under a folder the server left without a picture, for the card's collage.
 * Keyed by folder id so a recycled card never shows the previous folder's videos.
 */
export function useFolderPreview(folder: Pick<JellyfinItem, "Id" | "Type"> | null, wanted: boolean): JellyfinVideoItem[] {
  const folderId = folder?.Id ?? "";
  const eligible = wanted && !!folder && PREVIEW_TYPES.has(folder.Type);
  const [result, setResult] = useState<{ id: string; items: JellyfinVideoItem[] }>({ id: "", items: NONE });

  useEffect(() => {
    if (!eligible) return;
    let cancelled = false;
    fetchFolderPreviewItems(folderId)
      .then((items) => {
        if (!cancelled) setResult({ id: folderId, items });
      })
      .catch(() => {
        // The placeholder beats a stale collage; the request cache retries on the next mount.
        if (!cancelled) setResult({ id: folderId, items: NONE });
      });
    return () => {
      cancelled = true;
    };
  }, [folderId, eligible]);

  return eligible && result.id === folderId ? result.items : NONE;
}
