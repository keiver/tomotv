/**
 * Gestdown (api.gestdown.info), a keyless proxy over Addic7ed: TV episodes only. A show is found
 * by name, then an episode's subtitles asked for by the language's English name.
 */
import { languageFor } from "../languages";
import type { SubtitleFile, SubtitleHit, SubtitleQuery, SubtitleSource } from "../types";
import { providerBytes, providerFetch, providerJson, unpackSubtitle } from "./http";

export const GESTDOWN_BASE = "https://api.gestdown.info";

interface GestdownShow {
  id: string;
  name: string;
  nbSeasons?: number;
  seasons?: number[];
}

interface GestdownSubtitle {
  subtitleId: string;
  version: string;
  release?: string | null;
  completed: boolean;
  hearingImpaired: boolean;
  corrected?: boolean;
  hd?: boolean;
  downloadUri: string;
  language: string;
  downloadCount?: number;
  source?: string;
}

interface GestdownSearchAnswer {
  matchingSubtitles?: GestdownSubtitle[] | null;
}

function normalise(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** The show whose name reads as the query, else the first one offered. */
export function pickShow(shows: GestdownShow[], keywords: string): GestdownShow | null {
  if (shows.length === 0) return null;
  const wanted = normalise(keywords);
  return shows.find((show) => normalise(show.name) === wanted) ?? shows[0];
}

export function gestdownHit(subtitle: GestdownSubtitle, language: string): SubtitleHit | null {
  if (!subtitle.completed || !subtitle.subtitleId) return null;
  return {
    id: subtitle.subtitleId,
    source: "gestdown",
    name: subtitle.release?.trim() || subtitle.version?.trim() || subtitle.subtitleId,
    language,
    format: "",
    hashMatch: false,
    forced: false,
    hearingImpaired: subtitle.hearingImpaired === true,
    machineTranslated: false,
    rating: null,
    downloads: typeof subtitle.downloadCount === "number" ? subtitle.downloadCount : null,
    author: subtitle.source?.trim() ?? "",
  };
}

export const gestdownSource: SubtitleSource = {
  id: "gestdown",
  accepts(query, context) {
    return context.findSubtitles && query.kind === "episode" && query.season !== undefined && query.episode !== undefined && query.keywords.length >= 3;
  },
  async search(query: SubtitleQuery, language: string) {
    const row = languageFor(language);
    if (!row) return [];
    const found = await providerJson<{ shows?: GestdownShow[] | null }>("gestdown", `${GESTDOWN_BASE}/shows/search/${encodeURIComponent(query.keywords)}`);
    const show = pickShow(found?.shows ?? [], query.keywords);
    if (!show) return [];
    const response = await providerFetch("gestdown", `${GESTDOWN_BASE}/subtitles/get/${encodeURIComponent(show.id)}/${query.season}/${query.episode}/${encodeURIComponent(row.english)}`);
    if (!response.ok) return [];
    const answer = (await response.json()) as GestdownSearchAnswer;
    return (answer.matchingSubtitles ?? []).map((subtitle) => gestdownHit(subtitle, language)).filter((hit): hit is SubtitleHit => hit !== null);
  },
  async fetch(hit: SubtitleHit): Promise<SubtitleFile> {
    const bytes = await providerBytes("gestdown", `${GESTDOWN_BASE}/subtitles/download/${encodeURIComponent(hit.id)}`);
    const file = bytes ? unpackSubtitle(bytes, `${hit.name}.srt`) : null;
    if (!file) throw new Error("gestdown download held no subtitle");
    return file;
  },
};
