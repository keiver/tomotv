/**
 * The facet entity endpoints behind the filter sheet: genres, artists and years for a
 * library. Plain entity queries, NOT the view-root recursive item queries that Jellyfin
 * 10.11 routes through per-collection-type view builders.
 */
import { JellyfinNamedItem } from "@/types/jellyfin";
import { cachedRequest } from "@/services/requestCache";
import { CACHE } from "@/constants/app";
import { logger } from "@/utils/logger";
import { retryWithBackoff } from "@/utils/retry";
import { API_TIMEOUTS } from "./constants";
import { fetchWithTimeout } from "./http";
import { getAuthHeader, getConfig, throwRequestError } from "./session";

/**
 * Fetch the names for one genre-entity endpoint (/Genres or /MusicGenres) scoped to a library.
 * Plain entity queries — NOT the view-root recursive item queries that Jellyfin 10.11 routes
 * through per-collection-type view builders (see CLAUDE-lessons-learned).
 */
async function fetchGenreNames(config: { server: string; apiKey: string; userId: string; deviceId: string }, endpoint: "/Genres" | "/MusicGenres", parentId?: string): Promise<string[]> {
  return retryWithBackoff(
    async () => {
      const query = new URLSearchParams({
        UserId: config.userId,
        SortBy: "SortName",
        SortOrder: "Ascending",
      });
      if (parentId) {
        query.append("ParentId", parentId);
      }

      const url = `${config.server}${endpoint}?${query.toString()}`;

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
        throwRequestError(response, `Failed to fetch ${endpoint}: ${response.status}`);
      }

      const data: { Items?: JellyfinNamedItem[] } = await response.json();
      return (data.Items || []).map((item) => item.Name);
    },
    { maxAttempts: 3 },
  );
}

/**
 * Fetch the genre names present in a library (or any folder subtree), for the Filters panel.
 * Omit parentId for the whole server (used by search facet matching).
 * Server-populated, never hardcoded — real libraries have genres like "90s" or "Big Band".
 *
 * Merges /Genres and /MusicGenres: video genres and music genres are separate entities in
 * Jellyfin, and music-typed items (Audio, MusicVideo) index theirs under /MusicGenres.
 */
export async function fetchLibraryGenres(parentId?: string): Promise<string[]> {
  const config = await getConfig();

  if (!config.server || !config.apiKey || !config.userId) {
    throw new Error("Jellyfin server not configured.");
  }

  const cacheKey = `genres:${config.userId}:${parentId ?? "__global__"}`;
  return cachedRequest(
    cacheKey,
    async () => {
      // Merge both entity types; one endpoint failing must not blank the other's results.
      const results = await Promise.allSettled([fetchGenreNames(config, "/Genres", parentId), fetchGenreNames(config, "/MusicGenres", parentId)]);
      results.forEach((result) => {
        if (result.status === "rejected") {
          logger.warn("Genre endpoint failed", result.reason, { service: "JellyfinAPI", parentId });
        }
      });

      const merged = [...new Set(results.flatMap((result) => (result.status === "fulfilled" ? result.value : [])))].sort((a, b) => a.localeCompare(b));
      // Empty is a valid state (items without genre tags), not an error — log it so a hidden
      // Genres section is explainable from the console.
      logger.debug("Library genres fetched", { service: "JellyfinAPI", parentId, genreCount: merged.length });
      return merged;
    },
    CACHE.FACET_TTL_MS,
  );
}

/**
 * Fetch the artists present in a library (or any folder subtree), for the Filters panel.
 * Omit parentId for the whole server (used by search facet matching).
 * Returns empty for libraries without artist-bearing items (movies, shows), which hides
 * the Artists section.
 *
 * `/Artists` carries `deprecated: true` in the published API spec and is called anyway,
 * because it is the only endpoint that returns artists on ANY server version, old or new.
 *
 * It has no replacement, and cannot have one shaped like `/Items`: artist rows live
 * OUTSIDE the item tree. In the server database they carry no ParentId and no
 * TopParentId, and their Path is `%MetadataPath%/artists/<name>`. `/Items` resolves by
 * hierarchy, so it can never reach them. Measured against 10.11.11 on a music library
 * whose `/Artists` answers 57:
 *
 *   /Items IncludeItemTypes=MusicArtist, recursive + parentId   -> 0
 *   /Items IncludeItemTypes=MusicArtist, recursive, no parent   -> 0
 *   /Items IncludeItemTypes=MusicArtist, non-recursive          -> 0
 *
 * Do not "modernise" this to /Items without re-measuring: it silently empties the
 * Artists filter. The legacy user-scoped routes DID have working replacements and were
 * migrated (/UserViews, /UserItems/Resume, /UserPlayedItems, /UserFavoriteItems).
 *
 * Version resilience is handled by failing soft rather than by picking an endpoint:
 * search catches this and searches on without artist facets (search.ts), and the Filters
 * panel takes it through Promise.allSettled and renders no Artists section
 * (app/filters.tsx). A server that drops `/Artists` therefore loses the artist facet and
 * nothing else. Pinned by services/__tests__/jellyfinApi.artistsFacet.test.ts — keep
 * those callers' catches when refactoring, or removal turns into a broken search.
 */
export async function fetchLibraryArtists(parentId?: string): Promise<JellyfinNamedItem[]> {
  const config = await getConfig();

  if (!config.server || !config.apiKey || !config.userId) {
    throw new Error("Jellyfin server not configured.");
  }

  const cacheKey = `artists:${config.userId}:${parentId ?? "__global__"}`;
  return cachedRequest(
    cacheKey,
    () =>
      retryWithBackoff(
        async () => {
          const query = new URLSearchParams({
            UserId: config.userId,
            SortBy: "SortName",
            SortOrder: "Ascending",
          });
          if (parentId) {
            query.append("ParentId", parentId);
          }

          const url = `${config.server}/Artists?${query.toString()}`;

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
            throwRequestError(response, `Failed to fetch artists: ${response.status}`);
          }

          const data: { Items?: JellyfinNamedItem[] } = await response.json();
          const artists = data.Items || [];
          logger.debug("Library artists fetched", { service: "JellyfinAPI", parentId, artistCount: artists.length });
          return artists;
        },
        { maxAttempts: 3 },
      ),
    CACHE.FACET_TTL_MS,
  );
}

/**
 * Fetch the production years present in a library (or any folder subtree), for the Filters panel.
 * Server-populated like genres/artists. /Years is a plain entity endpoint (Name is the year), NOT a
 * view-root recursive item query. Returns descending (newest first) and drops any non-numeric name.
 * Empty for libraries whose items carry no year, which hides the Years section.
 */
export async function fetchLibraryYears(parentId: string): Promise<number[]> {
  const config = await getConfig();

  if (!config.server || !config.apiKey || !config.userId) {
    throw new Error("Jellyfin server not configured.");
  }

  const cacheKey = `years:${config.userId}:${parentId}`;
  return cachedRequest(
    cacheKey,
    () =>
      retryWithBackoff(
        async () => {
          const query = new URLSearchParams({
            ParentId: parentId,
            UserId: config.userId!,
            SortBy: "SortName",
            SortOrder: "Descending",
          });

          const url = `${config.server}/Years?${query.toString()}`;

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
            throwRequestError(response, `Failed to fetch years: ${response.status}`);
          }

          const data: { Items?: JellyfinNamedItem[] } = await response.json();
          const years = (data.Items || [])
            .map((item) => Number(item.Name))
            .filter((year) => Number.isFinite(year))
            .sort((a, b) => b - a);
          logger.debug("Library years fetched", { service: "JellyfinAPI", parentId, yearCount: years.length });
          return years;
        },
        { maxAttempts: 3 },
      ),
    CACHE.FACET_TTL_MS,
  );
}
