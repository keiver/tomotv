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
  const cacheKey = folderId ?? "root";

  const fetchPage = useCallback(
    (startIndex: number) => {
      if (!folderId) return fetchUserViews();
      if (type === "playlist") return fetchPlaylistContents(folderId, { limit: PAGE_SIZE, startIndex });
      return fetchFolderContents(folderId, { limit: PAGE_SIZE, startIndex });
    },
    [folderId, type],
  );

  // Resolve the first page from cache (fresh) or the network. Always returns a promise, so callers
  // only ever setState from a .then()/.catch() callback — never synchronously inside an effect.
  const loadFirstPage = useCallback(
    async (useCache: boolean): Promise<{ items: JellyfinItem[]; total?: number }> => {
      const cached = getFolderCache(cacheKey);
      if (useCache && cached && Date.now() - cached.timestamp < CACHE.DEFAULT_TTL_MS) {
        return { items: cached.items, total: cached.total };
      }
      const result = await fetchPage(0);
      setFolderCache(cacheKey, { items: result.items, total: result.total, timestamp: Date.now() });
      return result;
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

  useEffect(() => {
    let active = true;
    isFetchingRef.current = true;
    loadFirstPage(true)
      .then((result) => {
        if (active) applyFirstPage(result);
      })
      .catch((err) => {
        if (active) onLoadError(err);
      })
      .finally(() => {
        isFetchingRef.current = false;
      });
    return () => {
      active = false;
    };
  }, [loadFirstPage, applyFirstPage, onLoadError]);

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
    isFetchingRef.current = true;
    loadFirstPage(false)
      .then(applyFirstPage)
      .catch(onLoadError)
      .finally(() => {
        isFetchingRef.current = false;
      });
  }, [cacheKey, loadFirstPage, applyFirstPage, onLoadError]);

  // Refetch the visible folder when the app returns to the foreground.
  useAppStateRefresh(refresh, "useFolderContents");

  return { items, isLoading, isLoadingMore, hasMoreResults, error, loadMore, refresh };
}
