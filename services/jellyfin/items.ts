/**
 * Reads that return items rather than a browse tree: one item's details, a flat library
 * page, a playlist, an explicit id list, and the recursive leaf sweep used to build a
 * play queue.
 *
 * Depends on library.ts (for `isFolder` and the filter query builder) but never the other
 * way round, so the pair stays acyclic.
 */
import { FolderStackEntry, JellyfinFolderResponse, JellyfinItem, JellyfinMediaStream, JellyfinVideoItem, JellyfinVideosResponse } from "@/types/jellyfin";
import { cachedRequest } from "@/services/requestCache";
import { CACHE } from "@/constants/app";
import { downloadedItem } from "@/services/downloads/localSource";
import { logger } from "@/utils/logger";
import { retryWithBackoff } from "@/utils/retry";
import { API_TIMEOUTS, INCLUDED_LOCATION_TYPES, PLAYABLE_ITEM_TYPES, STANDALONE_VIDEO_TYPES } from "./constants";
import { fetchWithTimeout } from "./http";
import { getAuthHeader, getConfig, JellyfinConfig, throwRequestError } from "./session";

/**
 * Fetch primary library/view name from Jellyfin
 * Returns the first Movie/Video library name found
 */
export async function fetchLibraryName(): Promise<string> {
  try {
    const config = await getConfig();

    if (!config.server || !config.apiKey || !config.userId) {
      return "LIBRARY";
    }

    return await retryWithBackoff(
      async () => {
        const url = `${config.server}/UserViews?userId=${config.userId}`;

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
            API_TIMEOUTS.QUICK,
          );

          if (!response.ok) {
            logger.warn("Failed to fetch library name", {
              service: "JellyfinAPI",
              status: response.status,
            });
            return "LIBRARY";
          }

          const data = (await response.json()) as JellyfinFolderResponse;

          // Debug: log the response
          logger.debug("Jellyfin Views response", {
            service: "JellyfinAPI",
            itemsCount: data.Items?.length || 0,
            items: data.Items?.map((item) => ({
              name: item.Name,
              collectionType: item.CollectionType,
            })),
          });

          // Find first Movie or mixed collection, or just any library with content
          let library = data.Items?.find((item) => item.CollectionType === "movies" || item.CollectionType === "mixed");

          // If no movie/mixed library, just use the first one
          if (!library && data.Items && data.Items.length > 0) {
            library = data.Items[0];
            logger.debug("Using first available library", {
              service: "JellyfinAPI",
              name: library.Name,
              collectionType: library.CollectionType,
            });
          }

          if (library) {
            logger.debug("Found library", {
              service: "JellyfinAPI",
              name: library.Name,
              collectionType: library.CollectionType,
            });
          } else {
            logger.warn("No libraries found", {
              service: "JellyfinAPI",
            });
          }

          return library?.Name || "LIBRARY";
        } catch (error) {
          logger.warn("Error fetching library name", error, {
            service: "JellyfinAPI",
          });
          return "LIBRARY";
        }
      },
      { maxAttempts: 2 },
    );
  } catch (error) {
    logger.warn("Error fetching library name", error, {
      service: "JellyfinAPI",
    });
    return "LIBRARY";
  }
}

/**
 * Fetch library videos with pagination support
 * Use this for incremental loading with infinite scroll
 */
export async function fetchLibraryVideos({ limit = 60, startIndex = 0 }: { limit?: number; startIndex?: number } = {}): Promise<{ items: JellyfinVideoItem[]; total?: number }> {
  const config = await getConfig();

  if (!config.server || !config.apiKey || !config.userId) {
    logger.error("Jellyfin server not configured", {
      service: "JellyfinAPI",
      hasServer: !!config.server,
      hasApiKey: !!config.apiKey,
      hasUserId: !!config.userId,
      server: config.server || "not set",
    });
    throw new Error("Jellyfin server not configured. Please go to Settings and configure your server connection.");
  }

  logger.debug("Fetching library videos", {
    service: "JellyfinAPI",
    server: config.server,
    limit,
    startIndex,
  });

  return retryWithBackoff(
    async () =>
      requestLibraryItems(config, {
        startIndex,
        limit,
        timeoutMs: 30000,
      }),
    { maxAttempts: 3 },
  );
}

/**
 * Fetch contents of a playlist using the playlist-specific endpoint
 * Playlists require a different API endpoint than regular folders
 *
 * @param playlistId - The playlist ID to fetch contents for
 * @param options - Pagination options
 */
export async function fetchPlaylistContents(playlistId: string, { limit = 60, startIndex = 0 }: { limit?: number; startIndex?: number } = {}): Promise<{ items: JellyfinItem[]; total?: number }> {
  const config = await getConfig();

  if (!config.server || !config.apiKey || !config.userId) {
    throw new Error("Jellyfin server not configured.");
  }

  const cacheKey = `playlist:${config.userId}:${playlistId}:${startIndex}:${limit}`;
  return cachedRequest(
    cacheKey,
    () =>
      retryWithBackoff(
        async () => {
          const query = new URLSearchParams({
            userId: config.userId!,
            StartIndex: String(startIndex),
            Limit: String(limit),
            Fields: "Path,MediaStreams,Genres,ChildCount,RecursiveItemCount,ParentId,ImageTags,PrimaryImageAspectRatio",
            EnableUserData: "true",
          });

          const url = `${config.server}/Playlists/${playlistId}/Items?${query.toString()}`;

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
            throwRequestError(response, `Failed to fetch playlist contents: ${response.status}`);
          }

          const data: JellyfinFolderResponse = await response.json();
          const items = data.Items || [];

          // Debug logging to diagnose playlist item structure
          logger.debug("Playlist contents fetched", {
            service: "JellyfinAPI",
            playlistId,
            itemCount: items.length,
            firstItemId: items[0]?.Id,
            firstItemName: items[0]?.Name,
            firstItemType: items[0]?.Type,
          });

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

/**
 * Fetch full metadata for a set of item IDs in a single request.
 * Used to hydrate the locally-tracked Continue Watching list (which stores only
 * playback position, not titles/posters). Items missing from the response
 * (deleted on the server) are dropped, and the result is re-ordered to match
 * the input `ids` so caller-supplied ordering (e.g. most-recent-first) survives.
 */
export async function fetchItemsByIds(ids: string[]): Promise<JellyfinVideoItem[]> {
  if (ids.length === 0) {
    return [];
  }

  const config = await getConfig();

  if (!config.server || !config.apiKey || !config.userId) {
    throw new Error("Jellyfin server not configured.");
  }

  const cacheKey = `items:${config.userId}:${ids.join(",")}`;
  return cachedRequest(
    cacheKey,
    () =>
      retryWithBackoff(
        async () => {
          const query = new URLSearchParams({
            Ids: ids.join(","),
            Recursive: "true",
            Fields: "Path,MediaStreams,Genres,ProductionYear,ImageTags,PrimaryImageAspectRatio",
            EnableUserData: "true",
          });

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
            API_TIMEOUTS.NORMAL,
          );

          if (!response.ok) {
            throwRequestError(response, `Failed to fetch items by ids: ${response.status}`);
          }

          const data: JellyfinVideosResponse = await response.json();
          const byId = new Map((data.Items || []).map((item) => [item.Id, item]));

          // Preserve caller order; silently drop ids the server no longer knows.
          return ids.map((id) => byId.get(id)).filter((item): item is JellyfinVideoItem => item !== undefined);
        },
        { maxAttempts: 3 },
      ),
    CACHE.DEFAULT_TTL_MS,
  );
}

/** The library a browse path starts at. Included in the path, then the walk stops. */
const LIBRARY_ROOT_TYPES = new Set(["CollectionFolder", "UserView"]);
/** The server's own containers above a library. The app never shows them. */
const SERVER_ROOT_TYPES = new Set(["UserRootFolder", "AggregateFolder"]);
/** Depth cap for the ancestor walk — a real library path is two to four levels. */
const MAX_PATH_DEPTH = 10;

/**
 * The browse path from an item's library root down to its immediate parent folder — the
 * `crumbs` shape the folder route takes, so a caller can push straight to where an item
 * lives with a full breadcrumb (used by "Show In Folder" on a Continue Watching card).
 *
 * GET /Items/{id}/Ancestors answers nearest-parent-first and walks up to the server root
 * (verified in Jellyfin's LibraryController.GetAncestors: a `while (parent is not null)`
 * loop appending each parent in turn). It takes no Fields parameter — the DTOs come back
 * with default options — so the chain is read off that ORDER, never off ParentId, which
 * is Fields-gated and absent here.
 *
 * The same loop translates the physical folder under the server root into the user's own
 * CollectionFolder, which is exactly what the library grid lists, so it becomes crumbs[0].
 * Everything above it is dropped. Returns [] on any failure — the caller decides what an
 * unresolvable path means.
 */
export async function fetchItemFolderPath(itemId: string): Promise<FolderStackEntry[]> {
  const config = await getConfig();

  if (!config.server || !config.apiKey || !config.userId) {
    return [];
  }

  const cacheKey = `ancestors:${config.userId}:${itemId}`;
  try {
    return await cachedRequest(
      cacheKey,
      async () => {
        const url = `${config.server}/Items/${itemId}/Ancestors?userId=${config.userId}`;

        const response = await fetchWithTimeout(
          url,
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
          throwRequestError(response, `Failed to fetch item ancestors: ${response.status}`);
        }

        const ancestors = ((await response.json()) ?? []) as JellyfinItem[];

        const path: FolderStackEntry[] = [];
        for (const ancestor of ancestors.slice(0, MAX_PATH_DEPTH)) {
          if (SERVER_ROOT_TYPES.has(ancestor.Type)) break;
          path.push({ id: ancestor.Id, name: ancestor.Name, type: ancestor.Type === "Playlist" ? "playlist" : "folder" });
          if (LIBRARY_ROOT_TYPES.has(ancestor.Type)) break;
        }

        // Nearest-first on the wire, outermost-first in a breadcrumb.
        return path.reverse();
      },
      CACHE.DEFAULT_TTL_MS,
    );
  } catch (error) {
    logger.warn("Failed to fetch item ancestors", error, { service: "JellyfinAPI", itemId });
    return [];
  }
}

export async function requestLibraryItems(
  config: JellyfinConfig,
  {
    startIndex = 0,
    limit = 200,
    searchTerm,
    years,
    genres,
    artistIds,
    includeAllTypes = false,
    includeSeries = false,
    timeoutMs = 30000,
  }: {
    startIndex?: number;
    limit?: number;
    searchTerm?: string;
    years?: number[];
    genres?: string[];
    artistIds?: string[];
    includeAllTypes?: boolean;
    includeSeries?: boolean;
    timeoutMs?: number;
  },
): Promise<{ items: JellyfinVideoItem[]; total?: number }> {
  // includeAllTypes (search): every playable kind across all libraries.
  // Default (flat library list): standalone videos only.
  // Series: only when includeSeries=true (expanded to episodes by the caller).
  // Photos are excluded from both paths — they only surface via folder browsing.
  // See the BaseItemKind allowlists next to isFolder() for the full picture.
  let itemTypes: string = includeAllTypes ? PLAYABLE_ITEM_TYPES.join(",") : STANDALONE_VIDEO_TYPES.join(",");
  if (includeSeries) {
    itemTypes += ",Series";
  }
  // ArtistIds is honored only with IncludeItemTypes=Audio,MusicVideo — the server silently
  // drops it otherwise (see appendFlattenFilterParams)
  if (artistIds && artistIds.length > 0) {
    itemTypes = "Audio,MusicVideo";
  }

  const query = new URLSearchParams({
    Recursive: "true",
    IncludeItemTypes: itemTypes,
    Fields: "Path,MediaStreams,Genres,ProductionYear,ImageTags,PrimaryImageAspectRatio",
    StartIndex: String(startIndex),
    Limit: String(limit),
    SortBy: "DateCreated",
    SortOrder: "Descending",
    // Newest-first over a whole library: unaired episodes sort to the very top,
    // which is the worst possible place for them (INCLUDED_LOCATION_TYPES).
    LocationTypes: INCLUDED_LOCATION_TYPES,
  });

  if (searchTerm) {
    query.append("SearchTerm", searchTerm);
  }

  if (years && years.length > 0) {
    query.append("Years", years.join(","));
  }

  // Verified shapes: Genres is PIPE-delimited, ArtistIds COMMA-delimited (see the
  // appendFlattenFilterParams comment)
  if (genres && genres.length > 0) {
    query.append("Genres", genres.join("|"));
  }

  if (artistIds && artistIds.length > 0) {
    query.append("ArtistIds", artistIds.join(","));
  }

  const url = `${config.server}/Items?userId=${config.userId}&${query.toString()}`;

  logger.debug("Requesting library items", {
    service: "JellyfinAPI",
    url,
    server: config.server,
    userId: config.userId,
  });

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
      timeoutMs,
    );

    if (!response.ok) {
      logger.error("Failed to fetch videos", {
        service: "JellyfinAPI",
        status: response.status,
        statusText: response.statusText,
        url,
      });
      throwRequestError(response, `Failed to fetch videos: ${response.status} ${response.statusText}`);
    }

    const data: JellyfinVideosResponse = await response.json();
    return {
      items: data.Items || [],
      total: data.TotalRecordCount,
    };
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error("Request timed out. Please check your network connection and Jellyfin server.");
    }
    throw error;
  }
}

/**
 * Fetch detailed video item information including media streams.
 *
 * Throws on failure rather than returning null. It used to swallow everything
 * into a null, which the player then reported as "Video not found or
 * unavailable" whether the server had answered 401, 404, 500 or nothing at all.
 * That single message cost a whole debugging session: 55 regression items
 * failed identically while the real cause was that the app was signed in to a
 * different server than the harness was resolving ids from, and the status that
 * would have said so was discarded here. Both callers already catch.
 */
export async function fetchVideoDetails(itemId: string): Promise<JellyfinVideoItem | null> {
  // A held item is answered off the disk, without touching the network at all. It carries the
  // payload this endpoint returned when it was downloaded, MediaSources and MediaStreams
  // included, and its media is a local file. Asking the server first cost 48 seconds with no
  // route to it: three 15s timeouts and two backoffs, to play something already on the device.
  const held = downloadedItem(itemId);
  if (held) return held;

  try {
    const config = await getConfig();

    // Cached per item (invalidated on favorite / playback changes). The retry closure throws on
    // failure, so the outer catch — not the cache — supplies the null fallback.
    const cacheKey = `details:${config.userId}:${itemId}`;
    return await cachedRequest(
      cacheKey,
      () =>
        retryWithBackoff(
          async () => {
            // Use GetPlaybackInfo endpoint for reliable MediaStreams data
            const url = `${config.server}/Items/${itemId}/PlaybackInfo?UserId=${config.userId}`;

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
                throwRequestError(response, `Failed to fetch video details: ${response.status} ${response.statusText}`);
              }

              const playbackInfoResponse = await response.json();

              // Extract MediaSources from PlaybackInfoResponse
              const mediaSource = playbackInfoResponse.MediaSources?.[0];

              if (!mediaSource) {
                throw new Error("No media sources available for this video");
              }

              // Construct a JellyfinVideoItem-compatible object from the playback info
              // We still need basic item metadata, so fetch it separately
              // EnableUserData populates UserData.PlaybackPositionTicks for server-side resume
              const itemUrl = `${config.server}/Items/${itemId}?userId=${config.userId}&Fields=Path,Overview,Genres,Taglines,People,Studios&EnableUserData=true`;
              // Its own timeout, not a continuation of the first: the PlaybackInfo timer is
              // already spent by here, so without this a hung server stalls the player at
              // FETCHING_METADATA forever.
              const itemResponse = await fetchWithTimeout(
                itemUrl,
                {
                  method: "GET",
                  headers: {
                    Accept: "application/json",
                    Authorization: getAuthHeader(config.deviceId, config.apiKey),
                  },
                },
                API_TIMEOUTS.NORMAL,
              );

              if (!itemResponse.ok) {
                throw new Error(`Failed to fetch item metadata: ${itemResponse.status}`);
              }

              const itemData = await itemResponse.json();

              // Merge item metadata with MediaSources from PlaybackInfo
              const data: JellyfinVideoItem = {
                ...itemData,
                MediaSources: playbackInfoResponse.MediaSources,
                MediaStreams: mediaSource.MediaStreams || [],
              };

              // Debug logging to help diagnose multi-audio track issues
              const audioStreams = mediaSource.MediaStreams?.filter((s: JellyfinMediaStream) => s.Type === "Audio") || [];

              logger.info("Video details fetched via PlaybackInfo endpoint", {
                service: "JellyfinAPI",
                itemId: data.Id,
                name: data.Name,
                type: data.Type,
                hasMediaSources: !!data.MediaSources,
                mediaSourceCount: data.MediaSources?.length || 0,
                mediaSourceId: mediaSource.Id,
                hasMediaStreams: !!mediaSource.MediaStreams,
                mediaStreamCount: mediaSource.MediaStreams?.length || 0,
                audioTrackCount: audioStreams.length,
                audioTracks: audioStreams.map((s: JellyfinMediaStream) => ({
                  index: s.Index,
                  language: s.Language || "und",
                  codec: s.Codec,
                  channels: s.Channels,
                  displayTitle: s.DisplayTitle,
                })),
              });

              return data;
            } catch (error) {
              if (error instanceof Error && error.name === "AbortError") {
                throw new Error("Request timed out. Please check your network connection.");
              }
              throw error;
            }
          },
          { maxAttempts: 3 },
        ),
      CACHE.DEFAULT_TTL_MS,
    );
  } catch (error) {
    logger.error("Error fetching video details from Jellyfin", error, {
      service: "JellyfinAPI",
      itemId,
    });
    throw error;
  }
}

/**
 * Everything known about one item, playable or not — the info panel's fetch.
 *
 * Metadata first, sources second, which is the whole difference from
 * fetchVideoDetails: `/Items/{id}` answers for every kind the app lists, where
 * `/Items/{id}/PlaybackInfo` returns 500 for Photo and Series (probed against
 * 10.11.11). Leading with PlaybackInfo therefore cost those kinds three
 * retried round trips and left the panel with nothing to show.
 *
 * Sources are an enrichment for the kinds that have them: the stream sections
 * and the predicted lane need MediaStreams, and losing them must not cost the
 * panel the title, artwork and file line it already holds.
 *
 * Returns the folder-aware JellyfinItem: the panel is reached from folder cards
 * too, and their child counts are part of what it shows.
 *
 * Cache key extends the `details:` prefix so the existing user-data evictions
 * (see cacheKeys.ts) drop this entry too.
 */
export async function fetchItemDetails(itemId: string): Promise<JellyfinItem | null> {
  const config = await getConfig();
  const authHeaders = { Accept: "application/json", Authorization: getAuthHeader(config.deviceId, config.apiKey) };

  return cachedRequest(
    `details:${config.userId}:${itemId}:info`,
    () =>
      retryWithBackoff(
        async () => {
          // Chapters ride the item rather than an endpoint of their own, and they
          // feed the tvOS chapter list in AVKit's info panel (player-host.tsx).
          //
          // Asked for explicitly even though it is not always needed: measured
          // against Jellyfin 10.11 this single-item endpoint returns Chapters
          // whether or not the field is listed. Chapters IS a documented
          // ItemFields value, the list endpoints do honour it, and naming it
          // costs nothing, so this stays rather than resting on one server
          // version's habit of sending it anyway.
          const url = `${config.server}/Items/${itemId}?userId=${config.userId}&Fields=Path,Overview,Genres,Taglines,People,Studios,Chapters&EnableUserData=true`;
          const response = await fetchWithTimeout(url, { method: "GET", headers: authHeaders }, API_TIMEOUTS.NORMAL);
          if (!response.ok) {
            throwRequestError(response, `Failed to fetch item details: ${response.status} ${response.statusText}`);
          }
          const item: JellyfinItem = await response.json();
          if (!PLAYABLE_ITEM_TYPES.includes(item.Type as (typeof PLAYABLE_ITEM_TYPES)[number])) return item;

          try {
            // Its own timeout: the metadata timer is already spent by here.
            const playbackResponse = await fetchWithTimeout(`${config.server}/Items/${itemId}/PlaybackInfo?UserId=${config.userId}`, { method: "GET", headers: authHeaders }, API_TIMEOUTS.NORMAL);
            if (!playbackResponse.ok) throw new Error(`PlaybackInfo ${playbackResponse.status}`);
            const playbackInfo = await playbackResponse.json();
            const source = playbackInfo.MediaSources?.[0];
            if (!source) return item;
            return { ...item, MediaSources: playbackInfo.MediaSources, MediaStreams: source.MediaStreams || [] };
          } catch (error) {
            logger.warn("Item details: no media sources, metadata only", error, { service: "JellyfinAPI", itemId, type: item.Type });
            return item;
          }
        },
        { maxAttempts: 3 },
      ),
    CACHE.DEFAULT_TTL_MS,
  );
}

/**
 * Every leaf of one MediaTypes selection under a folder, paged 500 at a time and sorted by
 * SortName for natural folder order.
 *
 * MediaTypes, NOT IncludeItemTypes: the kind allowlist returns zero on a recursive query
 * rooted at a library VIEW ROOT (verified 10.11.1, "Photos Tomo TV" answered totalVideos:0
 * while the same subtree holds 60 leaves), which left every library-root press with an empty
 * binge queue. Folders carry no MediaType, so they stay excluded either way.
 *
 * Falls back to the parent's DIRECT children when the recursive sweep finds nothing.
 * A `homevideos` library root lists its videos but does not own them — measured on
 * 10.11.11, `ee75511a…` ("Home Videos and Photos") answers 21 videos non-recursively
 * and zero recursively, because those files resolve through a different library
 * (`/Items/{id}/Ancestors` on one of them walks to the Movies collection). Every video
 * opened from such a root therefore built an empty queue and showed no Up Next. The
 * direct children are what the grid displayed, so they are the honest queue for it.
 */
async function fetchRecursiveLeaves(config: JellyfinConfig, parentId: string, mediaTypes: string, extraFields = ""): Promise<JellyfinVideoItem[]> {
  const PAGE_SIZE = 500;

  const fetchPages = async (recursive: boolean): Promise<JellyfinVideoItem[]> => {
    const allItems: JellyfinVideoItem[] = [];
    let startIndex = 0;
    let hasMore = true;

    while (hasMore) {
      const query = new URLSearchParams({
        ParentId: parentId,
        ...(recursive ? { Recursive: "true" } : {}),
        MediaTypes: mediaTypes,
        Fields: `Path,MediaStreams,Genres,ProductionYear,ParentId,ImageTags,PrimaryImageAspectRatio${extraFields}`,
        EnableUserData: "true",
        StartIndex: String(startIndex),
        Limit: String(PAGE_SIZE),
        SortBy: "SortName",
        SortOrder: "Ascending",
        // Binge queue: an item with no file is a dead entry the player would open
        // and fail on (INCLUDED_LOCATION_TYPES).
        LocationTypes: INCLUDED_LOCATION_TYPES,
      });

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
          throwRequestError(response, `Failed to fetch recursive items: ${response.status}`);
        }

        const data: JellyfinVideosResponse = await response.json();
        const items = data.Items || [];
        allItems.push(...items);

        const total = data.TotalRecordCount;
        startIndex += items.length;
        hasMore = items.length === PAGE_SIZE && (total === undefined || startIndex < total);
      } catch (error) {
        if (error instanceof Error && error.name === "AbortError") {
          throw new Error("Request timed out fetching recursive items.");
        }
        throw error;
      }
    }

    return allItems;
  };

  let allItems = await fetchPages(true);
  const recursiveWasEmpty = allItems.length === 0;
  if (recursiveWasEmpty) {
    allItems = await fetchPages(false);
  }

  logger.info("Fetched recursive leaves", {
    service: "JellyfinAPI",
    parentId,
    mediaTypes,
    total: allItems.length,
    ...(recursiveWasEmpty ? { source: "direct children (recursive sweep was empty)" } : {}),
  });

  return allItems;
}

/**
 * Every entry of a playlist, paged until the server runs out.
 *
 * One cache key for the whole sweep rather than fetchPlaylistContents' per-page key, so the
 * info panel's classification pass and the queue built after it share a single fetch. A failed
 * page throws: a partial playlist that plays is worse than one that reports an error.
 */
export async function fetchAllPlaylistItems(playlistId: string): Promise<JellyfinItem[]> {
  const config = await getConfig();

  if (!config.server || !config.apiKey || !config.userId) {
    throw new Error("Jellyfin server not configured.");
  }

  return cachedRequest(
    `playlistAll:${config.userId}:${playlistId}`,
    async () => {
      const PAGE_SIZE = 500;
      const all: JellyfinItem[] = [];
      let startIndex = 0;
      let hasMore = true;

      while (hasMore) {
        const { items, total } = await fetchPlaylistContents(playlistId, { limit: PAGE_SIZE, startIndex });
        all.push(...items);
        startIndex += items.length;
        hasMore = items.length === PAGE_SIZE && (total === undefined || startIndex < total);
      }

      return all;
    },
    CACHE.DEFAULT_TTL_MS,
  );
}

/**
 * Every playable item under a folder, for the play queue.
 *
 * Video,Audio covers exactly PLAYABLE_ITEM_TYPES (Photos are MediaType Photo). Carries
 * UserData and image fields: the Continue Watching row resolves its next-up card from this
 * same list (services/nextUp.ts), so it needs played/resume state and image tags.
 */
export async function fetchRecursiveVideos(parentId: string): Promise<JellyfinVideoItem[]> {
  const config = await getConfig();

  if (!config.server || !config.apiKey || !config.userId) {
    throw new Error("Jellyfin server not configured.");
  }

  return cachedRequest(`recursive:${config.userId}:${parentId}`, () => fetchRecursiveLeaves(config, parentId, "Video,Audio"), CACHE.DEFAULT_TTL_MS);
}

/**
 * Every playable item under a folder, carrying MediaSources so each one's size and container
 * are known without a request apiece.
 *
 * Separate from fetchRecursiveVideos, with its own cache key, rather than widening that one's
 * Fields: MediaSources is a heavy payload and the play queue never reads it, so every queue
 * build would pay for what only a download needs. Sizes are what let a folder download state
 * its total and check it against the disk before writing anything.
 */
export async function fetchRecursiveDownloadables(parentId: string): Promise<JellyfinVideoItem[]> {
  const config = await getConfig();

  if (!config.server || !config.apiKey || !config.userId) {
    throw new Error("Jellyfin server not configured.");
  }

  return cachedRequest(`recursivesized:${config.userId}:${parentId}`, () => fetchRecursiveLeaves(config, parentId, "Video,Audio", ",MediaSources"), CACHE.DEFAULT_TTL_MS);
}

/**
 * Every photo under a folder, for a slideshow started from the info panel. The folder's own
 * children are only part of the set: a photo library holds most of its photos inside albums.
 */
export async function fetchRecursivePhotos(parentId: string): Promise<JellyfinItem[]> {
  const config = await getConfig();

  if (!config.server || !config.apiKey || !config.userId) {
    throw new Error("Jellyfin server not configured.");
  }

  return cachedRequest(`recursivephotos:${config.userId}:${parentId}`, () => fetchRecursiveLeaves(config, parentId, "Photo"), CACHE.DEFAULT_TTL_MS);
}

/**
 * Latest additions across every library for the home tab's New shelf, via /Items/Latest.
 * The endpoint answers a BARE BaseItemDto array (no Items/TotalRecordCount wrapper), groups
 * episodes into their Series and songs into their MusicAlbum by default, and excludes
 * Virtual (unaired) entries server-side. Non-critical display data: never throws, null on
 * failure so callers can tell a transient error from a genuinely empty list.
 */
export async function fetchLatestItems(limit = 20): Promise<JellyfinItem[] | null> {
  const config = await getConfig();

  if (!config.server || !config.apiKey || !config.userId) {
    return null;
  }

  const query = new URLSearchParams({
    userId: config.userId,
    Limit: String(limit),
    // ParentId is Fields-gated; the shelf's binge queue builds from SeriesId ?? ParentId.
    Fields: "Path,MediaStreams,Genres,ProductionYear,ParentId,ImageTags,PrimaryImageAspectRatio",
    EnableUserData: "true",
  });

  const cacheKey = `latest:${config.userId}:${limit}`;
  try {
    return await cachedRequest(
      cacheKey,
      async () => {
        const response = await fetchWithTimeout(
          `${config.server}/Items/Latest?${query.toString()}`,
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
          throwRequestError(response, `Failed to fetch latest items: ${response.status}`);
        }

        const data = await response.json();
        return (Array.isArray(data) ? data : []) as JellyfinItem[];
      },
      CACHE.DEFAULT_TTL_MS,
    );
  } catch (error) {
    logger.warn("Failed to fetch latest items", error, { service: "JellyfinAPI" });
    return null;
  }
}
