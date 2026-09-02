import { useAuthSession } from "@/hooks/useAuthSession";
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
  // Session + folder id, so neither a recycled card nor a server switch can show a count
  // that belongs to something else (useAuthSession).
  const key = `${useAuthSession()}:${folder.Id}`;
  const [result, setResult] = useState<{ key: string; count: number | undefined }>({ key: "", count: undefined });

  useEffect(() => {
    if (!isView) return;
    let cancelled = false;
    fetchViewItemCount(folder.Id)
      .then((count) => {
        if (!cancelled) setResult({ key, count });
      })
      .catch(() => {
        // No badge beats a wrong number; the request cache retries on the next mount.
        if (!cancelled) setResult({ key, count: undefined });
      });
    return () => {
      cancelled = true;
    };
  }, [key, folder.Id, isView]);

  if (!isView) {
    return { count: undefined, loading: false };
  }
  const resolved = result.key === key;
  return { count: resolved ? result.count : undefined, loading: !resolved };
}
