/**
 * The sources in order, asked one after another until one answers with subtitles. A source that
 * refuses (a quota, a bad key, a server error) is left alone for the rest of the session, and the
 * refusal is reported so the screen can say why the answer came from further down the chain.
 */
import { logger } from "@/utils/logger";
import { gestdownSource } from "./sources/gestdown";
import { openSubtitlesSource } from "./sources/opensubtitles";
import { podnapisiSource } from "./sources/podnapisi";
import { serverSource } from "./sources/server";
import { subdlSource } from "./sources/subdl";
import { subsourceSource } from "./sources/subsource";
import { SOURCE_ORDER, SourceRefusal, type SearchContext, type SubtitleHit, type SubtitleQuery, type SubtitleSource, type SubtitleSourceId } from "./types";

export interface Refusal {
  source: SubtitleSourceId;
  status: number;
}

export interface ChainAnswer {
  hits: SubtitleHit[];
  /** The source the hits came from, or null when none answered. */
  answeredBy: SubtitleSourceId | null;
  /** Sources that refused this session, in chain order. */
  refused: Refusal[];
}

const SOURCES: Record<SubtitleSourceId, SubtitleSource> = {
  server: serverSource,
  opensubtitles: openSubtitlesSource,
  subdl: subdlSource,
  subsource: subsourceSource,
  podnapisi: podnapisiSource,
  gestdown: gestdownSource,
};

const down = new Map<SubtitleSourceId, number>();

export function markSourceDown(source: SubtitleSourceId, status: number): void {
  down.set(source, status);
}

export function sourceDown(source: SubtitleSourceId): number | undefined {
  return down.get(source);
}

/** For tests and a new sign-in. */
export function resetSourceChain(): void {
  down.clear();
}

export function sourceFor(id: SubtitleSourceId): SubtitleSource {
  return SOURCES[id];
}

/** Sources that will be asked for this query, in order, with the ones already down left out. */
export function sourcesFor(query: SubtitleQuery, context: SearchContext, sources: Record<SubtitleSourceId, SubtitleSource> = SOURCES): SubtitleSource[] {
  return SOURCE_ORDER.map((id) => sources[id]).filter((source) => !down.has(source.id) && source.accepts(query, context));
}

export async function runChain(query: SubtitleQuery, language: string, context: SearchContext, sources: Record<SubtitleSourceId, SubtitleSource> = SOURCES): Promise<ChainAnswer> {
  const refused: Refusal[] = SOURCE_ORDER.filter((id) => down.has(id) && sources[id].accepts(query, context)).map((id) => ({ source: id, status: down.get(id) as number }));
  for (const source of sourcesFor(query, context, sources)) {
    try {
      const hits = await source.search(query, language, context);
      if (hits.length > 0) return { hits, answeredBy: source.id, refused };
    } catch (error) {
      if (error instanceof SourceRefusal) {
        down.set(source.id, error.status);
        refused.push({ source: source.id, status: error.status });
        logger.warn("Subtitle source refused, left out for the session", { service: "Subtitles", source: source.id, status: error.status });
      } else {
        logger.warn("Subtitle source failed", error, { service: "Subtitles", source: source.id });
      }
    }
  }
  return { hits: [], answeredBy: null, refused };
}
