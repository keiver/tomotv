import { fetchFolderPreviewItems } from "@/services/jellyfinApi";
import type { JellyfinItem, JellyfinVideoItem } from "@/types/jellyfin";
import { useEffect, useState } from "react";

/** Folder kinds whose children can be videos; albums, artists and photo albums never ask. */
const PREVIEW_TYPES = new Set(["Folder", "CollectionFolder", "UserView", "Series", "Season", "BoxSet", "Playlist"]);

const NONE: JellyfinVideoItem[] = [];

/**
 * The first videos under a folder the server left without a picture, for the card's stack.
 * Keyed by folder id so a recycled card never shows the previous folder's videos.
 */
export function useFolderPreview(folder: JellyfinItem, wanted: boolean): JellyfinVideoItem[] {
  const eligible = wanted && PREVIEW_TYPES.has(folder.Type);
  const [result, setResult] = useState<{ id: string; items: JellyfinVideoItem[] }>({ id: "", items: NONE });

  useEffect(() => {
    if (!eligible) return;
    let cancelled = false;
    fetchFolderPreviewItems(folder.Id)
      .then((items) => {
        if (!cancelled) setResult({ id: folder.Id, items });
      })
      .catch(() => {
        // The placeholder beats a stale stack; the request cache retries on the next mount.
        if (!cancelled) setResult({ id: folder.Id, items: NONE });
      });
    return () => {
      cancelled = true;
    };
  }, [folder.Id, eligible]);

  return eligible && result.id === folder.Id ? result.items : NONE;
}
