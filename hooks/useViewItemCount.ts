import { fetchViewItemCount } from "@/services/jellyfinApi";
import { JellyfinItem } from "@/types/jellyfin";
import { useEffect, useState } from "react";

/** Library roots whose counts the server can't provide inline (see fetchViewItemCount). */
const VIEW_TYPES = new Set(["CollectionFolder", "UserView"]);

/**
 * Lazy item count for a library view card. The count can need a multi-query walk on
 * servers where view-root recursion is broken, so the card renders immediately and the
 * count streams in; `loading` drives the badge spinner. Non-view folders (whose count
 * arrives Fields-gated on the item itself) resolve instantly with no request.
 */
export function useViewItemCount(folder: JellyfinItem): { count: number | undefined; loading: boolean } {
  const isView = VIEW_TYPES.has(folder.Type) && folder.RecursiveItemCount == null;
  // Keyed by folder id so a recycled card never shows the previous item's count.
  const [result, setResult] = useState<{ id: string; count: number | undefined }>({ id: "", count: undefined });

  useEffect(() => {
    if (!isView) return;
    let cancelled = false;
    fetchViewItemCount(folder.Id)
      .then((count) => {
        if (!cancelled) setResult({ id: folder.Id, count });
      })
      .catch(() => {
        // No badge beats a wrong number; the request cache retries on the next mount.
        if (!cancelled) setResult({ id: folder.Id, count: undefined });
      });
    return () => {
      cancelled = true;
    };
  }, [folder.Id, isView]);

  if (!isView) {
    return { count: undefined, loading: false };
  }
  const resolved = result.id === folder.Id;
  return { count: resolved ? result.count : undefined, loading: !resolved };
}
