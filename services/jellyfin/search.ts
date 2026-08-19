/**
 * Search: parse a raw query into a title term plus year/genre/artist facets, fan those out
 * into separate server queries, expand matched Series into their episodes, and union the
 * results.
 */
import { JellyfinNamedItem, JellyfinVideoItem, JellyfinVideosResponse } from "@/types/jellyfin";
import { cachedRequest } from "@/services/requestCache";
import { CACHE } from "@/constants/app";
import { logger } from "@/utils/logger";
import { retryWithBackoff } from "@/utils/retry";
import { fetchWithTimeout } from "./http";
import { API_TIMEOUTS, INCLUDED_LOCATION_TYPES, FACET_PREFIX_MIN_CHARS } from "./constants";
import { getAuthHeader, getConfig, JellyfinConfig } from "./session";
import { requestLibraryItems } from "./items";
import { fetchLibraryArtists, fetchLibraryGenres } from "./facets";

/**
 * Parse year(s) from search query
 * Supports patterns like:
 * - Full years: "2023", "action 2023", "(2020)"
 * - Year ranges: "2019-2023"
 * - Decades: "90s", "1990s", "80s"
 * - Partial years: "199" → 1990-1999, "20" → 2000-2009
 * Returns the remaining search term and extracted years
 */
function parseYearsFromQuery(query: string): { term: string; years: number[] } {
  const years: number[] = [];
  let term = query;

  // Pattern 1: Year range like "2019-2023" or "2019 - 2023"
  const rangeMatch = term.match(/\b(19|20)\d{2}\s*-\s*(19|20)\d{2}\b/);
  if (rangeMatch) {
    const [fullMatch] = rangeMatch;
    const [startYear, endYear] = fullMatch.split(/\s*-\s*/).map(Number);
    if (startYear <= endYear && endYear - startYear <= 10) {
      for (let y = startYear; y <= endYear; y++) {
        years.push(y);
      }
      term = term.replace(fullMatch, "").trim();
    }
  }

  // Pattern 2: Year in parentheses like "(2023)"
  const parenMatch = term.match(/\((\d{4})\)/);
  if (parenMatch && years.length === 0) {
    const year = parseInt(parenMatch[1], 10);
    if (year >= 1900 && year <= 2100) {
      years.push(year);
      term = term.replace(parenMatch[0], "").trim();
    }
  }

  // Pattern 3: Decade shorthand like "90s", "1990s", "80s"
  const decadeMatch = term.match(/\b(19)?(\d)0s\b/i);
  if (decadeMatch && years.length === 0) {
    const century = decadeMatch[1] ? 1900 : 2000;
    const decade = parseInt(decadeMatch[2], 10) * 10;
    // For "90s" without prefix, assume 1990s if >= 30, else 2000s
    const baseYear = decadeMatch[1] ? century + decade : decade >= 30 ? 1900 + decade : 2000 + decade;
    for (let y = baseYear; y < baseYear + 10; y++) {
      years.push(y);
    }
    term = term.replace(decadeMatch[0], "").trim();
  }

  // Pattern 4: Standalone year at end like "action 2023"
  const endYearMatch = term.match(/\s+(19|20)\d{2}$/);
  if (endYearMatch && years.length === 0) {
    const year = parseInt(endYearMatch[0].trim(), 10);
    if (year >= 1900 && year <= 2100) {
      years.push(year);
      term = term.replace(endYearMatch[0], "").trim();
    }
  }

  // Pattern 5: Just a full 4-digit year by itself like "2023"
  if (years.length === 0 && /^(19|20)\d{2}$/.test(term.trim())) {
    years.push(parseInt(term.trim(), 10));
    term = "";
  }

  // Pattern 6: 3-digit partial year like "199" → 1990-1999, "202" → 2020-2029
  if (years.length === 0 && /^(19|20)\d$/.test(term.trim())) {
    const partial = term.trim();
    const baseYear = parseInt(partial + "0", 10);
    for (let y = baseYear; y < baseYear + 10; y++) {
      years.push(y);
    }
    term = "";
  }

  // Pattern 7: 2-digit century prefix like "19" → 1900-1999, "20" → 2000-2099
  if (years.length === 0 && /^(19|20)$/.test(term.trim())) {
    const century = parseInt(term.trim(), 10) * 100;
    // Limit to reasonable range to avoid too many years
    const currentYear = new Date().getFullYear();
    const endYear = Math.min(century + 99, currentYear + 5);
    for (let y = century; y <= endYear; y++) {
      years.push(y);
    }
    term = "";
  }

  return { term: term.trim(), years };
}

/**
 * Match words/phrases of a search term against the server's genre and artist names.
 * A word may match a name exactly ("comedy" → Comedy) or as a prefix ("entert" →
 * Entertainment, min 3 chars) so results appear while the name is still being typed;
 * a prefix shared by several names claims all of them ("dram" → Drama and Dramedy).
 * Matched text becomes facet filters and is removed from the returned term; the same word
 * may claim both a genre and an artist (each feeds its own search request). Longest names
 * match first so "Science Fiction" wins over "Fiction".
 */
function parseFacetsFromQuery(term: string, genreNames: string[], artists: JellyfinNamedItem[]): { term: string; genres: string[]; artistIds: string[] } {
  const termLower = term.toLowerCase();

  // Term words with their positions, for prefix matching
  const words: { text: string; start: number; end: number }[] = [];
  const wordRe = /\S+/g;
  for (let match = wordRe.exec(term); match; match = wordRe.exec(term)) {
    words.push({ text: match[0].toLowerCase(), start: match.index, end: match.index + match[0].length });
  }

  const findSpan = (name: string): [number, number] | null => {
    if (!name) return null;

    // Whole-word/phrase match of `name` inside `term`. Whitespace-delimited rather than
    // \b so names with punctuation ("R&B", "Stand-Up") still bound cleanly.
    if (termLower.includes(name.toLowerCase())) {
      const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const match = new RegExp(`(?:^|\\s)${escaped}(?=\\s|$)`, "i").exec(term);
      if (match) {
        const start = match.index + match[0].length - name.length;
        return [start, match.index + match[0].length];
      }
    }

    // Word-sequence prefix of the name: "entert" → "Entertainment", "science fic" →
    // "Science Fiction". The sequence extends as long as it keeps prefixing the name.
    const nameLower = name.toLowerCase();
    for (let i = 0; i < words.length; i++) {
      let sequence = words[i].text;
      if (!nameLower.startsWith(sequence)) continue;
      let last = i;
      while (last + 1 < words.length && nameLower.startsWith(`${sequence} ${words[last + 1].text}`)) {
        last++;
        sequence = `${sequence} ${words[last].text}`;
      }
      if (sequence.length >= FACET_PREFIX_MIN_CHARS) {
        return [words[i].start, words[last].end];
      }
    }
    return null;
  };

  const claim = <T>(candidates: { name: string; value: T }[]): { values: T[]; spans: [number, number][] } => {
    const spans: [number, number][] = [];
    const values: T[] = [];
    for (const { name, value } of [...candidates].sort((a, b) => b.name.length - a.name.length)) {
      const span = findSpan(name);
      if (!span) continue;
      // Identical spans stack (one prefix claiming several names); partial overlaps lose
      // to the longer name claimed first
      const conflicting = spans.some(([s, e]) => span[0] < e && s < span[1] && !(s === span[0] && e === span[1]));
      if (!conflicting) {
        spans.push(span);
        values.push(value);
      }
    }
    return { values, spans };
  };

  const genreClaims = claim(genreNames.map((name) => ({ name, value: name })));
  const artistClaims = claim(artists.map((artist) => ({ name: artist.Name, value: artist.Id })));

  // Leftover = term minus every claimed span (genre and artist spans may overlap)
  const removed = new Set<number>();
  for (const [start, end] of [...genreClaims.spans, ...artistClaims.spans]) {
    for (let i = start; i < end; i++) removed.add(i);
  }
  const leftover = [...term]
    .filter((_, i) => !removed.has(i))
    .join("")
    .replace(/\s+/g, " ")
    .trim();

  return { term: leftover, genres: genreClaims.values, artistIds: artistClaims.values };
}

/**
 * Build the genre/artist search requests for a term by matching its words against the
 * server's genre and artist names. Returns [] when nothing matches. A facet-list fetch
 * failure degrades to title-only search rather than failing the whole search.
 */
async function buildFacetSearchRequests(
  config: JellyfinConfig,
  term: string,
  years: number[],
  { startIndex, limit }: { startIndex: number; limit: number },
): Promise<Promise<{ items: JellyfinVideoItem[]; total?: number }>[]> {
  if (!term) return [];

  const [genreNames, artists] = await Promise.all([
    fetchLibraryGenres().catch((error) => {
      logger.warn("Genre list unavailable for search", { service: "JellyfinAPI", error: error instanceof Error ? error.message : "unknown" });
      return [] as string[];
    }),
    fetchLibraryArtists().catch((error) => {
      logger.warn("Artist list unavailable for search", { service: "JellyfinAPI", error: error instanceof Error ? error.message : "unknown" });
      return [] as JellyfinNamedItem[];
    }),
  ]);

  const { term: leftover, genres, artistIds } = parseFacetsFromQuery(term, genreNames, artists);
  if (genres.length === 0 && artistIds.length === 0) return [];

  logger.debug("Search facets matched", {
    service: "JellyfinAPI",
    genres: genres.join("|") || "(none)",
    artistCount: artistIds.length,
    leftoverTerm: leftover || "(empty)",
  });

  const shared = {
    startIndex,
    limit,
    searchTerm: leftover || undefined,
    years: years.length > 0 ? years : undefined,
    timeoutMs: 15000,
  };

  const requests: Promise<{ items: JellyfinVideoItem[]; total?: number }>[] = [];
  if (genres.length > 0) {
    requests.push(requestLibraryItems(config, { ...shared, genres, includeAllTypes: true, includeSeries: true }));
  }
  if (artistIds.length > 0) {
    // Matched genres also constrain the artist query ("queen rock" → Queen's rock items)
    requests.push(requestLibraryItems(config, { ...shared, artistIds, genres: genres.length > 0 ? genres : undefined }));
  }
  return requests;
}

/**
 * Fetch episodes from a Series
 * Returns empty array on failure (with logging) to allow partial results
 */
async function fetchSeriesEpisodes(config: JellyfinConfig, seriesId: string, seriesName: string | undefined, limit: number = 50): Promise<JellyfinVideoItem[]> {
  const query = new URLSearchParams({
    ParentId: seriesId,
    Recursive: "true",
    IncludeItemTypes: "Episode",
    Fields: "Path,MediaStreams,Genres,ProductionYear,SeriesName",
    Limit: String(limit),
    SortBy: "SortName",
    SortOrder: "Ascending",
    // Searching a series must not offer episodes that do not exist yet
    // (INCLUDED_LOCATION_TYPES).
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
      API_TIMEOUTS.QUICK,
    );

    if (!response.ok) {
      logger.warn("Failed to fetch series episodes", {
        service: "JellyfinAPI",
        seriesId,
        seriesName: seriesName || "unknown",
        status: response.status,
      });
      return [];
    }

    const data: JellyfinVideosResponse = await response.json();
    return data.Items || [];
  } catch (error) {
    logger.warn("Error fetching series episodes", {
      service: "JellyfinAPI",
      seriesId,
      seriesName: seriesName || "unknown",
      error: error instanceof Error ? error.message : "unknown",
    });
    return [];
  }
}

/**
 * Remote search for videos using Jellyfin's SearchTerm filter
 * Supports searching by:
 * - Title/name (default)
 * - Year: "action 2023", "(2020)", "2019-2023"
 * - Genre: "comedy", "comedy 90s" — partial names match too ("entert" → Entertainment)
 * - Artist: "queen", "queen rock 80s" (Audio/MusicVideo items)
 * - Series name (automatically expands to episodes)
 * Genre/artist matches union with title matches: a word naming a genre or artist adds
 * those results in parallel without narrowing the title search.
 */
export async function searchVideos(searchTerm: string, { limit = 60, startIndex = 0 }: { limit?: number; startIndex?: number } = {}): Promise<{ items: JellyfinVideoItem[]; total?: number }> {
  const trimmed = searchTerm.trim();
  if (!trimmed) {
    return { items: [], total: 0 };
  }

  const config = await getConfig();
  if (!config.server || !config.apiKey || !config.userId) {
    throw new Error("Jellyfin server not configured. Update settings before searching.");
  }

  // Parse year from search query
  const { term, years } = parseYearsFromQuery(trimmed);

  logger.debug("Search query parsed", {
    service: "JellyfinAPI",
    originalQuery: trimmed,
    parsedTerm: term || "(empty)",
    parsedYears: years.length > 0 ? `${years[0]}${years.length > 1 ? `-${years[years.length - 1]}` : ""}` : "(none)",
    yearCount: years.length,
  });

  const cacheKey = `search:${config.userId}:${term}:${years.join(",")}:${startIndex}:${limit}`;
  return cachedRequest(
    cacheKey,
    () =>
      retryWithBackoff(
        async () => {
          // Title search: playable items + Series (to expand into episodes). Fired before
          // the facet-list fetch so a cold facet cache never delays it.
          const titleRequest = requestLibraryItems(config, {
            startIndex,
            limit,
            searchTerm: term || undefined,
            years: years.length > 0 ? years : undefined,
            includeAllTypes: true,
            includeSeries: true, // Also search for Series to expand
            timeoutMs: 15000,
          });

          const facetRequests = await buildFacetSearchRequests(config, term, years, { startIndex, limit });
          const titleResult = await titleRequest;

          // Union semantics: a failed genre/artist request drops its results, never the search
          const facetResults: { items: JellyfinVideoItem[]; total?: number }[] = [];
          for (const settled of await Promise.allSettled(facetRequests)) {
            if (settled.status === "fulfilled") {
              facetResults.push(settled.value);
            } else {
              logger.warn("Facet search request failed", settled.reason, { service: "JellyfinAPI" });
            }
          }

          // Separate playable items from Series; the same Series can arrive from both the
          // title and genre queries, so key by Id to expand each only once
          const results = [titleResult, ...facetResults];
          const playableItems: JellyfinVideoItem[] = [];
          const seriesById = new Map<string, JellyfinVideoItem>();

          for (const result of results) {
            for (const item of result.items) {
              if (item.Type === "Series") {
                seriesById.set(item.Id, item);
              } else {
                playableItems.push(item);
              }
            }
          }

          // If we found Series, fetch their episodes
          if (seriesById.size > 0) {
            const seriesItems = [...seriesById.values()];
            logger.debug("Expanding series to episodes", {
              service: "JellyfinAPI",
              seriesCount: seriesItems.length,
              seriesNames: seriesItems.map((s) => s.Name).join(", "),
            });

            // Pass series name for better error logging
            const episodePromises = seriesItems.map((series) => fetchSeriesEpisodes(config, series.Id, series.Name, 20));
            const episodeResults = await Promise.all(episodePromises);

            for (const episodes of episodeResults) {
              playableItems.push(...episodes);
            }
          }

          // Deduplicate: items may appear in several queries and in series expansion
          const seen = new Set<string>();
          const uniqueItems = playableItems.filter((item) => {
            if (seen.has(item.Id)) return false;
            seen.add(item.Id);
            return true;
          });

          // Preserve server totals for proper pagination. Title-only keeps the exact server
          // count; with facet queries the sum overcounts duplicates, which pagination
          // tolerates the same way it does series expansion.
          return {
            items: uniqueItems,
            total: facetResults.length === 0 ? (titleResult.total ?? uniqueItems.length) : results.reduce((sum, r) => sum + (r.total ?? r.items.length), 0),
          };
        },
        { maxAttempts: 3 },
      ),
    CACHE.SEARCH_TTL_MS,
  );
}
