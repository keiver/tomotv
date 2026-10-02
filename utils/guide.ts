/**
 * Guide geometry: time to pixels, cells clipped to the loaded window, ruler ticks. Pure (durationLabel
 * reads the active language), so the canvas and its tests share one source of truth.
 */
import { GRID, slotCardPadding } from "@/constants/app";
import { t } from "@/services/i18n";
import type { JellyfinProgram, JellyfinTimer } from "@/types/jellyfin";

export const MINUTE_MS = 60_000;
export const TICK_MINUTES = 30;
/** Minor scale marks between the labelled half hours. */
export const MINOR_TICK_MINUTES = 5;
/** Programs loaded per fetch, and how far the window grows when the canvas nears its end. */
export const GUIDE_SPAN_MINUTES = 360;

export interface GuideMetrics {
  pxPerMinute: number;
  rowHeight: number;
  channelColumnWidth: number;
  /** Phone: the column's width once dragged to the left magnet, a portrait channel card per row. */
  compactColumnWidth: number;
  rulerHeight: number;
  /** The channel card's padding inside its row slot. */
  cardInset: { vertical: number; horizontal: number };
}

/** A row is as tall as the channel card the column draws at its width: a wide slot inside the card's padding. */
export function guideMetrics(isTV: boolean): GuideMetrics {
  const channelColumnWidth = isTV ? 300 : 150;
  const padding = slotCardPadding(isTV);
  const rowHeight = Math.round((channelColumnWidth - 2 * padding) / GRID.LANDSCAPE_RATIO + 2 * padding);
  // The compact column holds a portrait card the row's own height, capping the row: padded on the left only.
  const compactColumnWidth = isTV ? channelColumnWidth : Math.round((rowHeight - 1) * GRID.PORTRAIT_RATIO + padding);
  // TV: a centred 3:2 card 7 narrower than the row's height less 8 above and below allows.
  const tvCardWidth = (rowHeight - 16) * GRID.LANDSCAPE_RATIO - 7;
  const cardInset = isTV ? { vertical: (rowHeight - tvCardWidth / GRID.LANDSCAPE_RATIO) / 2, horizontal: (channelColumnWidth - tvCardWidth) / 2 } : { vertical: padding, horizontal: padding };
  return isTV
    ? { pxPerMinute: 8, rowHeight, channelColumnWidth, compactColumnWidth, rulerHeight: 74, cardInset }
    : { pxPerMinute: 4, rowHeight, channelColumnWidth, compactColumnWidth, rulerHeight: 47, cardInset };
}

/** The window opens on the half hour the current time falls in. */
export function guideWindowStart(nowMs: number): number {
  const tick = TICK_MINUTES * MINUTE_MS;
  // Floored in local time: a 45-minute offset floored in UTC opens on :15 or :45.
  const offset = -new Date(nowMs).getTimezoneOffset() * MINUTE_MS;
  return Math.floor((nowMs + offset) / tick) * tick - offset;
}

export interface CellGeometry {
  left: number;
  width: number;
}

/** Where a program lands on the canvas, clipped to the window; null when it lies outside it. */
export function cellGeometry(startMs: number, endMs: number, windowStartMs: number, windowEndMs: number, metrics: GuideMetrics): CellGeometry | null {
  if (!(endMs > startMs) || endMs <= windowStartMs || startMs >= windowEndMs) return null;
  const from = Math.max(startMs, windowStartMs);
  const to = Math.min(endMs, windowEndMs);
  const left = ((from - windowStartMs) / MINUTE_MS) * metrics.pxPerMinute;
  const width = Math.max(1, ((to - from) / MINUTE_MS) * metrics.pxPerMinute);
  return { left, width };
}

/** A horizontal stretch of the canvas. */
export interface CanvasSpan {
  fromPx: number;
  toPx: number;
}

/** The cells mounted while the view's left edge is on `page`: a whole viewport past either edge of the view. */
export function mountSpanFor(page: number, viewportWidth: number): CanvasSpan {
  return { fromPx: (page - 1) * viewportWidth, toPx: (page + 3) * viewportWidth };
}

/**
 * TV row snap: a focused row lands as the list's lowest whole row. The bottom pad puts the list's end
 * exactly where its last row lands, so the end sits on the row grid the interval snap rounds to.
 */
export function rowSnap(listHeight: number, rowHeight: number): { offset: number; bottomPad: number } {
  const offset = Math.max(0, Math.floor((listHeight - rowHeight) / rowHeight)) * rowHeight;
  return { offset, bottomPad: Math.max(0, listHeight - rowHeight - offset) };
}

/** Where the grid scrolls so a cell begun left of the visible edge shows its start; the pinned label alone never asks for it. */
export function leftRevealOffset(cellLeft: number, scrollX: number): number | undefined {
  return cellLeft < scrollX ? cellLeft : undefined;
}

/** True when any part of the cell lies inside the span. */
export function cellInSpan(cell: CellGeometry, span: CanvasSpan): boolean {
  return cell.left + cell.width >= span.fromPx && cell.left <= span.toPx;
}

export interface RulerTick {
  left: number;
  atMs: number;
  isHour: boolean;
  /** A bare mark between the labelled half hours. */
  isMinor: boolean;
}

export function rulerTicks(windowStartMs: number, windowEndMs: number, metrics: GuideMetrics): RulerTick[] {
  const ticks: RulerTick[] = [];
  const step = MINOR_TICK_MINUTES * MINUTE_MS;
  for (let at = windowStartMs; at < windowEndMs; at += step) {
    const minutes = new Date(at).getMinutes();
    ticks.push({ left: ((at - windowStartMs) / MINUTE_MS) * metrics.pxPerMinute, atMs: at, isHour: minutes === 0, isMinor: minutes % TICK_MINUTES !== 0 });
  }
  return ticks;
}

export type ProgramCategory = "news" | "sports" | "kids" | "movie";

export function programCategory(program: Pick<JellyfinProgram, "IsNews" | "IsSports" | "IsKids" | "IsMovie">): ProgramCategory | null {
  if (program.IsSports) return "sports";
  if (program.IsNews) return "news";
  if (program.IsKids) return "kids";
  if (program.IsMovie) return "movie";
  return null;
}

export function programTimes(program: Pick<JellyfinProgram, "StartDate" | "EndDate">): { startMs: number; endMs: number } {
  return { startMs: Date.parse(program.StartDate ?? ""), endMs: Date.parse(program.EndDate ?? "") };
}

/** The cell a vertical move lands on: the one under the edge, else the first after it. */
export function cellAtEdge<T extends Pick<JellyfinProgram, "StartDate" | "EndDate">>(programs: T[], edgeMs: number): T | undefined {
  let next: T | undefined;
  for (const program of programs) {
    const { startMs, endMs } = programTimes(program);
    if (startMs <= edgeMs && edgeMs < endMs) return program;
    if (startMs > edgeMs && (!next || startMs < programTimes(next).startMs)) next = program;
  }
  return next ?? programs[programs.length - 1];
}

/** A timer still scheduled or recording. */
export function isActiveTimer(timer: Pick<JellyfinTimer, "Status">): boolean {
  return timer.Status !== "Cancelled" && timer.Status !== "Completed";
}

/**
 * The timer covering this target: a program's by id, else the channel's over the clock now. A program
 * no timer names falls back to a manual timer only (no ProgramId), over the program's span when known.
 */
export function activeRecordTimer(
  timers: JellyfinTimer[],
  target: { programId?: string; channelId: string; program?: Pick<JellyfinProgram, "StartDate" | "EndDate"> | null },
  nowMs: number,
): JellyfinTimer | null {
  const byProgram = target.programId ? timers.find((candidate) => candidate.ProgramId === target.programId && isActiveTimer(candidate)) : undefined;
  if (byProgram) return byProgram;
  const span = target.programId && target.program ? programTimes(target.program) : null;
  return (
    timers.find((candidate) => {
      if (candidate.ChannelId !== target.channelId || !isActiveTimer(candidate)) return false;
      if (target.programId && candidate.ProgramId) return false;
      const { startMs, endMs } = programTimes(candidate);
      if (span && Number.isFinite(span.startMs) && Number.isFinite(span.endMs)) return startMs < span.endMs && span.startMs < endMs;
      return startMs <= nowMs && nowMs < endMs;
    }) ?? null
  );
}

/** "2h", "1h 12m" or "45m" in the active language's units: the length a recording toast names. */
export function durationLabel(ms: number): string {
  const minutes = Math.round(ms / 60_000);
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours === 0) return t("common.durationMinutes").replace("{minutes}", String(rest));
  if (rest === 0) return t("common.durationHours").replace("{hours}", String(hours));
  return t("common.durationHoursMinutes").replace("{hours}", String(hours)).replace("{minutes}", String(rest));
}

export function isAiring(program: Pick<JellyfinProgram, "StartDate" | "EndDate">, nowMs: number): boolean {
  const { startMs, endMs } = programTimes(program);
  return startMs <= nowMs && nowMs < endMs;
}

export function formatClock(ms: number): string {
  return new Date(ms).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

/** "Today", "Tomorrow", else the weekday: the guide never spans further than a viewer scrolls. */
export function formatDayLabel(ms: number, nowMs: number, labels: { today: string; tomorrow: string }): string {
  const day = new Date(ms);
  const now = new Date(nowMs);
  const dayStart = new Date(day.getFullYear(), day.getMonth(), day.getDate()).getTime();
  const nowStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const diff = Math.round((dayStart - nowStart) / 86_400_000);
  if (diff === 0) return labels.today;
  if (diff === 1) return labels.tomorrow;
  return day.toLocaleDateString([], { weekday: "long" });
}

/** Id prefix of the stand-in cell a channel without guide data shows; select tunes, nothing else. */
export const NO_GUIDE_PREFIX = "no-guide:";

/** The channel a stand-in cell stands for, null for any other program id. */
export function standInChannelId(programId: string | undefined): string | null {
  return programId?.startsWith(NO_GUIDE_PREFIX) ? programId.slice(NO_GUIDE_PREFIX.length) : null;
}

/** Id prefix of a programme from the viewer's external XMLTV guide: not on the server, never fetched. */
export const EXTERNAL_GUIDE_PREFIX = "epg:";

/**
 * Replace the requested window with its successful response, including an empty one. Keep other
 * windows when extending the guide; the returned programmes alone cannot describe what was removed.
 */
export function mergePrograms(existing: readonly JellyfinProgram[] | undefined, incoming: readonly JellyfinProgram[], window: { from: number; to: number }): JellyfinProgram[] {
  const fresh = new Map(incoming.map((program) => [program.Id, program]));
  const kept = (existing ?? []).filter((program) => {
    if (fresh.has(program.Id)) return false;
    const { startMs, endMs } = programTimes(program);
    if (!Number.isFinite(endMs) || endMs <= startMs) return startMs < window.from || startMs >= window.to;
    return endMs <= window.from || startMs >= window.to;
  });
  return kept.concat(Array.from(fresh.values())).sort((a, b) => Date.parse(a.StartDate ?? "") - Date.parse(b.StartDate ?? ""));
}

/**
 * The channel one flip away, wrapping at the ends: +1 for the next channel, -1 for the previous.
 * Returns null when the id is not in the list or the list has fewer than two entries (nothing to
 * flip to). Pure, so the player's flip handler and its test share the one rule.
 */
export function adjacentChannelId<T extends { Id: string }>(channels: T[], currentId: string, direction: 1 | -1): string | null {
  if (channels.length < 2) return null;
  const index = channels.findIndex((channel) => channel.Id === currentId);
  if (index < 0) return null;
  const next = (index + direction + channels.length) % channels.length;
  return channels[next].Id;
}

/**
 * The ids the player shows around the playing channel: the previous one (a flip back), then it and up
 * to `ahead` after it, wrapping, each once. Just the playing channel until the lineup has it.
 */
export function channelWindow<T extends { Id: string }>(channels: readonly T[], currentId: string, ahead: number): string[] {
  const index = channels.findIndex((channel) => channel.Id === currentId);
  if (index < 0) return [currentId];
  const count = Math.min(channels.length, ahead + 1);
  const at = (offset: number) => channels[(index + offset + channels.length) % channels.length].Id;
  return [...new Set([at(-1), ...Array.from({ length: count }, (_, offset) => at(offset))])];
}
