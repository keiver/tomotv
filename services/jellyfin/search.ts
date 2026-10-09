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
import { foldText } from "@/utils/textFold";
import { fetchWithTimeout } from "./http";
import { API_TIMEOUTS, INCLUDED_LOCATION_TYPES, FACET_PREFIX_MIN_CHARS } from "./constants";
import { getAuthHeader, getConfig, JellyfinConfig } from "./session";
import { requestLibraryItems } from "./items";
import { fetchLibraryArtists, fetchLibraryGenres } from "./facets";
import { fetchTunerData, type TunerData } from "./tunerGroups";
import { fetchChannelOrder } from "./liveTv";
import { activeGuideUrls, searchExternalPrograms } from "@/services/externalGuide";
import { getLiveTvPreferences } from "@/services/liveTvPreferences";
import type { GuideChannelRequest } from "@/utils/guideMatch";
import { EXTERNAL_GUIDE_PREFIX } from "@/utils/guide";
import { liveTvSearchHorizon, liveTvSearchIndex, liveTvSearchIndexVersion } from "./liveTvSearchIndex";

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
 * server's genre and artist names, each from its own offset; a source with no offset is not
 * asked. Returns nothing when nothing matches. A facet-list fetch failure degrades to
 * title-only search rather than failing the whole search.
 */
async function buildFacetSearchRequests(
  config: JellyfinConfig,
  term: string,
  years: number[],
  { offsets, limit }: { offsets: Omit<SearchCursor, "title">; limit: number },
): Promise<Partial<Record<FacetSource, Promise<{ items: JellyfinVideoItem[]; total?: number }>>>> {
  if (!term || (offsets.genre === undefined && offsets.artist === undefined)) return {};

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
  if (genres.length === 0 && artistIds.length === 0) return {};

  logger.debug("Search facets matched", {
    service: "JellyfinAPI",
    genres: genres.join("|") || "(none)",
    artistCount: artistIds.length,
    leftoverTerm: leftover || "(empty)",
  });

  const shared = {
    limit,
    searchTerm: leftover || undefined,
    years: years.length > 0 ? years : undefined,
    timeoutMs: 15000,
  };

  const requests: Partial<Record<FacetSource, Promise<{ items: JellyfinVideoItem[]; total?: number }>>> = {};
  if (genres.length > 0 && offsets.genre !== undefined) {
    requests.genre = requestLibraryItems(config, { ...shared, startIndex: offsets.genre, genres, includeAllTypes: true, includeSeries: true });
  }
  if (artistIds.length > 0 && offsets.artist !== undefined) {
    // Matched genres also constrain the artist query ("queen rock" → Queen's rock items)
    requests.artist = requestLibraryItems(config, { ...shared, startIndex: offsets.artist, artistIds, genres: genres.length > 0 ? genres : undefined });
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

type FacetSource = "genre" | "artist";
const FACET_SOURCES: FacetSource[] = ["genre", "artist"];

/** Where the next page of a search starts in each source; a source left out has nothing more. */
export interface SearchCursor {
  title?: number;
  genre?: number;
  artist?: number;
}

/** A source's next offset from the raw page it returned, or undefined once it is exhausted. */
export function nextOffset(offset: number | undefined, page: { items: unknown[]; total?: number } | undefined, limit: number): number | undefined {
  if (offset === undefined || !page) return undefined;
  const reached = offset + page.items.length;
  const more = page.total !== undefined ? reached < page.total : page.items.length === limit;
  return more && page.items.length > 0 ? reached : undefined;
}

/**
 * Remote search for videos using Jellyfin's SearchTerm filter
 * Supports searching by:
 * - Title/name (default)
 * - Year: "action 2023", "(2020)", "2019-2023"
 * - Genre: "comedy", "comedy 90s"; partial names match too ("entert" → Entertainment)
 * - Artist: "queen", "queen rock 80s" (Audio/MusicVideo items)
 * - Series name (automatically expands to episodes)
 * Genre/artist matches union with title matches: a word naming a genre or artist adds
 * those results in parallel without narrowing the title search.
 */
export async function searchVideos(searchTerm: string, { limit = 60, cursor }: { limit?: number; cursor?: SearchCursor } = {}): Promise<{ items: JellyfinVideoItem[]; next: SearchCursor | null }> {
  const trimmed = searchTerm.trim();
  if (!trimmed) {
    return { items: [], next: null };
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

  const offsets: SearchCursor = cursor ?? { title: 0, genre: 0, artist: 0 };
  const cacheKey = `search:${config.userId}:${term}:${years.join(",")}:${offsets.title ?? "-"},${offsets.genre ?? "-"},${offsets.artist ?? "-"}:${limit}`;
  return cachedRequest(
    cacheKey,
    () =>
      retryWithBackoff(
        async () => {
          // Title search: playable items + Series (to expand into episodes). Fired before
          // the facet-list fetch so a cold facet cache never delays it.
          const titleRequest =
            offsets.title === undefined
              ? Promise.resolve(undefined)
              : requestLibraryItems(config, {
                  startIndex: offsets.title,
                  limit,
                  searchTerm: term || undefined,
                  years: years.length > 0 ? years : undefined,
                  includeAllTypes: true,
                  includeSeries: true, // Also search for Series to expand
                  timeoutMs: 15000,
                });

          const facetRequests = await buildFacetSearchRequests(config, term, years, { offsets, limit });
          const titleResult = await titleRequest;

          // Union semantics: a failed genre/artist request drops its results, never the search
          const facetPages: Partial<Record<FacetSource, { items: JellyfinVideoItem[]; total?: number }>> = {};
          const asked = FACET_SOURCES.filter((source) => facetRequests[source]);
          (await Promise.allSettled(asked.map((source) => facetRequests[source]))).forEach((settled, index) => {
            if (settled.status === "fulfilled" && settled.value) facetPages[asked[index]] = settled.value;
            else if (settled.status === "rejected") logger.warn("Facet search request failed", settled.reason, { service: "JellyfinAPI" });
          });
          const facetResults = FACET_SOURCES.flatMap((source) => facetPages[source] ?? []);

          // Separate playable items from Series; the same Series can arrive from both the
          // title and genre queries, so key by Id to expand each only once
          const results = [...(titleResult ? [titleResult] : []), ...facetResults];
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

          // The next page asks each source from what it returned itself: expanded episodes and
          // the other sources' hits never move a server offset.
          const next: SearchCursor = {
            title: nextOffset(offsets.title, titleResult, limit),
            genre: nextOffset(offsets.genre, facetPages.genre, limit),
            artist: nextOffset(offsets.artist, facetPages.artist, limit),
          };
          const continues = Object.values(next).some((offset) => offset !== undefined);
          // A facet whose request failed is asked again from the same place, riding a page another
          // source still fills, so a facet that keeps failing never drives a page of its own.
          if (continues) for (const source of asked) if (!facetPages[source]) next[source] = offsets[source];
          return {
            items: uniqueItems,
            next: continues ? next : null,
          };
        },
        { maxAttempts: 3 },
      ),
    CACHE.SEARCH_TTL_MS,
  );
}

/** Live TV search results kept on screen. */
const LIVE_TV_RESULT_CAP = 30;

/**
 * Channels first, then programmes by start, one card per title per channel (its next airing). Programmes
 * already over, or starting after tomorrow, are dropped.
 */
export function orderLiveTvResults(items: readonly JellyfinVideoItem[], nowMs: number): JellyfinVideoItem[] {
  const horizonMs = liveTvSearchHorizon(nowMs);
  const channels = items.filter((item) => item.Type === "TvChannel");
  const shows = new Set<string>();
  const programs = items
    .filter((item) => item.Type === "Program" && Date.parse(item.EndDate ?? "") > nowMs && Date.parse(item.StartDate ?? "") < horizonMs)
    .sort((a, b) => Date.parse(a.StartDate ?? "") - Date.parse(b.StartDate ?? ""))
    .filter((item) => {
      const show = `${item.ChannelId}|${foldText(item.Name ?? "")}`;
      if (shows.has(show)) return false;
      shows.add(show);
      return true;
    });
  return channels.concat(programs).slice(0, LIVE_TV_RESULT_CAP);
}

/** Shorter folded terms match every description; the server's name match covers them. */
const DESCRIPTION_MIN_CHARS = 3;

/** Every word of the term appears in the programme's name, episode title or description, case and accents folded. */
export function matchesProgramText(program: Pick<JellyfinVideoItem, "Name" | "EpisodeTitle" | "Overview">, searchTerm: string): boolean {
  const folded = foldText(searchTerm);
  if (folded.length < DESCRIPTION_MIN_CHARS) return false;
  const text = foldText([program.Name, program.EpisodeTitle, program.Overview].filter(Boolean).join(" "));
  return folded.split(/\s+/).every((term) => text.includes(term));
}

const liveTvHeaders = (config: JellyfinConfig) => ({ Accept: "application/json", Authorization: getAuthHeader(config.deviceId, config.apiKey) });

/** The server's name matches: channels and programmes. */
async function fetchLiveTvNameMatches(config: JellyfinConfig, searchTerm: string): Promise<JellyfinVideoItem[]> {
  const query = new URLSearchParams({
    userId: config.userId!,
    recursive: "true",
    includeItemTypes: "TvChannel,LiveTvProgram",
    searchTerm,
    limit: "100",
    fields: "StartDate,EndDate,ChannelInfo,PrimaryImageAspectRatio",
    enableImages: "true",
  });
  const response = await fetchWithTimeout(`${config.server}/Items?${query.toString()}`, { method: "GET", headers: liveTvHeaders(config) }, API_TIMEOUTS.QUICK);
  if (!response.ok) throw new Error(`Live TV search failed: ${response.status}`);
  const data: JellyfinVideosResponse = await response.json();
  return data.Items ?? [];
}

/**
 * Every programme airing now, one per channel, with the description the server's search never
 * reads. One read serves a whole typed query (CACHE.LIVE_AIRING_TTL_MS); a server switch clears it.
 */
async function fetchAiringPrograms(config: JellyfinConfig): Promise<JellyfinVideoItem[]> {
  return cachedRequest(
    `liveAiring:${config.userId}`,
    async () => {
      const query = new URLSearchParams({
        userId: config.userId!,
        isAiring: "true",
        fields: "ChannelInfo,Overview,PrimaryImageAspectRatio",
        enableImages: "true",
        enableUserData: "false",
        enableTotalRecordCount: "false",
      });
      const response = await fetchWithTimeout(`${config.server}/LiveTv/Programs?${query.toString()}`, { method: "GET", headers: liveTvHeaders(config) }, API_TIMEOUTS.NORMAL);
      if (!response.ok) throw new Error(`Live TV airing read failed: ${response.status}`);
      const data: JellyfinVideosResponse = await response.json();
      return data.Items ?? [];
    },
    CACHE.LIVE_AIRING_TTL_MS,
  );
}

/**
 * Programmes on now and later in the viewer's guide sources (the XMLTV guides Channel Settings adds
 * and the tuner playlists declare), for the tuner's channels, whose name, episode title or
 * description carries every word; the server's search never sees them. Matched in the native store.
 */
async function searchGuideSources(config: JellyfinConfig, searchTerm: string): Promise<JellyfinVideoItem[]> {
  if (foldText(searchTerm).length < DESCRIPTION_MIN_CHARS) return [];
  // A refused tuner read still leaves the viewer's own guides, matched by name, as in the guide.
  const data: Pick<TunerData, "tvgById" | "tvgNameById" | "tvgUrls"> = (await fetchTunerData().catch(() => null)) ?? { tvgById: {}, tvgNameById: {}, tvgUrls: [] };
  const urls = activeGuideUrls(getLiveTvPreferences(), data.tvgUrls);
  if (urls.length === 0) return [];
  // Every channel also matches by its Jellyfin name, as the guide does: the last tier, after tvg-id and tvg-name.
  const lineup = await cachedRequest(`liveChannelNames:${config.server}:${config.userId}`, () => fetchChannelOrder(), CACHE.LIVE_AIRING_TTL_MS).catch(() => []);
  const names: Record<string, string> = {};
  for (const channel of lineup) if (channel.Name) names[channel.Id] = channel.Name;
  const ids = new Set([...Object.keys(data.tvgById), ...Object.keys(data.tvgNameById), ...Object.keys(names)]);
  const channels: GuideChannelRequest[] = [...ids].map((channelId) => ({
    channelId,
    tvgId: data.tvgById[channelId],
    tvgName: data.tvgNameById[channelId],
    name: names[channelId] ?? data.tvgNameById[channelId] ?? "",
  }));
  const now = Date.now();
  const programs = await searchExternalPrograms(urls, channels, { from: now, to: liveTvSearchHorizon(now) }, searchTerm, LIVE_TV_RESULT_CAP);
  return programs.map(
    (program) => ({ ...program, Type: "Program", ChannelName: program.ChannelId ? (data.tvgNameById[program.ChannelId] ?? names[program.ChannelId]) : undefined }) as JellyfinVideoItem,
  );
}

/** The server programmes in the index whose name, episode title or description carries every word, as bare cards. */
function indexedMatches(config: JellyfinConfig, searchTerm: string): JellyfinVideoItem[] {
  const folded = foldText(searchTerm);
  if (folded.length < DESCRIPTION_MIN_CHARS) return [];
  const programs = liveTvSearchIndex(config);
  if (!programs) return [];
  const terms = folded.split(/\s+/);
  return programs
    .filter((program) => terms.every((term) => program.text.includes(term)))
    .map((program) => ({
      Id: program.id,
      Name: program.name,
      Type: "Program",
      Path: "",
      ChannelId: program.channelId,
      StartDate: new Date(program.startMs).toISOString(),
      EndDate: new Date(program.endMs).toISOString(),
    }));
}

/** A shown index card's channel name and artwork, read once per programme per server and account (ids repeat across servers). */
const programDetails = new Map<string, Promise<JellyfinVideoItem | null>>();
let programDetailsIndexVersion = -1;

function fetchProgramDetails(config: JellyfinConfig, programId: string): Promise<JellyfinVideoItem | null> {
  // A rebuilt index carries the guide's current listings, so details read against an older one go with it.
  if (programDetailsIndexVersion !== liveTvSearchIndexVersion()) {
    programDetails.clear();
    programDetailsIndexVersion = liveTvSearchIndexVersion();
  }
  const key = `${config.server}|${config.userId}|${programId}`;
  let details = programDetails.get(key);
  if (!details) {
    details = fetchWithTimeout(`${config.server}/LiveTv/Programs/${programId}?userId=${config.userId}`, { method: "GET", headers: liveTvHeaders(config) }, API_TIMEOUTS.QUICK)
      .then(async (response) => (response.ok ? ((await response.json()) as JellyfinVideoItem) : null))
      .catch(() => null);
    programDetails.set(key, details);
    details.then((found) => {
      if (!found) programDetails.delete(key);
    });
  }
  return details;
}

/**
 * Channels and programmes matching the term, through tomorrow: the server's name matches; the server's
 * programmes whose name, episode title or description carries every word (the server searches names
 * only), from the airing set at once and from the programme index once it is built; and the guide
 * sources' programmes. /Items ignores hasAired and minEndDate (probed), so ended programmes are dropped
 * here. Never waits on the index: subscribeLiveTvSearchIndex says when it lands. A failed source keeps
 * the others.
 */
/**
 * Opens the guide sources for the search window before the first query. The open downloads and
 * ingests the whole XMLTV natively, seconds no search should wait on; one warm per screen is
 * enough since the open guide is reused while its window covers.
 */
export async function warmLiveTvSearch(): Promise<void> {
  try {
    const config = await getConfig();
    if (!config.server || !config.apiKey || !config.userId) return;
    await searchGuideSources(config, "guide warmup probe");
  } catch {
    // A failed warm costs nothing: the first search opens the guide itself.
  }
}

export async function searchLiveTv(searchTerm: string): Promise<JellyfinVideoItem[]> {
  const trimmed = searchTerm.trim();
  if (!trimmed) return [];
  const config = await getConfig();
  if (!config.server || !config.apiKey || !config.userId) return [];
  const [names, airing, guideSources] = await Promise.allSettled([fetchLiveTvNameMatches(config, trimmed), fetchAiringPrograms(config), searchGuideSources(config, trimmed)]);
  const warn = (source: string, settled: PromiseRejectedResult) =>
    logger.warn("Live TV search failed", { service: "JellyfinAPI", source, error: settled.reason instanceof Error ? settled.reason.message : "unknown" });
  if (names.status === "rejected") warn("names", names);
  if (airing.status === "rejected") warn("airing", airing);
  if (guideSources.status === "rejected") warn("guide sources", guideSources);
  const items = names.status === "fulfilled" ? [...names.value] : [];
  const seen = new Set(items.map((item) => item.Id));
  for (const settled of [airing, guideSources]) {
    if (settled.status !== "fulfilled") continue;
    for (const program of settled.value) {
      if (program.Type === "Program" && program.ChannelId && !seen.has(program.Id) && matchesProgramText(program, trimmed)) {
        seen.add(program.Id);
        items.push(program);
      }
    }
  }
  for (const program of indexedMatches(config, trimmed)) {
    if (seen.has(program.Id)) continue;
    seen.add(program.Id);
    items.push(program);
  }
  const shown = orderLiveTvResults(items, Date.now());
  // Only the cards shown are completed, with their channel and artwork; a read that fails keeps the bare card.
  return Promise.all(
    shown.map(async (item) => (item.Type === "Program" && !item.ChannelName && !item.Id.startsWith(EXTERNAL_GUIDE_PREFIX) ? ((await fetchProgramDetails(config, item.Id)) ?? item) : item)),
  );
}
