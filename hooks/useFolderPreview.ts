import { useAuthSession } from "@/hooks/useAuthSession";
import { fetchFolderPreviewItems } from "@/services/jellyfinApi";
import type { JellyfinItem, JellyfinVideoItem } from "@/types/jellyfin";
import { useEffect, useState } from "react";

/** Folder kinds whose children can be videos; albums, artists and photo albums never ask. */
const PREVIEW_TYPES = new Set(["Folder", "CollectionFolder", "UserView", "Series", "Season", "BoxSet", "Playlist"]);

const NONE: JellyfinVideoItem[] = [];

/**
 * The first videos under a folder the server left without a picture, for the card's collage.
 * Keyed by session and folder id so neither a recycled card nor a server switch shows another
 * folder's videos (useAuthSession).
 */
export function useFolderPreview(folder: Pick<JellyfinItem, "Id" | "Type"> | null, wanted: boolean): JellyfinVideoItem[] {
  const folderId = folder?.Id ?? "";
  const eligible = wanted && !!folder && PREVIEW_TYPES.has(folder.Type);
  const key = `${useAuthSession()}:${folderId}`;
  const [result, setResult] = useState<{ key: string; items: JellyfinVideoItem[] }>({ key: "", items: NONE });

  useEffect(() => {
    if (!eligible) return;
    let cancelled = false;
    fetchFolderPreviewItems(folderId)
      .then((items) => {
        if (!cancelled) setResult({ key, items });
      })
      .catch(() => {
        // The placeholder beats a stale collage; the request cache retries on the next mount.
        if (!cancelled) setResult({ key, items: NONE });
      });
    return () => {
      cancelled = true;
    };
  }, [key, folderId, eligible]);

  return eligible && result.key === key ? result.items : NONE;
}
