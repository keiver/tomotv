import { useAuthSession } from "@/hooks/useAuthSession";
import { fetchFolderPreviewItems, fetchItemDetails, getTintUrl } from "@/services/jellyfinApi";
import { useEffect, useState } from "react";

/** A folder's colour tint. `sharp` = from Backdrop fanart; false = from a poster. */
export interface FolderBackdropSource {
  uri: string;
  sharp: boolean;
}

/**
 * The one image a folder tints its background from, resolved once on open and held for the whole
 * folder (never per-card — that thrashed the grid). Preference: the folder's own Backdrop fanart,
 * then its own poster, then the first poster among its descendants (fetchFolderPreviewItems is
 * server-side recursive), then nothing (the ambient glows show). Keyed by session + folder id so a
 * recycled screen or a server switch never shows a stale tint.
 */
export function useFolderBackdrop(folderId: string | null): FolderBackdropSource | null {
  const session = useAuthSession();
  const key = `${session}:${folderId ?? ""}`;
  const [result, setResult] = useState<{ key: string; source: FolderBackdropSource | null }>({ key: "", source: null });

  useEffect(() => {
    if (!folderId) return;
    let cancelled = false;
    void (async () => {
      const details = await fetchItemDetails(folderId).catch(() => null);
      if (cancelled) return;
      if (details?.BackdropImageTags?.length) {
        setResult({ key, source: { uri: getTintUrl(folderId, "Backdrop"), sharp: true } });
        return;
      }
      if (details?.ImageTags?.Primary) {
        setResult({ key, source: { uri: getTintUrl(folderId, "Primary"), sharp: false } });
        return;
      }
      const preview = await fetchFolderPreviewItems(folderId).catch(() => []);
      if (cancelled) return;
      const first = preview.find((item) => item.ImageTags?.Primary);
      setResult({ key, source: first ? { uri: getTintUrl(first.Id, "Primary"), sharp: false } : null });
    })();
    return () => {
      cancelled = true;
    };
  }, [key, folderId]);

  return result.key === key ? result.source : null;
}
