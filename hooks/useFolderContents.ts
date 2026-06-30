import { CACHE } from "@/constants/app";
import { useAppStateRefresh } from "@/hooks/useAppStateRefresh";
import { deleteFolderCache, getFolderCache, setFolderCache } from "@/services/folderContentsCache";
import { fetchFolderContents, fetchPlaylistContents, fetchUserViews } from "@/services/jellyfinApi";
import { JellyfinItem } from "@/types/jellyfin";
import { logger } from "@/utils/logger";
import { useCallback, useEffect, useRef, useState } from "react";

const PAGE_SIZE = 60;

interface FolderContentsState {
  items: JellyfinItem[];
  isLoading: boolean;
  isLoadingMore: boolean;
  hasMoreResults: boolean;
  error: string | null;
  loadMore: () => void;
  refresh: () => void;
}

/**
 * Loads and paginates the contents of one folder for a single screen. Pass `folderId = null` for
 * the libraries root (user views). Each pushed folder route is its own mounted instance, so
 * `folderId` is fixed for the lifetime of the hook and the router's back stack is the single source
 * of truth for navigation.
 */
export function useFolderContents(folderId: string | null, type?: "folder" | "playlist"): FolderContentsState {
  const [items, setItems] = useState<JellyfinItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [hasMoreResults, setHasMoreResults] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Pagination bookkeeping in refs so loadMore never reads stale closure state.
  const nextStartIndex = useRef(0);
  const totalRef = useRef<number | undefined>(undefined);
  const isFetchingRef = useRef(false);
  // Monotonic id for first-page loads (mount + refresh + foreground). Only the latest one applies.
  const requestIdRef = useRef(0);
  const cacheKey = folderId ?? "root";

  const fetchPage = useCallback(
    (startIndex: number) => {
      if (!folderId) return fetchUserViews();
      if (type === "playlist") return fetchPlaylistContents(folderId, { limit: PAGE_SIZE, startIndex });
      return fetchFolderContents(folderId, { limit: PAGE_SIZE, startIndex });
    },
    [folderId, type],
  );

  // Resolve the first page from cache (fresh) or the network. A pure read — the caller writes the
  // cache only when its request is still the latest, so an overlapping stale load can't clobber it.
  // Always returns a promise, so callers only ever setState from a .then()/.catch() callback.
  const loadFirstPage = useCallback(
    async (useCache: boolean): Promise<{ items: JellyfinItem[]; total?: number; fromCache: boolean }> => {
      const cached = getFolderCache(cacheKey);
      if (useCache && cached && Date.now() - cached.timestamp < CACHE.DEFAULT_TTL_MS) {
        return { items: cached.items, total: cached.total, fromCache: true };
      }
      const result = await fetchPage(0);
      return { items: result.items, total: result.total, fromCache: false };
    },
    [cacheKey, fetchPage],
  );

  const applyFirstPage = useCallback((result: { items: JellyfinItem[]; total?: number }) => {
    setItems(result.items);
    totalRef.current = result.total;
    nextStartIndex.current = result.items.length;
    setHasMoreResults(result.total !== undefined && result.items.length < result.total);
    setError(null);
    setIsLoading(false);
  }, []);

  const onLoadError = useCallback(
    (err: unknown) => {
      setItems([]);
      setError(err instanceof Error ? err.message : "Failed to load folder");
      setIsLoading(false);
      logger.error("Error loading folder contents", err, { service: "useFolderContents", cacheKey });
    },
    [cacheKey],
  );

  // Run a first-page load (initial mount, refresh, or foreground). First-page loads can overlap —
  // e.g. a slow initial fetch is still in flight when an auth change fires refresh(). Tagging each
  // with a request id and applying only when it is still the latest means an older promise resolving
  // last can't overwrite newer state or write a stale page into the cache. The effect cleanup bumps
  // the id too, so nothing applies after unmount / folder change.
  const runFirstPage = useCallback(
    (useCache: boolean) => {
      const requestId = ++requestIdRef.current;
      isFetchingRef.current = true;
      loadFirstPage(useCache)
        .then((result) => {
          if (requestId !== requestIdRef.current) return;
          if (!result.fromCache) {
            setFolderCache(cacheKey, { items: result.items, total: result.total, timestamp: Date.now() });
          }
          applyFirstPage(result);
        })
        .catch((err) => {
          if (requestId === requestIdRef.current) onLoadError(err);
        })
        .finally(() => {
          if (requestId === requestIdRef.current) isFetchingRef.current = false;
        });
    },
    [cacheKey, loadFirstPage, applyFirstPage, onLoadError],
  );

  useEffect(() => {
    runFirstPage(true);
    return () => {
      // Bump the live id so any in-flight first-page load can't apply state after unmount / folder
      // change. Mutating requestIdRef.current here is intentional (not a captured DOM node).
      // eslint-disable-next-line react-hooks/exhaustive-deps
      requestIdRef.current++;
    };
  }, [runFirstPage]);

  const loadMore = useCallback(async () => {
    if (isFetchingRef.current || !hasMoreResults) return;
    try {
      isFetchingRef.current = true;
      setIsLoadingMore(true);
      const { items: more, total } = await fetchPage(nextStartIndex.current);
      if (more.length === 0) {
        setHasMoreResults(false);
        return;
      }
      setItems((prev) => [...prev, ...more]);
      nextStartIndex.current += more.length;
      totalRef.current = total;
      setHasMoreResults(total !== undefined && nextStartIndex.current < total);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load more");
      logger.error("Error loading more folder items", err, { service: "useFolderContents", cacheKey });
    } finally {
      isFetchingRef.current = false;
      setIsLoadingMore(false);
    }
  }, [cacheKey, fetchPage, hasMoreResults]);

  const refresh = useCallback(() => {
    deleteFolderCache(cacheKey);
    runFirstPage(false);
  }, [cacheKey, runFirstPage]);

  // Refetch the visible folder when the app returns to the foreground.
  useAppStateRefresh(refresh, "useFolderContents");

  return { items, isLoading, isLoadingMore, hasMoreResults, error, loadMore, refresh };
}
