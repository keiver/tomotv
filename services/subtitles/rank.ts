import type { SubtitleHit, SubtitleQuery } from "./types";

const WORD = /[a-z0-9]+/g;

function words(text: string): Set<string> {
  return new Set((text.toLowerCase().match(WORD) ?? []).filter((word) => word.length > 1));
}

/** How many of the file name's words a release name shares, 0 to 1. */
export function nameSimilarity(fileName: string, release: string): number {
  const wanted = words(fileName);
  if (wanted.size === 0) return 0;
  const offered = words(release);
  let shared = 0;
  for (const word of wanted) if (offered.has(word)) shared += 1;
  return shared / wanted.size;
}

function score(hit: SubtitleHit, query: SubtitleQuery): number {
  let total = 0;
  if (hit.hashMatch) total += 1000;
  if (hit.machineTranslated) total -= 500;
  if (hit.forced) total -= 300;
  total += Math.round(nameSimilarity(query.fileName, hit.name) * 100);
  if (hit.rating !== null) total += hit.rating * 2;
  if (hit.downloads !== null) total += Math.min(20, Math.log10(hit.downloads + 1) * 5);
  return total;
}

/** Hash matches first, then the release that reads most like the file, then rating and downloads. */
export function rankHits(hits: SubtitleHit[], query: SubtitleQuery): SubtitleHit[] {
  return hits
    .map((hit, position) => ({ hit, position, score: score(hit, query) }))
    .sort((a, b) => b.score - a.score || a.position - b.position)
    .map((entry) => entry.hit);
}
