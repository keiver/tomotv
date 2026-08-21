/**
 * Browsing a library: user views, folder contents, and the client-side resolution of
 * user-data filters at a library view root.
 *
 * Browse and view-root filtering are one module on purpose. `isLibraryViewRoot` calls
 * `fetchUserViews`, and `fetchFolderContents` calls `fetchViewRootFiltered`, so the two
 * concerns are a genuine strongly-connected component. Splitting them would need either
 * an import cycle or a signature change.
 */
import { EMPTY_FILTERS, JellyfinFolderResponse, JellyfinItem, JellyfinVideoItem, JellyfinVideosResponse, LibraryFilters } from "@/types/jellyfin";
import { addFavoriteIds, getFavoriteIds, isFavoritesLoaded } from "@/services/favoritesCache";
import { getPlayedOverrides } from "@/services/playedCache";
import { cachedRequest } from "@/services/requestCache";
import { CACHE } from "@/constants/app";
import { logger } from "@/utils/logger";
import { retryWithBackoff } from "@/utils/retry";
import { API_TIMEOUTS, BROWSE_ITEM_TYPES, INCLUDED_LOCATION_TYPES, FOLDER_TYPE_SET, PLAYABLE_ITEM_TYPES } from "./constants";
import { filtersCacheKey } from "./cacheKeys";
import { fetchWithTimeout } from "./http";
import { fetchPlaylistContents } from "./items";
import { isAudioItem } from "./media";
import { getAuthHeader, getConfig, JellyfinConfig, throwRequestError } from "./session";

/**
 * Check if item is a folder type
 */
export function isFolder(item: JellyfinItem): boolean {
  return FOLDER_TYPE_SET.has(item.Type);
}

/**
 * Check if item is a photo (opened in the photo viewer, not the player)
 */
export function isPhoto(item: JellyfinItem): boolean {
  return item.Type === "Photo";
}

/**
 * TotalRecordCount of the media leaves under a parent. Returns undefined on any
 * failure so callers render no badge rather than a wrong number.
 *
 * MediaTypes is the only filter Jellyfin 10.11 applies correctly on recursive
 * view-root queries (verified against 10.11.1 per library type):
 * - IsFolder=false is ignored — folders get counted (a folder→folder→video library
 *   reports 3, not 1)
 * - IncludeItemTypes and Filters=IsNotFolder return TotalRecordCount 0 for
 *   music/musicvideos/photos/tvshows libraries
 * Folders have no MediaType, so they're excluded, and unsupported leaf kinds
 * (e.g. Book) are not counted — matching what the app can actually open.
 */
async function fetchMediaCount(config: JellyfinConfig, parentId: string, recursive: boolean, mediaTypes = "Video,Audio,Photo"): Promise<number | undefined> {
  const query = new URLSearchParams({
    ParentId: parentId,
    MediaTypes: mediaTypes,
    Limit: "1",
    EnableImages: "false",
    EnableUserData: "false",
    // A badge that counts episodes nobody has is a wrong badge (INCLUDED_LOCATION_TYPES).
    LocationTypes: INCLUDED_LOCATION_TYPES,
  });
  if (recursive) {
    query.append("Recursive", "true");
  }

  const url = `${config.server}/Items?userId=${config.userId}&${query.toString()}`;

  try {
    const response = await fetchWithTimeout(
      url,
      {
        method: "GET",
        headers: {
          Accept: "application/json",
          Authorization: getAuthHeader(config.deviceId, config.apiKey),
        },
      },
      API_TIMEOUTS.NORMAL,
    );

    if (!response.ok) {
      return undefined;
    }

    const data = await response.json();
    return typeof data.TotalRecordCount === "number" ? data.TotalRecordCount : undefined;
  } catch {
    return undefined;
  }
}

/** Ids of a view's direct folder children (Folder/PhotoAlbum); undefined on failure. */
async function fetchChildFolderIds(config: JellyfinConfig, parentId: string): Promise<string[] | undefined> {
  const query = new URLSearchParams({
    ParentId: parentId,
    IncludeItemTypes: "Folder,PhotoAlbum",
    EnableImages: "false",
    EnableUserData: "false",
  });

  try {
    const response = await fetchWithTimeout(
      `${config.server}/Items?userId=${config.userId}&${query.toString()}`,
      {
        method: "GET",
        headers: {
          Accept: "application/json",
          Authorization: getAuthHeader(config.deviceId, config.apiKey),
        },
      },
      API_TIMEOUTS.NORMAL,
    );

    if (!response.ok) {
      return undefined;
    }

    const data: JellyfinFolderResponse = await response.json();
    return (data.Items ?? []).map((item) => item.Id);
  } catch {
    return undefined;
  }
}

// Fallback fan-out bounds: above the cap the badge is dropped rather than hammering the
// server; within it, per-folder counts run in small batches.
const VIEW_COUNT_FOLDER_CAP = 24;
const VIEW_COUNT_BATCH = 4;

/**
 * Recursive leaf-item count for one library root, cached long per view (counts drift only
 * when the library changes). The server refuses to compute real counts for
 * CollectionFolder/UserView: their ChildCount is a random 1-9 and RecursiveItemCount is
 * never populated. This runs the same query the server's GetRecursiveChildCount uses and
 * reads TotalRecordCount. Rejects on failure so nothing caches and the next call retries.
 *
 * homevideos view roots ignore Recursive under user context on Jellyfin 10.11 (the subtree
 * query returns only physical folders regardless of filters — verified live; the system
 * context recurses fine but user tokens always resolve a user), so a 0 falls back to
 * rebuilding the count: direct leaves plus a recursive count under each direct folder
 * child, where recursion does work. A truly empty view exits the fallback with a cheap 0.
 */
export async function fetchViewItemCount(viewId: string): Promise<number> {
  const config = await getConfig();

  if (!config.server || !config.apiKey || !config.userId) {
    throw new Error("Jellyfin server not configured.");
  }

  return cachedRequest(
    `viewcount:${config.userId}:${viewId}`,
    async () => {
      const count = await resolveViewItemCount(config, viewId);
      if (count === undefined) {
        throw new Error("View item count unavailable");
      }
      return count;
    },
    CACHE.VIEW_COUNT_TTL_MS,
  );
}

async function resolveViewItemCount(config: JellyfinConfig, viewId: string): Promise<number | undefined> {
  const recursiveCount = await fetchMediaCount(config, viewId, true);
  if (recursiveCount === undefined || recursiveCount > 0) {
    return recursiveCount;
  }

  const directLeaves = await fetchMediaCount(config, viewId, false);
  if (directLeaves === undefined) {
    return undefined;
  }
  const folderIds = await fetchChildFolderIds(config, viewId);
  if (folderIds === undefined || folderIds.length > VIEW_COUNT_FOLDER_CAP) {
    return undefined;
  }
  let total = directLeaves;
  for (let start = 0; start < folderIds.length; start += VIEW_COUNT_BATCH) {
    const counts = await Promise.all(folderIds.slice(start, start + VIEW_COUNT_BATCH).map((folderId) => fetchMediaCount(config, folderId, true)));
    for (const count of counts) {
      if (count === undefined) {
        return undefined;
      }
      total += count;
    }
  }
  return total;
}

/** Which kinds of leaf a container holds. Booleans only: the counts behind them disagree. */
export interface FolderMediaKinds {
  video: boolean;
  audio: boolean;
  photo: boolean;
}

const NO_MEDIA_KINDS: FolderMediaKinds = { video: false, audio: false, photo: false };

/**
 * What a container holds, so the info panel can offer the play actions that fit it.
 *
 * A kind counts as present when EITHER the recursive or the direct count sees one.
 * Measured on 10.11.11, view roots disagree in both directions: "Home Videos and Photos"
 * answers 0 video recursively and 21 directly, while "Music Test Episode ID" answers 6
 * audio recursively and 0 directly. Neither query alone is the truth, and only presence
 * is ever read, so the union of the two is safe.
 *
 * A Playlist holds references rather than children, so it is classified from its actual
 * items via the playlist endpoint the queue builder uses.
 */
export async function fetchFolderMediaKinds(item: JellyfinItem): Promise<FolderMediaKinds> {
  const config = await getConfig();

  if (!config.server || !config.apiKey || !config.userId) {
    return NO_MEDIA_KINDS;
  }

  try {
    return await cachedRequest(
      `folderkinds:${config.userId}:${item.Id}`,
      async () => {
        if (item.Type === "Playlist") {
          const { items } = await fetchPlaylistContents(item.Id, { limit: 500 });
          return {
            video: items.some((entry) => !isPhoto(entry) && !isAudioItem(entry)),
            audio: items.some((entry) => isAudioItem(entry)),
            photo: items.some(isPhoto),
          };
        }

        const [video, audio, photo] = await Promise.all(
          (["Video", "Audio", "Photo"] as const).map(async (mediaType) => {
            const [recursive, direct] = await Promise.all([fetchMediaCount(config, item.Id, true, mediaType), fetchMediaCount(config, item.Id, false, mediaType)]);
            return (recursive ?? 0) > 0 || (direct ?? 0) > 0;
          }),
        );
        return { video, audio, photo };
      },
      CACHE.DEFAULT_TTL_MS,
    );
  } catch (error) {
    logger.warn("Failed to resolve folder media kinds", error, { service: "JellyfinAPI", itemId: item.Id });
    return NO_MEDIA_KINDS;
  }
}

/**
 * Fetch user's library views (root libraries)
 * Returns the top-level folders like "Movies", "TV Shows", etc.
 */
export async function fetchUserViews(): Promise<{ items: JellyfinItem[]; total?: number }> {
  const config = await getConfig();

  if (!config.server || !config.apiKey || !config.userId) {
    throw new Error("Jellyfin server not configured.");
  }

  const cacheKey = `views:${config.userId}`;
  return cachedRequest(
    cacheKey,
    async () => {
      const result = await retryWithBackoff(
        async () => {
          const url = `${config.server}/UserViews?userId=${config.userId}`;

          const response = await fetchWithTimeout(
            url,
            {
              method: "GET",
              headers: {
                Accept: "application/json",
                Authorization: getAuthHeader(config.deviceId, config.apiKey),
              },
            },
            API_TIMEOUTS.NORMAL,
          );

          if (!response.ok) {
            throwRequestError(response, `Failed to fetch: ${response.status}`);
          }

          const data = await response.json();
          const items = data.Items || [];
          return {
            items,
            total: items.length,
          };
        },
        { maxAttempts: 3 },
      );

      // ChildCount on views is garbage (random 1-9 from the server); strip it. The real
      // recursive count loads lazily per card (fetchViewItemCount) so this list never
      // waits on the count walk.
      const items: JellyfinItem[] = result.items.map((view: JellyfinItem) => ({ ...view, ChildCount: undefined }));

      return { items, total: result.total };
    },
    CACHE.DEFAULT_TTL_MS,
  );
}

/**
 * Append the flattened filter params for an active LibraryFilters selection to a query.
 * Shared by the paginated grid fetch (fetchFolderContents) and the full-set queue fetch
 * (fetchFilteredVideos) so the query shape can never drift between them.
 *
 * All shapes verified against a real Jellyfin 10.11 server (see CLAUDE-lessons-learned):
 * - Recursive flatten of the subtree (Jellyfin web behavior).
 * - Artist filter needs IncludeItemTypes=Audio,MusicVideo; MediaTypes silently drops ArtistIds.
 *   Otherwise MediaTypes=Video,Audio,Photo (IncludeItemTypes zeroes out music/musicvideos/
 *   photos/tvshows view-roots). Folders carry no MediaType, so the flatten excludes them.
 * - Genres is PIPE-delimited; ArtistIds, Years and status Filters are COMMA-delimited.
 * Does NOT set SortBy — the caller controls ordering.
 */
export function appendFlattenFilterParams(query: URLSearchParams, filters: LibraryFilters): void {
  query.append("Recursive", "true");

  const byArtist = filters.artistIds.length > 0;
  if (byArtist) {
    query.append("IncludeItemTypes", "Audio,MusicVideo");
  } else {
    query.append("MediaTypes", "Video,Audio,Photo");
  }

  const statusFilters = [filters.favorite && "IsFavorite", filters.played && "IsPlayed", filters.unplayed && "IsUnplayed"].filter(Boolean);
  if (statusFilters.length > 0) {
    query.append("Filters", statusFilters.join(","));
  }
  if (filters.genres.length > 0) {
    query.append("Genres", filters.genres.join("|"));
  }
  if (filters.years.length > 0) {
    query.append("Years", filters.years.join(","));
  }
  if (byArtist) {
    query.append("ArtistIds", filters.artistIds.join(","));
  }
}

/**
 * Fetch the COMPLETE filtered leaf-item set under a folder (all pages), for building a play
 * queue that covers the whole filtered library rather than only the loaded grid pages.
 *
 * Always fetched with a stable SortName order so pagination is consistent (SortBy=Random would
 * reshuffle per request and duplicate/miss items across pages). Shuffle is applied client-side
 * by the caller, giving a fresh random order on every play without a coverage gap.
 */
export async function fetchFilteredVideos(parentId: string, filters: LibraryFilters): Promise<JellyfinVideoItem[]> {
  const config = await getConfig();

  if (!config.server || !config.apiKey || !config.userId) {
    throw new Error("Jellyfin server not configured.");
  }

  // Same view-root hole as the browse (see fetchViewRootFiltered): asking a library root for
  // favorites returns nothing, which handed the player an empty queue and the photo viewer the
  // unfiltered folder. Never shuffled here — the caller owns ordering, per this function's contract.
  if (hasUserDataFilters(filters) && (await isLibraryViewRoot(parentId))) {
    return resolveViewRootMatches(config, parentId, filters, false);
  }

  const cacheKey = `filtered:${config.userId}:${parentId}:${filtersCacheKey(filters)}`;
  return cachedRequest(
    cacheKey,
    async () => {
      const PAGE_SIZE = 500;
      const allItems: JellyfinVideoItem[] = [];
      let startIndex = 0;
      let hasMore = true;

      while (hasMore) {
        const query = new URLSearchParams({
          ParentId: parentId,
          Fields: "Path,MediaStreams,Genres,ProductionYear,ImageTags,PrimaryImageAspectRatio",
          EnableUserData: "true",
          StartIndex: String(startIndex),
          Limit: String(PAGE_SIZE),
          SortBy: "SortName",
          SortOrder: "Ascending",
          // This set becomes a play queue, and a missing episode is "unplayed" to
          // every user-data filter (INCLUDED_LOCATION_TYPES).
          LocationTypes: INCLUDED_LOCATION_TYPES,
        });
        appendFlattenFilterParams(query, filters);

        const url = `${config.server}/Items?userId=${config.userId}&${query.toString()}`;

        try {
          const response = await fetchWithTimeout(
            url,
            {
              method: "GET",
              headers: {
                Accept: "application/json",
                Authorization: getAuthHeader(config.deviceId, config.apiKey),
              },
            },
            API_TIMEOUTS.EXTENDED,
          );

          if (!response.ok) {
            throwRequestError(response, `Failed to fetch filtered videos: ${response.status}`);
          }

          const data: JellyfinVideosResponse = await response.json();
          const items = data.Items || [];
          allItems.push(...items);

          const total = data.TotalRecordCount;
          startIndex += items.length;
          hasMore = items.length === PAGE_SIZE && (total === undefined || startIndex < total);
        } catch (error) {
          if (error instanceof Error && error.name === "AbortError") {
            throw new Error("Request timed out fetching filtered videos.");
          }
          throw error;
        }
      }

      // Favorite-filtered results are all favorites — seed the favorites cache so the regular
      // (unfiltered) browse can paint hearts from this same fetch without a separate request.
      if (filters.favorite) addFavoriteIds(allItems.map((item) => item.Id));

      logger.info("Fetched full filtered set for queue", { service: "JellyfinAPI", parentId, totalVideos: allItems.length });
      return allItems;
    },
    CACHE.DEFAULT_TTL_MS,
  );
}

/**
 * Collect EVERY item of a paged /Items query (500 per page) — the shared loop behind
 * the id-set and leaf-list fetchers. `buildQuery` returns the full parameter set for one page;
 * this drives StartIndex/Limit, aborts each page at API_TIMEOUTS.EXTENDED, and THROWS on any
 * failed page so a partial set is never mistaken for a complete one. `label` names the set in
 * error messages ("Failed to fetch <label>: 500" / "Request timed out fetching <label>.").
 */
async function fetchAllItemPages(config: JellyfinConfig, buildQuery: (startIndex: number, limit: number) => URLSearchParams, label: string): Promise<JellyfinItem[]> {
  const PAGE_SIZE = 500;
  const all: JellyfinItem[] = [];
  let startIndex = 0;
  let hasMore = true;

  while (hasMore) {
    // Stamped here rather than in every caller's buildQuery: this loop is the only
    // way any of them reach the server (INCLUDED_LOCATION_TYPES).
    const query = buildQuery(startIndex, PAGE_SIZE);
    query.set("LocationTypes", INCLUDED_LOCATION_TYPES);
    const url = `${config.server}/Items?userId=${config.userId}&${query.toString()}`;

    try {
      const response = await fetchWithTimeout(
        url,
        {
          method: "GET",
          headers: {
            Accept: "application/json",
            Authorization: getAuthHeader(config.deviceId, config.apiKey),
          },
        },
        API_TIMEOUTS.EXTENDED,
      );

      if (!response.ok) {
        throwRequestError(response, `Failed to fetch ${label}: ${response.status}`);
      }

      const data: JellyfinFolderResponse = await response.json();
      const items = data.Items || [];
      all.push(...items);

      const total = data.TotalRecordCount;
      startIndex += items.length;
      hasMore = items.length === PAGE_SIZE && (total === undefined || startIndex < total);
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        throw new Error(`Request timed out fetching ${label}.`);
      }
      throw error;
    }
  }

  return all;
}

/** The ids-only query shape shared by the favorite/played id-set fetchers. */
function buildIdSetQuery(startIndex: number, limit: number): URLSearchParams {
  return new URLSearchParams({
    Fields: "",
    EnableUserData: "true",
    StartIndex: String(startIndex),
    Limit: String(limit),
    SortBy: "SortName",
    SortOrder: "Ascending",
  });
}

/**
 * Load the current user's favorite leaf-item ids and seed the favorites cache. Omit `parentId` for
 * ALL favorites across every library — the authoritative set used to paint hearts. Uses the proven
 * recursive `Filters=IsFavorite` shape (reliable, unlike the non-recursive browse's per-item
 * UserData, which the server leaves stale after a change), ids-only. Not request-cached, so a
 * re-seed always reflects the live server.
 */
export async function fetchFavoriteIds(parentId?: string): Promise<Set<string>> {
  const config = await getConfig();

  if (!config.server || !config.apiKey || !config.userId) {
    throw new Error("Jellyfin server not configured.");
  }

  const items = await fetchAllItemPages(
    config,
    (startIndex, limit) => {
      const query = buildIdSetQuery(startIndex, limit);
      if (parentId) query.append("ParentId", parentId);
      appendFlattenFilterParams(query, { ...EMPTY_FILTERS, favorite: true });
      return query;
    },
    "favorite ids",
  );

  const ids = items.map((item) => item.Id);
  addFavoriteIds(ids);
  return new Set(ids);
}

/**
 * Full favorite items for the home tab's Favorites shelf, newest additions first (Jellyfin has
 * no date-favorited sort). Same recursive `Filters=IsFavorite` no-ParentId shape as
 * fetchFavoriteIds (the reliable one), plus container kinds so a favorited Series or album
 * shows as one navigable card. Deliberately uncached — a heart toggle must show on the next
 * fetch. Non-critical display data: never throws, null on failure.
 */
export async function fetchFavoriteItems(limit = 20): Promise<JellyfinItem[] | null> {
  const config = await getConfig();

  if (!config.server || !config.apiKey || !config.userId) {
    return null;
  }

  const query = new URLSearchParams({
    Recursive: "true",
    Filters: "IsFavorite",
    IncludeItemTypes: [...PLAYABLE_ITEM_TYPES, "Series", "MusicAlbum", "BoxSet"].join(","),
    Fields: "Path,MediaStreams,Genres,ProductionYear,ParentId,ImageTags,PrimaryImageAspectRatio",
    EnableUserData: "true",
    Limit: String(limit),
    SortBy: "DateCreated",
    SortOrder: "Descending",
    LocationTypes: INCLUDED_LOCATION_TYPES,
  });

  try {
    const response = await fetchWithTimeout(
      `${config.server}/Items?userId=${config.userId}&${query.toString()}`,
      {
        method: "GET",
        headers: {
          Accept: "application/json",
          Authorization: getAuthHeader(config.deviceId, config.apiKey),
        },
      },
      API_TIMEOUTS.QUICK,
    );

    if (!response.ok) {
      throwRequestError(response, `Failed to fetch favorite items: ${response.status}`);
    }

    const data: JellyfinFolderResponse = await response.json();
    return data.Items ?? [];
  } catch (error) {
    logger.warn("Failed to fetch favorite items", error, { service: "JellyfinAPI" });
    return null;
  }
}

/**
 * Is this id one of the user's library roots (the CollectionFolder /UserViews returns)?
 * Cached with the views themselves, so this costs nothing after the first browse. Failures
 * answer false: the caller then takes the normal server-side path, which is the status quo.
 */
async function isLibraryViewRoot(parentId: string): Promise<boolean> {
  try {
    const views = await fetchUserViews();
    return views.items.some((view) => view.Id === parentId);
  } catch {
    return false;
  }
}

/** Filters the server can answer at a view root — everything except the user-data ones. */
function withoutUserDataFilters(filters: LibraryFilters): LibraryFilters {
  return { ...filters, favorite: false, played: false, unplayed: false };
}

/**
 * Every leaf under a library view root, all pages. No user-data filters: those are applied
 * client-side by the caller, because the server can't answer them here (see fetchViewRootFiltered).
 */
async function fetchViewRootLeaves(config: JellyfinConfig, parentId: string, filters: LibraryFilters): Promise<JellyfinItem[]> {
  const base = withoutUserDataFilters(filters);
  // Shuffle is applied after matching, never in this query — it must not fork the cache key.
  const cacheKey = `viewLeaves:${config.userId}:${parentId}:${filtersCacheKey({ ...base, shuffle: false })}`;
  return cachedRequest(
    cacheKey,
    () =>
      fetchAllItemPages(
        config,
        (startIndex, limit) => {
          const query = new URLSearchParams({
            ParentId: parentId,
            Fields: "Path,MediaStreams,Genres,ChildCount,RecursiveItemCount,ParentId,ImageTags,PrimaryImageAspectRatio",
            EnableUserData: "true",
            StartIndex: String(startIndex),
            Limit: String(limit),
            SortBy: "SortName",
            SortOrder: "Ascending",
          });
          appendFlattenFilterParams(query, base);
          return query;
        },
        "library leaves",
      ),
    CACHE.DEFAULT_TTL_MS,
  );
}

/**
 * The current user's played leaf-item ids, from the shape that is known to work: recursive,
 * NO ParentId, Filters=IsPlayed. The mirror of fetchFavoriteIds, and used the same way — as the
 * authoritative set the view-root browse intersects against.
 */
async function fetchPlayedIds(config: JellyfinConfig): Promise<Set<string>> {
  const cacheKey = `playedIds:${config.userId}`;
  const ids = await cachedRequest(
    cacheKey,
    async () => {
      const items = await fetchAllItemPages(
        config,
        (startIndex, limit) => {
          const query = buildIdSetQuery(startIndex, limit);
          appendFlattenFilterParams(query, { ...EMPTY_FILTERS, played: true });
          return query;
        },
        "played ids",
      );
      return items.map((item) => item.Id);
    },
    CACHE.DEFAULT_TTL_MS,
  );

  return new Set(ids);
}

/**
 * Filtered browse rooted at a LIBRARY VIEW ROOT, for the filters the server refuses to answer there.
 *
 * Verified against 10.11.1 on a photos library: `ParentId=<view root>&Recursive&MediaTypes=…` returns
 * all 65 leaves but with EMPTY user data (0 of 65 report IsFavorite, though 6 of them are favorites),
 * and adding `Filters=IsFavorite` returns 0 items — while the identical query with NO ParentId returns
 * those 6 favorites. Recursive view-root queries go through Jellyfin's per-collection-type view builder,
 * which drops user data and ignores ItemFilter, so IsFavorite/IsPlayed/IsUnplayed can never match there.
 * Same family as the IncludeItemTypes note on fetchViewItemCount.
 *
 * So: take the membership from the query that works (leaves under the root) and the user state from the
 * query that works (the root-scoped id sets), and intersect. Ordering and paging then happen here, on a
 * complete set, so TotalRecordCount is exact.
 *
 * NOT covered: an artist filter at a view root still rides IncludeItemTypes (appendFlattenFilterParams
 * needs it — MediaTypes silently drops ArtistIds), which is the param that zeroes out here. Unverified
 * and left alone.
 */
async function resolveViewRootMatches(config: JellyfinConfig, parentId: string, filters: LibraryFilters, shuffle: boolean): Promise<JellyfinItem[]> {
  // BOTH sets, whichever filter is on: they decide what matches AND what the cards render, so a
  // favourites-only view still needs the played set to keep checkmarks, and vice versa. Both are
  // cached (the favourites one app-wide, already loaded for the hearts on the unfiltered browse).
  // Every fetch here THROWS on failure: swallowing one would render "No items match" over a
  // transient error, and the caller's error state (with retry) is the honest answer.
  const [leaves, playedIds] = await Promise.all([fetchViewRootLeaves(config, parentId, filters), fetchPlayedIds(config), isFavoritesLoaded() ? Promise.resolve() : fetchFavoriteIds()]);

  const favoriteIds = getFavoriteIds();
  const playedOverrides = getPlayedOverrides();
  const isPlayed = (item: JellyfinItem) => playedOverrides.get(item.Id) ?? playedIds.has(item.Id);

  // Stamp the state we just resolved onto the items. The view root returned them with EMPTY
  // UserData, so without this the grid paints no heart and no checkmark, and the long-press
  // sheet offers "Mark as Favorite" on an item that already IS one (toggling the wrong way).
  // Downstream is untouched: useFolderContents leaves a filtered view's UserData alone.
  let matched = leaves
    .filter((item) => {
      if (filters.favorite && !favoriteIds.has(item.Id)) return false;
      if (filters.played && !isPlayed(item)) return false;
      if (filters.unplayed && isPlayed(item)) return false;
      return true;
    })
    .map((item) => ({ ...item, UserData: { ...item.UserData, IsFavorite: favoriteIds.has(item.Id), Played: isPlayed(item) } }));

  // Shuffle is a sort, and the server-side SortBy=Random this path can't use would reshuffle per
  // page anyway; one shuffle of the complete set gives a stable order for the whole scroll.
  if (shuffle) {
    matched = [...matched];
    for (let i = matched.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [matched[i], matched[j]] = [matched[j], matched[i]];
    }
  }

  logger.debug("View-root filtered set resolved client-side", {
    service: "JellyfinAPI",
    parentId,
    leaves: leaves.length,
    matched: matched.length,
    filters: { favorite: filters.favorite, played: filters.played, unplayed: filters.unplayed },
  });

  return matched;
}

/** True when this selection asks for state the server won't report at a library root. */
function hasUserDataFilters(filters?: LibraryFilters): boolean {
  return !!filters && (filters.favorite || filters.played || filters.unplayed);
}

/** One page of the view-root resolution, with an exact total (the whole set is in hand). */
async function fetchViewRootFiltered(config: JellyfinConfig, parentId: string, filters: LibraryFilters, startIndex: number, limit: number): Promise<{ items: JellyfinItem[]; total?: number }> {
  const matched = await resolveViewRootMatches(config, parentId, filters, filters.shuffle);
  return { items: matched.slice(startIndex, startIndex + limit), total: matched.length };
}

/**
 * Fetch contents of a folder by ParentId
 * Returns direct children only (folders and videos)
 *
 * @param parentId - The folder ID to fetch contents for (null for root views)
 * @param options - Pagination options
 */
export async function fetchFolderContents(
  parentId: string | null,
  { limit = 60, startIndex = 0, filters }: { limit?: number; startIndex?: number; filters?: LibraryFilters } = {},
): Promise<{ items: JellyfinItem[]; total?: number }> {
  // If no parentId, return user views (root level)
  if (!parentId) {
    return fetchUserViews();
  }

  const config = await getConfig();

  if (!config.server || !config.apiKey || !config.userId) {
    throw new Error("Jellyfin server not configured.");
  }

  // Shuffle is a sort, not a content filter: it must not flip the browse to a recursive flatten on
  // its own (that would flatten a nested library just by randomizing it). Only real content filters
  // trigger the flatten; shuffle only swaps SortBy on whichever path we take.
  const hasContentFilters = !!filters && (filters.favorite || filters.played || filters.unplayed || filters.genres.length > 0 || filters.artistIds.length > 0 || filters.years.length > 0);
  const shuffle = !!filters && filters.shuffle;

  // A library root can't answer user-data filters — it returns items with no user data at all, so
  // Filters=IsFavorite/IsPlayed/IsUnplayed match nothing and the grid reads "No items match the
  // current filters" over a library full of favorites. Resolve those here instead.
  if (filters && hasUserDataFilters(filters) && (await isLibraryViewRoot(parentId))) {
    return fetchViewRootFiltered(config, parentId, filters, startIndex, limit);
  }

  const cacheKey = `folder:${config.userId}:${parentId}:${startIndex}:${limit}:${filtersCacheKey(filters)}`;
  return cachedRequest(
    cacheKey,
    () =>
      retryWithBackoff(
        async () => {
          const query = new URLSearchParams({
            ParentId: parentId,
            Fields: "Path,MediaStreams,Genres,ChildCount,RecursiveItemCount,ParentId,ImageTags,PrimaryImageAspectRatio",
            EnableUserData: "true",
            StartIndex: String(startIndex),
            Limit: String(limit),
            SortBy: shuffle ? "Random" : "SortName",
            SortOrder: "Ascending",
            // The browse the user actually looks at. Without this a four-season show
            // lists eight folders, four of them empty (INCLUDED_LOCATION_TYPES).
            LocationTypes: INCLUDED_LOCATION_TYPES,
          });

          if (hasContentFilters) {
            appendFlattenFilterParams(query, filters!);
          } else {
            // Non-recursive browse keeps the strict kind allowlist (the issue #46 fix).
            query.append("IncludeItemTypes", BROWSE_ITEM_TYPES);
          }

          const url = `${config.server}/Items?userId=${config.userId}&${query.toString()}`;

          const response = await fetchWithTimeout(
            url,
            {
              method: "GET",
              headers: {
                Accept: "application/json",
                Authorization: getAuthHeader(config.deviceId, config.apiKey),
              },
            },
            API_TIMEOUTS.EXTENDED,
          );

          if (!response.ok) {
            throwRequestError(response, `Failed to fetch folder contents: ${response.status}`);
          }

          const data: JellyfinFolderResponse = await response.json();
          const items = data.Items || [];
          // When the Favorite filter is on, every returned item is a favorite — seed the cache so the
          // regular browse can reuse these ids for hearts without a separate fetch.
          if (filters?.favorite) addFavoriteIds(items.map((item) => item.Id));
          return {
            items,
            total: data.TotalRecordCount,
          };
        },
        { maxAttempts: 3 },
      ),
    CACHE.DEFAULT_TTL_MS,
  );
}
