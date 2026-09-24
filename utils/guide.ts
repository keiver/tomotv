/**
 * Guide geometry: time to pixels, cells clipped to the loaded window, ruler ticks. Pure, so the
 * canvas and its tests share one source of truth.
 */
import { GRID, slotCardPadding } from "@/constants/app";
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
}

/** A row is as tall as the channel card the column draws at its width: a wide slot inside the card's padding. */
export function guideMetrics(isTV: boolean): GuideMetrics {
  const channelColumnWidth = isTV ? 300 : 150;
  const padding = slotCardPadding(isTV);
  const rowHeight = Math.round((channelColumnWidth - 2 * padding) / GRID.LANDSCAPE_RATIO + 2 * padding);
  // The compact column holds a portrait card the row's own height, capping the row: padded on the left only.
  const compactColumnWidth = isTV ? channelColumnWidth : Math.round((rowHeight - 1) * GRID.PORTRAIT_RATIO + padding);
  return isTV ? { pxPerMinute: 8, rowHeight, channelColumnWidth, compactColumnWidth, rulerHeight: 56 } : { pxPerMinute: 4, rowHeight, channelColumnWidth, compactColumnWidth, rulerHeight: 36 };
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

/** How far a cell's label slides right so it stays on the visible edge as the canvas scrolls. Runs on the UI thread. */
export function labelPin(scrollX: number, cellLeft: number, cellWidth: number, labelWidth: number): number {
  "worklet";
  return Math.min(Math.max(0, scrollX - cellLeft), Math.max(0, cellWidth - labelWidth));
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
