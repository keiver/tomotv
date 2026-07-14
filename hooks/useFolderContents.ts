import { CACHE } from "@/constants/app";
import { useAppStateRefresh } from "@/hooks/useAppStateRefresh";
import { deleteFolderCache, getFolderCache, setFolderCache } from "@/services/folderContentsCache";
import { getFavoriteIds, isFavoritesLoaded } from "@/services/favoritesCache";
import { fetchFavoriteIds, fetchFolderContents, fetchPlaylistContents, fetchUserViews } from "@/services/jellyfinApi";
import { countActiveFilters, JellyfinItem, LibraryFilters } from "@/types/jellyfin";
import { logger } from "@/utils/logger";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

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
export function useFolderContents(folderId: string | null, type?: "folder" | "playlist", filters?: LibraryFilters): FolderContentsState {
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
  // Ids of loaded items, for de-duplicating shuffled pages (SortBy=Random reshuffles per request).
  const seenIdsRef = useRef<Set<string>>(new Set());
  const cacheKey = folderId ?? "root";

  // Serialize the selection so callers don't have to memoize the filters object; a changed
  // selection produces a new key, which rebuilds fetchPage and retriggers the first-page effect.
  const filterKey = filters && countActiveFilters(filters) > 0 ? JSON.stringify(filters) : "";
  const activeFilters = useMemo(() => (filterKey ? (JSON.parse(filterKey) as LibraryFilters) : undefined), [filterKey]);

  // Paint favorite hearts on the normal (unfiltered) browse from the cached favorite ids. The
  // non-recursive browse doesn't reliably carry UserData.IsFavorite for leaf children; the cache is
  // seeded by the favorite-filtered fetch (reused for free) or a one-time cold load. Filtered views
  // already carry favorite state from the server, and the root has no favoritable leaves, so skip
  // both. Immutable copies so the memoized cards re-render when a heart turns on.
  const annotateFavorites = useCallback(
    (list: JellyfinItem[]): JellyfinItem[] => {
      if (!folderId || activeFilters) return list;
      const favs = getFavoriteIds();
      if (favs.size === 0) return list;
      return list.map((item) => (favs.has(item.Id) && !item.UserData?.IsFavorite ? { ...item, UserData: { ...item.UserData, IsFavorite: true } } : item));
    },
    [folderId, activeFilters],
  );

  const fetchPage = useCallback(
    (startIndex: number) => {
      if (!folderId) return fetchUserViews();
      if (type === "playlist") return fetchPlaylistContents(folderId, { limit: PAGE_SIZE, startIndex });
      return fetchFolderContents(folderId, { limit: PAGE_SIZE, startIndex, filters: activeFilters });
    },
    [folderId, type, activeFilters],
  );

  // Resolve the first page from cache (fresh) or the network. A pure read — the caller writes the
  // cache only when its request is still the latest, so an overlapping stale load can't clobber it.
  // Always returns a promise, so callers only ever setState from a .then()/.catch() callback.
  const loadFirstPage = useCallback(
    async (useCache: boolean): Promise<{ items: JellyfinItem[]; total?: number; fromCache: boolean }> => {
      // Filtered views bypass the cache entirely: entries are keyed by folder only, and a
      // filtered result must never be served as (or overwrite) the unfiltered listing.
      const cached = activeFilters ? undefined : getFolderCache(cacheKey);
      if (useCache && cached && Date.now() - cached.timestamp < CACHE.DEFAULT_TTL_MS) {
        return { items: cached.items, total: cached.total, fromCache: true };
      }
      const result = await fetchPage(0);
      return { items: result.items, total: result.total, fromCache: false };
    },
    [cacheKey, fetchPage, activeFilters],
  );

  const applyFirstPage = useCallback(
    (result: { items: JellyfinItem[]; total?: number }) => {
      setItems(annotateFavorites(result.items));
      seenIdsRef.current = new Set(result.items.map((item) => item.Id));
      totalRef.current = result.total;
      nextStartIndex.current = result.items.length;
      setHasMoreResults(result.total !== undefined && result.items.length < result.total);
      setError(null);
      setIsLoading(false);
    },
    [annotateFavorites],
  );

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
          if (!result.fromCache && !activeFilters) {
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

      // Cold fallback: seed the favorites cache once so unfiltered browses can paint hearts even
      // when the user never opened the Favorite filter. Runs only when the cache is empty, in
      // parallel with the page load; re-annotates the current list on success if still the latest.
      if (folderId && !activeFilters && !isFavoritesLoaded()) {
        fetchFavoriteIds(folderId)
          .then(() => {
            if (requestId === requestIdRef.current) setItems((prev) => annotateFavorites(prev));
          })
          .catch((err) => logger.warn("Favorite ids load failed", err, { service: "useFolderContents", cacheKey }));
      }
    },
    [cacheKey, folderId, loadFirstPage, applyFirstPage, onLoadError, activeFilters, annotateFavorites],
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
    // Tie this page to the current first-page generation. If a refresh/remount supersedes the list
    // while this fetch is in flight, drop the page (don't append stale items onto fresh ones) and
    // leave the in-flight flag to the newer request that now owns it.
    const requestId = requestIdRef.current;
    try {
      isFetchingRef.current = true;
      setIsLoadingMore(true);

      // SortBy=Random reshuffles on every request, so a page can repeat items already seen. Drop the
      // repeats. An all-duplicate page can also happen by chance while unseen items remain, so on
      // shuffle we re-fetch the same index a few times before concluding the set is exhausted. A page
      // the server returns short (< a full PAGE_SIZE) is a real end-of-list signal — stop retrying.
      const maxAttempts = activeFilters?.shuffle ? 3 : 1;
      let more: JellyfinItem[] = [];
      let total: number | undefined;
      let fresh: JellyfinItem[] = [];
      for (let attempt = 0; attempt < maxAttempts; attempt++) {
        const page = await fetchPage(nextStartIndex.current);
        if (requestId !== requestIdRef.current) return;
        more = page.items;
        total = page.total;
        fresh = activeFilters?.shuffle ? more.filter((item) => !seenIdsRef.current.has(item.Id)) : more;
        if (fresh.length > 0 || more.length < PAGE_SIZE) break;
      }
      if (fresh.length === 0) {
        setHasMoreResults(false);
        return;
      }
      fresh.forEach((item) => seenIdsRef.current.add(item.Id));
      setItems((prev) => [...prev, ...annotateFavorites(fresh)]);
      nextStartIndex.current += more.length;
      totalRef.current = total;
      setHasMoreResults(total !== undefined && nextStartIndex.current < total);
    } catch (err) {
      if (requestId !== requestIdRef.current) return;
      setError(err instanceof Error ? err.message : "Failed to load more");
      logger.error("Error loading more folder items", err, { service: "useFolderContents", cacheKey });
    } finally {
      if (requestId === requestIdRef.current) isFetchingRef.current = false;
      setIsLoadingMore(false);
    }
  }, [cacheKey, fetchPage, hasMoreResults, activeFilters, annotateFavorites]);

  const refresh = useCallback(() => {
    deleteFolderCache(cacheKey);
    runFirstPage(false);
  }, [cacheKey, runFirstPage]);

  // Refetch the visible folder when the app returns to the foreground.
  useAppStateRefresh(refresh, "useFolderContents");

  return { items, isLoading, isLoadingMore, hasMoreResults, error, loadMore, refresh };
}
