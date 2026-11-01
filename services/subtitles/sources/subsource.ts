/**
 * SubSource (api.subsource.net) with the viewer's own key: a title is found first, then its
 * subtitles listed by the language's English name; downloads are zips.
 */
import { languageFor } from "../languages";
import { episodeTag, releaseName } from "../query";
import type { SubtitleFile, SubtitleHit, SubtitleQuery, SubtitleSource } from "../types";
import { providerBytes, providerJson, unpackSubtitle } from "./http";

export const SUBSOURCE_BASE = "https://api.subsource.net/api/v1";

interface SubsourceMovie {
  movieId: number;
  title?: string;
  type?: string;
  releaseYear?: number;
  season?: number | null;
}

interface SubsourceSubtitle {
  subtitleId: number;
  language?: string;
  releaseInfo?: string[];
  hearingImpaired?: boolean;
  foreignParts?: boolean;
  downloads?: number;
  rating?: { good?: number; bad?: number; total?: number };
  productionType?: string | null;
}

function keyHeaders(apiKey: string): Record<string, string> {
  return { "X-API-Key": apiKey };
}

/** The title search: by IMDb id when the item has one, by text otherwise. */
export function subsourceSearchParams(query: SubtitleQuery): URLSearchParams {
  const params = new URLSearchParams();
  if (query.imdbId) {
    params.set("searchType", "imdb");
    params.set("imdb", query.imdbId);
  } else {
    params.set("searchType", "text");
    params.set("q", query.keywords);
  }
  params.set("type", query.kind === "episode" ? "series" : query.kind === "movie" ? "movie" : "all");
  if (query.kind === "episode" && query.season !== undefined) params.set("season", String(query.season));
  if (query.kind === "movie" && query.year) params.set("year", String(query.year));
  return params;
}

/** The title whose season matches an episode query, else the first. */
export function pickTitle(movies: SubsourceMovie[], query: SubtitleQuery): SubsourceMovie | null {
  if (movies.length === 0) return null;
  if (query.kind === "episode" && query.season !== undefined) {
    return movies.find((movie) => movie.season === query.season) ?? movies[0];
  }
  if (query.year) return movies.find((movie) => movie.releaseYear === query.year) ?? movies[0];
  return movies[0];
}

/** Only releases naming this episode when the listing is a whole season's. */
function namesEpisode(subtitle: SubsourceSubtitle, query: SubtitleQuery): boolean {
  const tag = episodeTag(query);
  if (!tag) return true;
  const releases = subtitle.releaseInfo ?? [];
  return releases.length === 0 || releases.some((release) => tag.test(release));
}

export function subsourceHit(subtitle: SubsourceSubtitle, language: string, query: SubtitleQuery): SubtitleHit | null {
  if (subtitle.subtitleId === undefined || subtitle.subtitleId === null) return null;
  const rating = subtitle.rating;
  const total = rating?.total ?? 0;
  return {
    id: String(subtitle.subtitleId),
    source: "subsource",
    name: releaseName(subtitle.releaseInfo ?? [], query) || String(subtitle.subtitleId),
    language,
    format: "",
    hashMatch: false,
    forced: subtitle.foreignParts === true,
    hearingImpaired: subtitle.hearingImpaired === true,
    machineTranslated: false,
    rating: total > 0 ? Math.round(((rating?.good ?? 0) / total) * 100) / 10 : null,
    downloads: typeof subtitle.downloads === "number" ? subtitle.downloads : null,
    author: "",
  };
}

export const subsourceSource: SubtitleSource = {
  id: "subsource",
  accepts(_query, context) {
    return context.findSubtitles && context.keys.subsource !== null;
  },
  async search(query, language, context) {
    const key = context.keys.subsource;
    const row = languageFor(language);
    if (!key || !row || (!query.keywords && !query.imdbId)) return [];
    const found = await providerJson<{ data?: SubsourceMovie[] }>("subsource", `${SUBSOURCE_BASE}/movies/search?${subsourceSearchParams(query)}`, { headers: keyHeaders(key) });
    const title = pickTitle(found?.data ?? [], query);
    if (!title) return [];
    const params = new URLSearchParams({ movieId: String(title.movieId), language: row.english.toLowerCase(), limit: "50" });
    const listing = await providerJson<{ data?: SubsourceSubtitle[] }>("subsource", `${SUBSOURCE_BASE}/subtitles?${params}`, { headers: keyHeaders(key) });
    return (listing?.data ?? [])
      .filter((subtitle) => namesEpisode(subtitle, query))
      .map((subtitle) => subsourceHit(subtitle, language, query))
      .filter((hit): hit is SubtitleHit => hit !== null);
  },
  async fetch(hit, context): Promise<SubtitleFile> {
    const key = context.keys.subsource;
    if (!key) throw new Error("no subsource key");
    const bytes = await providerBytes("subsource", `${SUBSOURCE_BASE}/subtitles/${encodeURIComponent(hit.id)}/download`, { headers: keyHeaders(key) });
    const file = bytes ? unpackSubtitle(bytes, "") : null;
    if (!file) throw new Error("subsource download held no subtitle");
    return file;
  },
};
