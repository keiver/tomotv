import { fetchChannels, fetchGuidePrograms, fetchTimers } from "@/services/jellyfinApi";
import type { JellyfinItem, JellyfinProgram, JellyfinTimer } from "@/types/jellyfin";
import { GUIDE_SPAN_MINUTES, guideWindowStart, MINUTE_MS } from "@/utils/guide";
import { logger } from "@/utils/logger";
import { useIsFocused } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

/** Channels whose programs load per fetch; rows below wait until the list nears them. */
export const GUIDE_CHANNEL_PAGE = 40;

export interface GuideRow {
  channel: JellyfinItem;
  programs: JellyfinProgram[];
}

export interface GuideState {
  rows: GuideRow[];
  windowStartMs: number;
  windowEndMs: number;
  nowMs: number;
  /** Live timers by program id; a cell reads its recording state here, never off the program. */
  timersByProgramId: Map<string, JellyfinTimer>;
  isLoading: boolean;
  error: string | null;
  retry: () => void;
  /** Grow the window by one span; the canvas calls it as it nears the right edge. */
  extendWindow: () => void;
  /** Load programs for the next page of channels; the list calls it as it nears the bottom. */
  loadMoreRows: () => void;
  refreshTimers: () => void;
}

function mergePrograms(existing: JellyfinProgram[] | undefined, incoming: JellyfinProgram[]): JellyfinProgram[] {
  if (!existing || existing.length === 0) return incoming;
  const seen = new Set(existing.map((program) => program.Id));
  const merged = existing.concat(incoming.filter((program) => !seen.has(program.Id)));
  merged.sort((a, b) => Date.parse(a.StartDate ?? "") - Date.parse(b.StartDate ?? ""));
  return merged;
}

/**
 * The guide's data: every channel, programs for the loaded channels over the loaded window, and
 * the timers that mark recordings. The window opens on the current half hour and only grows.
 */
export function useGuide(): GuideState {
  const [channels, setChannels] = useState<JellyfinItem[]>([]);
  const [programsByChannel, setProgramsByChannel] = useState<Record<string, JellyfinProgram[]>>({});
  const [timers, setTimers] = useState<JellyfinTimer[]>([]);
  const [windowStartMs] = useState(() => guideWindowStart(Date.now()));
  const [windowEndMs, setWindowEndMs] = useState(() => windowStartMs + GUIDE_SPAN_MINUTES * MINUTE_MS);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  // How many channels have programs for the whole window; a page load and a window extension
  // both key off it, so neither can run twice for the same span.
  const loadedCountRef = useRef(0);
  const busyRef = useRef(false);
  const windowEndRef = useRef(windowEndMs);
  const channelsRef = useRef<JellyfinItem[]>([]);
  const isFocused = useIsFocused();

  const loadPrograms = useCallback(async (list: JellyfinItem[], startMs: number, endMs: number) => {
    if (list.length === 0) return;
    const programs = await fetchGuidePrograms({ channelIds: list.map((channel) => channel.Id), startMs, endMs });
    setProgramsByChannel((current) => {
      const next = { ...current };
      for (const channel of list) if (!next[channel.Id]) next[channel.Id] = [];
      for (const program of programs) {
        if (!program.ChannelId) continue;
        next[program.ChannelId] = mergePrograms(next[program.ChannelId], [program]);
      }
      return next;
    });
  }, []);

  const refreshTimers = useCallback(() => {
    fetchTimers()
      .then(setTimers)
      .catch((err) => logger.warn("Timers refresh failed", err, { hook: "useGuide" }));
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { items } = await fetchChannels();
        if (cancelled) return;
        channelsRef.current = items;
        setChannels(items);
        const firstPage = items.slice(0, GUIDE_CHANNEL_PAGE);
        await loadPrograms(firstPage, windowStartMs, windowEndRef.current);
        if (cancelled) return;
        loadedCountRef.current = firstPage.length;
        refreshTimers();
      } catch (err) {
        if (cancelled) return;
        logger.error("Guide load failed", err, { hook: "useGuide" });
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [attempt, loadPrograms, refreshTimers, windowStartMs]);

  // A minute tick moves the airing cells' progress and the ruler's now mark.
  useEffect(() => {
    const timer = setInterval(() => setNowMs(Date.now()), MINUTE_MS);
    return () => clearInterval(timer);
  }, []);

  // Coming back from the program panel: its record and cancel actions changed the timers.
  const wasFocusedRef = useRef(isFocused);
  useEffect(() => {
    if (isFocused && !wasFocusedRef.current && !isLoading) refreshTimers();
    wasFocusedRef.current = isFocused;
  }, [isFocused, isLoading, refreshTimers]);

  const loadMoreRows = useCallback(() => {
    if (busyRef.current || isLoading) return;
    const from = loadedCountRef.current;
    const page = channelsRef.current.slice(from, from + GUIDE_CHANNEL_PAGE);
    if (page.length === 0) return;
    busyRef.current = true;
    loadPrograms(page, windowStartMs, windowEndRef.current)
      .then(() => {
        loadedCountRef.current = from + page.length;
      })
      .catch((err) => logger.warn("Guide page load failed", err, { hook: "useGuide" }))
      .finally(() => {
        busyRef.current = false;
      });
  }, [isLoading, loadPrograms, windowStartMs]);

  const extendWindow = useCallback(() => {
    if (busyRef.current || isLoading) return;
    const from = windowEndRef.current;
    const to = from + GUIDE_SPAN_MINUTES * MINUTE_MS;
    const loaded = channelsRef.current.slice(0, loadedCountRef.current);
    busyRef.current = true;
    loadPrograms(loaded, from, to)
      .then(() => {
        windowEndRef.current = to;
        setWindowEndMs(to);
      })
      .catch((err) => logger.warn("Guide window extension failed", err, { hook: "useGuide" }))
      .finally(() => {
        busyRef.current = false;
      });
  }, [isLoading, loadPrograms]);

  const retry = useCallback(() => {
    setIsLoading(true);
    setError(null);
    setAttempt((n) => n + 1);
  }, []);

  const rows = useMemo<GuideRow[]>(() => channels.map((channel) => ({ channel, programs: programsByChannel[channel.Id] ?? [] })), [channels, programsByChannel]);

  const timersByProgramId = useMemo(() => {
    const map = new Map<string, JellyfinTimer>();
    for (const timer of timers) {
      if (!timer.ProgramId || timer.Status === "Cancelled") continue;
      map.set(timer.ProgramId, timer);
    }
    return map;
  }, [timers]);

  return { rows, windowStartMs, windowEndMs, nowMs, timersByProgramId, isLoading, error, retry, extendWindow, loadMoreRows, refreshTimers };
}
