import { LibraryGrid } from "@/components/library-grid";
import { useLoadingActions } from "@/contexts/LoadingContext";
import { useLibraryFilters } from "@/contexts/LibraryFiltersContext";
import { usePlayQueue } from "@/contexts/PlayQueueContext";
import { useFolderContents } from "@/hooks/useFolderContents";
import { useItemLongPress } from "@/hooks/useItemLongPress";
import { fetchFilteredVideos, isAudioItem, isFolder, isPhoto } from "@/services/jellyfinApi";
import { countActiveFilters, FolderStackEntry, JellyfinItem, JellyfinVideoItem } from "@/types/jellyfin";
import { logger } from "@/utils/logger";
import { backkeyProbe } from "@/utils/backkeyProbe";
import { useLocalSearchParams, useRouter } from "expo-router";
import React, { useCallback, useEffect, useMemo, useRef } from "react";

/**
 * Page budget for the walk that hunts down a `focusId` (10 pages of 60 = 600 items). Reached
 * only when the item sits very deep, or is filtered out of this listing entirely; the folder
 * then just stays where it is with the first card focused.
 */
const MAX_FOCUS_WALK_PAGES = 10;

/** Fisher-Yates shuffle — a fresh random order on every call (does not mutate the input). */
function shuffled<T>(items: T[]): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/**
 * A single folder level — a real pushed route. On TV the Menu button pops it natively (no menu
 * handlers, per the e136575 lesson). onBack drives the touch back row on phone. `crumbs` carries
 * the full path for the header; we append to it on push.
 */
function FolderScreen() {
  const router = useRouter();
  const { showGlobalLoader } = useLoadingActions();
  const { buildQueue, buildQueueFromItems } = usePlayQueue();
  const params = useLocalSearchParams<{ folderId: string; name?: string; type?: string; crumbs?: string; focusId?: string }>();

  const folderId = params.folderId;
  const folderName = params.name ?? "";
  const folderType: "folder" | "playlist" = params.type === "playlist" ? "playlist" : "folder";

  const { getFilters } = useLibraryFilters();

  const crumbs = useMemo<FolderStackEntry[]>(() => {
    try {
      return params.crumbs ? (JSON.parse(params.crumbs) as FolderStackEntry[]) : [{ id: folderId, name: folderName, type: folderType }];
    } catch {
      return [{ id: folderId, name: folderName, type: folderType }];
    }
  }, [params.crumbs, folderId, folderName, folderType]);

  // Filters are scoped to the entered library (crumbs[0]), not the current folder, so a selection
  // persists as you browse down into sub-folders. crumbs[0].id equals folderId at the library root.
  const libraryId = crumbs[0]?.id ?? folderId;
  const filters = getFilters(libraryId);
  const activeFilterCount = countActiveFilters(filters);

  const { items, isLoading, isLoadingMore, hasMoreResults, error, loadMore, refresh } = useFolderContents(folderId, folderType, filters);

  // [backkey] temporary diagnostics — remove after the Menu/back investigation
  useEffect(() => {
    backkeyProbe("folder screen MOUNT", { folderId, name: folderName });
    return () => backkeyProbe("folder screen UNMOUNT", { folderId, name: folderName });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // "Show In Folder" arrives with the item to focus, which the grid can only focus once it is
  // loaded — and pages are 60 items. Walk forward a page at a time until it turns up, then stop.
  // Each settled page re-runs this effect, so the walk is driven by arrivals, never by a timer.
  const focusId = params.focusId;
  const focusWalkPages = useRef(0);
  useEffect(() => {
    if (!focusId || isLoading || isLoadingMore || !hasMoreResults) return;
    if (items.some((item) => item.Id === focusId)) return;
    if (focusWalkPages.current >= MAX_FOCUS_WALK_PAGES) return;
    focusWalkPages.current += 1;
    loadMore();
  }, [focusId, items, isLoading, isLoadingMore, hasMoreResults, loadMore]);

  const handleItemPress = useCallback(
    (item: JellyfinItem) => {
      if (isFolder(item)) {
        const type = item.Type === "Playlist" ? "playlist" : "folder";
        const childCrumb: FolderStackEntry = { id: item.Id, name: item.Name, type, parentId: item.ParentId };
        router.push({
          pathname: "/[folderId]",
          params: { folderId: item.Id, name: item.Name, type, crumbs: JSON.stringify([...crumbs, childCrumb]) },
        });
      } else if (isPhoto(item)) {
        // libraryId carries the filter scope: with a filter on, the viewer must swipe through the
        // filtered set, not the folder the user happens to be standing in.
        router.push({ pathname: "/photo-viewer", params: { folderId, photoId: item.Id, libraryId } });
      } else if (activeFilterCount > 0) {
        // Filtered play: queue the ENTIRE filtered set (not just the loaded grid pages) fetched
        // fresh, so shuffle covers the whole library and re-randomizes on every play. Shuffle loops.
        showGlobalLoader();
        // Audio routes to the native queue player (gapless, background); the
        // tapped item decides for the whole set.
        const playerRoute = isAudioItem(item) ? ("/audio-player" as const) : ("/player" as const);
        const openPlayer = (queue: JellyfinVideoItem[], startId: string) => {
          buildQueueFromItems(queue, folderId, folderName, startId, filters.shuffle);
          router.push({ pathname: playerRoute, params: { videoId: startId, videoName: item.Name, queueMode: "true" } });
        };
        fetchFilteredVideos(folderId, filters)
          .then((full) => {
            if (filters.shuffle) {
              // Fresh random order; move the tapped item to the front so it plays immediately.
              const order = shuffled(full.filter((v) => v.Id !== item.Id));
              const tapped = full.find((v) => v.Id === item.Id);
              openPlayer(tapped ? [tapped, ...order] : order, item.Id);
            } else {
              openPlayer(full, item.Id);
            }
          })
          .catch((err) => {
            // Fall back to the loaded grid items so playback still works if the full fetch fails.
            logger.warn("Full filtered fetch failed; using loaded items", err, { service: "FolderScreen", folderId });
            const loaded = items.filter((i) => !isFolder(i) && !isPhoto(i));
            openPlayer(filters.shuffle ? shuffled(loaded) : loaded, item.Id);
          });
      } else {
        // Inside a folder — build a queue of all videos under this folder.
        // Audio items open the native queue player instead (the audio screen
        // waits out the in-flight buildQueue via the manager's isLoading).
        buildQueue(folderId, folderName, item.Id, folderType);
        showGlobalLoader();
        router.push({ pathname: isAudioItem(item) ? ("/audio-player" as const) : ("/player" as const), params: { videoId: item.Id, videoName: item.Name, queueMode: "true" } });
      }
    },
    [router, crumbs, buildQueue, buildQueueFromItems, items, activeFilterCount, filters, folderId, folderName, folderType, libraryId, showGlobalLoader],
  );

  const handleOpenFilters = useCallback(() => {
    // Options and filter state both key off the library root (libraryId) so they are shared anywhere
    // inside the library. Pass folderId only for the panel's subtitle.
    router.push({ pathname: "/filters", params: { folderId, name: folderName, libraryId } });
  }, [router, folderId, folderName, libraryId]);

  const handleItemLongPress = useItemLongPress();

  return (
    <LibraryGrid
      items={items}
      isLoading={isLoading}
      isLoadingMore={isLoadingMore}
      hasMoreResults={hasMoreResults}
      error={error}
      onItemPress={handleItemPress}
      onLoadMore={loadMore}
      onRetry={refresh}
      crumbs={crumbs}
      onBack={() => router.back()}
      onOpenFilters={handleOpenFilters}
      activeFilterCount={activeFilterCount}
      onItemLongPress={handleItemLongPress}
      focusItemId={focusId}
    />
  );
}

export default FolderScreen;
