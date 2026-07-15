import { CACHE } from "@/constants/app";
import { useAppStateRefresh } from "@/hooks/useAppStateRefresh";
import { deleteFolderCache, FolderCacheEntry, getFolderCache, setFolderCache } from "@/services/folderContentsCache";
import { getFavoriteIds, isFavoritesLoaded } from "@/services/favoritesCache";
import { fetchFavoriteIds, fetchFolderContents, fetchPlaylistContents, fetchUserViews, subscribeFavoriteChange } from "@/services/jellyfinApi";
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
 * Overlay favorite hearts from the cached favorite-id set. The non-recursive browse doesn't reliably
 * carry UserData.IsFavorite for leaf children, so the cache is the source of truth. Add-only and
 * immutable so memoized cards re-render when a heart turns on. Callers apply the folder/filter guard.
 */
function annotateWithFavorites(list: JellyfinItem[]): JellyfinItem[] {
  const favs = getFavoriteIds();
  if (favs.size === 0) return list;
  return list.map((item) => (favs.has(item.Id) && !item.UserData?.IsFavorite ? { ...item, UserData: { ...item.UserData, IsFavorite: true } } : item));
}

/**
 * Loads and paginates the contents of one folder for a single screen. Pass `folderId = null` for
 * the libraries root (user views). Each pushed folder route is its own mounted instance, so
 * `folderId` is fixed for the lifetime of the hook and the router's back stack is the single source
 * of truth for navigation.
 */
export function useFolderContents(folderId: string | null, type?: "folder" | "playlist", filters?: LibraryFilters): FolderContentsState {
  const cacheKey = folderId ?? "root";

  // Serialize the selection so callers don't have to memoize the filters object; a changed
  // selection produces a new key, which rebuilds fetchPage and retriggers the first-page effect.
  const filterKey = filters && countActiveFilters(filters) > 0 ? JSON.stringify(filters) : "";
  const activeFilters = useMemo(() => (filterKey ? (JSON.parse(filterKey) as LibraryFilters) : undefined), [filterKey]);

  // Seed synchronously from the folder cache ONCE, at mount, so a fresh revisit paints its content on
  // the first frame with no spinner — the async first-page effect below then just confirms it.
  // Filtered views are never cached (entries are keyed by folder only), so they still spin.
  const seedRef = useRef<FolderCacheEntry | null | undefined>(undefined);
  if (seedRef.current === undefined) {
    const cached = activeFilters ? undefined : getFolderCache(cacheKey);
    seedRef.current = cached && Date.now() - cached.timestamp < CACHE.DEFAULT_TTL_MS ? cached : null;
  }
  const seed = seedRef.current;

  const [items, setItems] = useState<JellyfinItem[]>(() => (seed ? (folderId ? annotateWithFavorites(seed.items) : seed.items) : []));
  const [isLoading, setIsLoading] = useState(!seed);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [hasMoreResults, setHasMoreResults] = useState(!!seed && seed.total !== undefined && seed.items.length < seed.total);
  const [error, setError] = useState<string | null>(null);

  // Pagination bookkeeping in refs so loadMore never reads stale closure state.
  const nextStartIndex = useRef(seed ? seed.items.length : 0);
  const totalRef = useRef<number | undefined>(seed?.total);
  const isFetchingRef = useRef(false);
  // Monotonic id for first-page loads (mount + refresh + foreground). Only the latest one applies.
  const requestIdRef = useRef(0);
  // Ids of loaded items, for de-duplicating shuffled pages (SortBy=Random reshuffles per request).
  const seenIdsRef = useRef<Set<string>>(new Set(seed ? seed.items.map((item) => item.Id) : []));

  // Paint favorite hearts on the normal (unfiltered) browse from the cached favorite ids. Filtered
  // views already carry favorite state from the server, and the root has no favoritable leaves, so
  // skip both; everything else defers to annotateWithFavorites.
  const annotateFavorites = useCallback(
    (list: JellyfinItem[]): JellyfinItem[] => {
      if (!folderId || activeFilters) return list;
      return annotateWithFavorites(list);
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
      const { items: more, total } = await fetchPage(nextStartIndex.current);
      if (requestId !== requestIdRef.current) return;
      // SortBy=Random reshuffles on every request, so later pages can repeat earlier items.
      // Drop the repeats; an all-duplicate page means the shuffled set is exhausted.
      const fresh = activeFilters?.shuffle ? more.filter((item) => !seenIdsRef.current.has(item.Id)) : more;
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

  // Repaint the toggled card in place on any favorite change (long-press here, the player heart,
  // anywhere). annotateFavorites is add-only and the browse's per-item favorite state is unreliable,
  // so a removal would otherwise never clear the heart. Fully optimistic — no refetch — so it stays
  // instant and self-contained: in the Favorites view an unfavorited item drops out of the list;
  // everywhere else the heart just turns off.
  useEffect(() => {
    return subscribeFavoriteChange((itemId, favorite) => {
      setItems((prev) => {
        if (activeFilters?.favorite && !favorite) return prev.filter((item) => item.Id !== itemId);
        return prev.map((item) => (item.Id === itemId ? { ...item, UserData: { ...item.UserData, IsFavorite: favorite } } : item));
      });
    });
  }, [activeFilters]);

  // Refetch the visible folder when the app returns to the foreground.
  useAppStateRefresh(refresh, "useFolderContents");

  return { items, isLoading, isLoadingMore, hasMoreResults, error, loadMore, refresh };
}
