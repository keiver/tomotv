/**
 * podnapisi.net, which needs no account: a JSON search by title, year, season and episode, and a
 * zip download holding the one subtitle file.
 */
import { languageCode } from "../languages";
import type { SubtitleFile, SubtitleHit, SubtitleQuery, SubtitleSource } from "../types";
import { providerBytes, providerJson, unpackSubtitle } from "./http";

export const PODNAPISI_BASE = "https://www.podnapisi.net/subtitles";

interface PodnapisiRecord {
  id?: string | number;
  language?: string;
  flags?: string[];
  releases?: string[];
  custom_releases?: string[];
  url?: string;
  stats?: { downloads?: number };
  rating?: number;
  movie?: { title?: string; year?: number | string; type?: string; episode_info?: { season?: number | string; episode?: number | string } };
}

interface PodnapisiAnswer {
  data?: PodnapisiRecord[];
  page?: number | string;
  all_pages?: number | string;
}

/** The query string podnapisi.net reads: keywords, language and what kind of title. */
export function podnapisiParams(query: SubtitleQuery, language: string): URLSearchParams {
  const params = new URLSearchParams({ keywords: query.keywords, language });
  if (query.kind === "episode" && query.season !== undefined && query.episode !== undefined) {
    params.set("seasons", String(query.season));
    params.set("episodes", String(query.episode));
    params.append("movie_type", "tv-series");
    params.append("movie_type", "mini-series");
  } else {
    params.set("movie_type", "movie");
    if (query.year) params.set("year", String(query.year));
  }
  return params;
}

export function podnapisiHit(record: PodnapisiRecord, language: string, query: SubtitleQuery): SubtitleHit | null {
  if (record.id === undefined || record.id === null) return null;
  if (query.kind === "episode" && record.movie?.type === "movie") return null;
  const releases = [...(record.releases ?? []), ...(record.custom_releases ?? [])].filter(Boolean);
  const flags = record.flags ?? [];
  return {
    id: String(record.id),
    source: "podnapisi",
    name: releases[0] || [record.movie?.title, record.movie?.year].filter(Boolean).join(" ") || String(record.id),
    language: languageCode(record.language) ?? language,
    format: "",
    hashMatch: false,
    forced: flags.includes("foreign_only") || flags.includes("forced"),
    hearingImpaired: flags.includes("hearing_impaired"),
    machineTranslated: false,
    rating: typeof record.rating === "number" ? record.rating : null,
    downloads: typeof record.stats?.downloads === "number" ? record.stats.downloads : null,
    author: "",
  };
}

export const podnapisiSource: SubtitleSource = {
  id: "podnapisi",
  accepts(_query, context) {
    return context.findSubtitles;
  },
  async search(query: SubtitleQuery, language: string) {
    if (!query.keywords) return [];
    const answer = await providerJson<PodnapisiAnswer>("podnapisi", `${PODNAPISI_BASE}/search/advanced?${podnapisiParams(query, language)}`);
    const seen = new Set<string>();
    const hits: SubtitleHit[] = [];
    for (const record of answer?.data ?? []) {
      const hit = podnapisiHit(record, language, query);
      if (!hit || seen.has(hit.id)) continue;
      seen.add(hit.id);
      hits.push(hit);
    }
    return hits;
  },
  async fetch(hit: SubtitleHit): Promise<SubtitleFile> {
    const bytes = await providerBytes("podnapisi", `${PODNAPISI_BASE}/${encodeURIComponent(hit.id)}/download?container=zip`);
    const file = bytes ? unpackSubtitle(bytes, "") : null;
    if (!file) throw new Error("podnapisi download held no subtitle");
    return file;
  },
};
