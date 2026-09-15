/**
 * Reading position in Jellyfin's own ticks encodings (measured on 12.0.0): fixed layouts
 * store page index x 10000 against a RunTimeTicks of pages x 10000; text books store a
 * fraction of 10^7. The web client reads and writes the same numbers.
 */
import { updateUserItemData } from "@/services/jellyfinApi";
import { logger } from "@/utils/logger";
import type { BookKind } from "./kinds";

export const PAGE_TICKS = 10_000;
export const FRACTION_TICKS = 10_000_000;
const WRITE_DELAY_MS = 2_000;

export function ticksForPage(kind: BookKind, index: number, pages: number): number {
  if (kind === "fixed") return Math.max(0, index) * PAGE_TICKS;
  if (pages <= 1) return 0;
  return Math.round((Math.max(0, index) / pages) * FRACTION_TICKS);
}

export function pageForTicks(kind: BookKind, ticks: number | undefined, pages: number): number {
  if (!ticks || ticks <= 0 || pages <= 0) return 0;
  const page = kind === "fixed" ? Math.round(ticks / PAGE_TICKS) : Math.round((ticks / FRACTION_TICKS) * pages);
  return Math.min(Math.max(page, 0), pages - 1);
}

/** Debounced writes of the page being read; the last page marks the book played. */
export class ReadingProgress {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private pending: { index: number; pages: number } | null = null;
  private last: { index: number; pages: number } | null = null;

  constructor(
    private readonly itemId: string,
    private readonly kind: BookKind,
  ) {}

  /** The page the book opened on. Nothing is written until the reader moves off it, so opening a
   *  finished book and leaving keeps it finished. */
  start(index: number, pages: number): void {
    this.last = { index, pages };
  }

  note(index: number, pages: number): void {
    this.pending = { index, pages };
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.flush(), WRITE_DELAY_MS);
  }

  async flush(): Promise<void> {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    const next = this.pending;
    this.pending = null;
    if (!next || (this.last && this.last.index === next.index && this.last.pages === next.pages)) return;
    this.last = next;
    const finished = next.pages > 0 && next.index >= next.pages - 1;
    try {
      await updateUserItemData(this.itemId, {
        PlaybackPositionTicks: finished ? 0 : ticksForPage(this.kind, next.index, next.pages),
        Played: finished,
      });
    } catch (error) {
      logger.warn("Reading progress write failed", error, { service: "Books", itemId: this.itemId });
    }
  }
}
