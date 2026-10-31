/**
 * SubDL (api.subdl.com) with the viewer's own key: a JSON search by title or ids, downloads as a
 * zip from dl.subdl.com.
 */
import { languageCode } from "../languages";
import type { SubtitleFile, SubtitleHit, SubtitleQuery, SubtitleSource } from "../types";
import { SourceRefusal } from "../types";
import { providerBytes, providerJson, unpackSubtitle } from "./http";

export const SUBDL_API = "https://api.subdl.com/api/v1/subtitles";
export const SUBDL_DOWNLOADS = "https://dl.subdl.com";

interface SubdlSubtitle {
  name?: string;
  release_name?: string;
  language?: string;
  lang?: string;
  url?: string;
  author?: string;
  hi?: boolean;
  season?: number;
  episode?: number;
  releases?: string[];
}

interface SubdlAnswer {
  status?: boolean;
  error?: string;
  subtitles?: SubdlSubtitle[];
}

/** The query string: the key, one upper-case language, the title or an id, and the episode numbers. */
export function subdlParams(apiKey: string, query: SubtitleQuery, language: string): URLSearchParams {
  const params = new URLSearchParams({ api_key: apiKey, languages: language.toUpperCase(), subs_per_page: "30", hi: "1", releases: "1" });
  if (query.kind === "episode" && query.season !== undefined && query.episode !== undefined) {
    params.set("type", "tv");
    params.set("season_number", String(query.season));
    params.set("episode_number", String(query.episode));
    if (query.imdbId) params.set("imdb_id", query.imdbId);
    else params.set("film_name", query.keywords);
  } else {
    params.set("type", "movie");
    if (query.imdbId) params.set("imdb_id", query.imdbId);
    else if (query.tmdbId) params.set("tmdb_id", query.tmdbId);
    else params.set("film_name", query.keywords);
    if (query.year && !query.imdbId && !query.tmdbId) params.set("year", String(query.year));
  }
  return params;
}

export function subdlHit(subtitle: SubdlSubtitle, language: string): SubtitleHit | null {
  if (!subtitle.url || !subtitle.url.startsWith("/")) return null;
  return {
    id: subtitle.url,
    source: "subdl",
    name: subtitle.release_name?.trim() || subtitle.name?.trim() || subtitle.url,
    language: languageCode(subtitle.lang ?? subtitle.language) ?? language,
    format: "",
    hashMatch: false,
    forced: false,
    hearingImpaired: subtitle.hi === true,
    machineTranslated: false,
    rating: null,
    downloads: null,
    author: subtitle.author?.trim() ?? "",
  };
}

const REFUSAL_WORDS = /not authorized|api key|invalid key/i;

export const subdlSource: SubtitleSource = {
  id: "subdl",
  accepts(_query, context) {
    return context.findSubtitles && context.keys.subdl !== null;
  },
  async search(query, language, context) {
    const key = context.keys.subdl;
    if (!key || !query.keywords) return [];
    const answer = await providerJson<SubdlAnswer>("subdl", `${SUBDL_API}?${subdlParams(key, query, language)}`);
    if (!answer) return [];
    if (answer.status === false) {
      if (REFUSAL_WORDS.test(answer.error ?? "")) throw new SourceRefusal("subdl", 401, `subdl refused the key`);
      return [];
    }
    return (answer.subtitles ?? []).map((subtitle) => subdlHit(subtitle, language)).filter((hit): hit is SubtitleHit => hit !== null);
  },
  async fetch(hit): Promise<SubtitleFile> {
    const bytes = await providerBytes("subdl", `${SUBDL_DOWNLOADS}${hit.id}`);
    const file = bytes ? unpackSubtitle(bytes, hit.id) : null;
    if (!file) throw new Error("subdl download held no subtitle");
    return file;
  },
};
