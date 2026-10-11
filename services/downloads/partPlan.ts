/**
 * Splitting one Static download into ranged parts fetched concurrently.
 * Pure: the manager owns the tasks, this owns the arithmetic.
 */

/** Byte range of one part; end is inclusive, as HTTP Range wants it. */
export interface DownloadPart {
  index: number;
  start: number;
  end: number;
}

/** Parts stay large so per-request overhead and resume bookkeeping stay small. */
export const MIN_PART_BYTES = 32 * 1024 * 1024;
/** Aggregate gains taper past a few connections (ParS measurement). */
export const MAX_PARTS = 4;
/** Part tasks running at once. */
export const PART_CONCURRENCY = 3;

/**
 * Even byte ranges covering the file, or a single part when the file is too
 * small to be worth splitting or its size is unknown.
 */
export function planParts(totalBytes: number, maxParts: number = MAX_PARTS, minPartBytes: number = MIN_PART_BYTES): DownloadPart[] {
  if (!Number.isFinite(totalBytes) || totalBytes <= 0) return [{ index: 0, start: 0, end: -1 }];
  const count = Math.max(1, Math.min(maxParts, Math.floor(totalBytes / minPartBytes)));
  const base = Math.floor(totalBytes / count);
  const parts: DownloadPart[] = [];
  for (let index = 0; index < count; index += 1) {
    const start = index * base;
    const end = index === count - 1 ? totalBytes - 1 : start + base - 1;
    parts.push({ index, start, end });
  }
  return parts;
}

/** The Range header for a part; an open-ended part (unknown size) has none. */
export function partRangeHeader(part: DownloadPart): Record<string, string> {
  return part.end < 0 ? {} : { Range: `bytes=${part.start}-${part.end}` };
}

/** Bytes a part spans; 0 when the size is unknown. */
export function partSize(part: DownloadPart): number {
  return part.end < 0 ? 0 : part.end - part.start + 1;
}

/** Whole-file progress from per-part written counts, for the manifest's one gauge. */
export function aggregateProgress(parts: DownloadPart[], written: Map<number, number>): number {
  let total = 0;
  for (const part of parts) total += Math.min(written.get(part.index) ?? 0, partSize(part) || Number.MAX_SAFE_INTEGER);
  return total;
}
