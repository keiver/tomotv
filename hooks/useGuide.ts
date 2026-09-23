import { useLiveTvPreferences } from "@/hooks/useLiveTvPreferences";
import { fetchChannels, fetchGuidePrograms, fetchTimers } from "@/services/jellyfinApi";
import { channelSortParam, favoriteChannels } from "@/services/liveTvPreferences";
import type { JellyfinItem, JellyfinProgram, JellyfinTimer } from "@/types/jellyfin";
import { GUIDE_SPAN_MINUTES, guideWindowStart, isActiveTimer, MINUTE_MS } from "@/utils/guide";
import { logger } from "@/utils/logger";
import { useIsFocused } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

/** Channels per page: each page's programs load with it; the next page waits until the list nears it. */
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
  /** Load the next page of channels with their programs; the list calls it as it nears the bottom. */
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
 * The guide's data: channels a page at a time, each with its programs over the loaded window, and
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
  // Pages and window extensions take turns: both read the loaded channel list.
  const busyRef = useRef<"page" | "window" | null>(null);
  // A page asked for during an extension, or one that failed: the list's onEndReached will not ask again.
  const pagePendingRef = useRef(false);
  const windowEndRef = useRef(windowEndMs);
  const channelsRef = useRef<JellyfinItem[]>([]);
  // Channels the server has handed over, favorites or not: the next page starts after them.
  const loadedRef = useRef(0);
  // Whether the server has channels past the loaded ones: its total when it reports one, else a full page.
  const hasMoreRef = useRef(false);
  const isFocused = useIsFocused();
  const preferences = useLiveTvPreferences();
  const { sort, favoritesOnly } = preferences;
  // Only the favorites list matters, and only while the guide is held to it.
  const favorites = favoritesOnly ? preferences : null;
  // Read by the page loader instead of state: a chained page runs before the loading render commits.
  const loadingRef = useRef(true);
  const favoritesOnlyRef = useRef(favoritesOnly);
  const loadMoreRef = useRef<() => void>(() => {});
  // Bumped by every fresh load, so a page from the previous sort or filter lands nowhere.
  const generationRef = useRef(0);

  const applyPrograms = useCallback((list: JellyfinItem[], programs: JellyfinProgram[]) => {
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

  const loadPrograms = useCallback(
    async (list: JellyfinItem[], startMs: number, endMs: number) => {
      if (list.length === 0) return;
      applyPrograms(list, await fetchGuidePrograms({ channelIds: list.map((channel) => channel.Id), startMs, endMs }));
    },
    [applyPrograms],
  );

  /** The channel page at `startIndex`, held to the favorites when asked, and its programs over the loaded window. */
  const loadChannelPage = useCallback(
    async (startIndex: number) => {
      const { items: page, total } = await fetchChannels({ startIndex, limit: GUIDE_CHANNEL_PAGE, sortBy: channelSortParam(sort) });
      const loaded = startIndex + page.length;
      const hasMore = total !== undefined ? loaded < total : page.length >= GUIDE_CHANNEL_PAGE;
      const items = favorites ? favoriteChannels(favorites, page) : page;
      const programs = items.length > 0 ? await fetchGuidePrograms({ channelIds: items.map((channel) => channel.Id), startMs: windowStartMs, endMs: windowEndRef.current }) : [];
      return { items, programs, hasMore, pageLength: page.length };
    },
    [windowStartMs, sort, favorites],
  );

  const refreshTimers = useCallback(() => {
    fetchTimers()
      .then(setTimers)
      .catch((err) => logger.warn("Timers refresh failed", err, { hook: "useGuide" }));
  }, []);

  useEffect(() => {
    let cancelled = false;
    generationRef.current += 1;
    loadingRef.current = true;
    (async () => {
      try {
        const { items, programs, hasMore, pageLength } = await loadChannelPage(0);
        if (cancelled) return;
        hasMoreRef.current = hasMore;
        loadedRef.current = pageLength;
        channelsRef.current = items;
        setChannels(items);
        applyPrograms(items, programs);
        refreshTimers();
      } catch (err) {
        if (cancelled) return;
        logger.error("Guide load failed", err, { hook: "useGuide" });
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        if (!cancelled) {
          loadingRef.current = false;
          setIsLoading(false);
          // Favorites are the viewer's own list: the pages keep coming until every channel has been seen.
          if (favorites && hasMoreRef.current) loadMoreRef.current();
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [attempt, loadChannelPage, applyPrograms, refreshTimers, favorites]);

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
    if (loadingRef.current || !hasMoreRef.current) return;
    if (busyRef.current) {
      // A page already loading answers this request; an extension does not.
      if (busyRef.current === "window") pagePendingRef.current = true;
      return;
    }
    pagePendingRef.current = false;
    busyRef.current = "page";
    const generation = generationRef.current;
    loadChannelPage(loadedRef.current)
      .then(({ items, programs, hasMore, pageLength }) => {
        if (generationRef.current !== generation) return;
        hasMoreRef.current = hasMore;
        loadedRef.current += pageLength;
        if (items.length === 0) return;
        channelsRef.current = channelsRef.current.concat(items);
        setChannels(channelsRef.current);
        applyPrograms(items, programs);
      })
      .catch((err) => {
        pagePendingRef.current = true;
        logger.warn("Guide page load failed", err, { hook: "useGuide" });
      })
      .finally(() => {
        if (generationRef.current !== generation) return;
        busyRef.current = null;
        if (favoritesOnlyRef.current && hasMoreRef.current && !pagePendingRef.current) loadMoreRef.current();
      });
  }, [loadChannelPage, applyPrograms]);
  useEffect(() => {
    loadMoreRef.current = loadMoreRows;
    favoritesOnlyRef.current = favoritesOnly;
  }, [loadMoreRows, favoritesOnly]);

  const extendWindow = useCallback(() => {
    if (busyRef.current || isLoading) return;
    const from = windowEndRef.current;
    const to = from + GUIDE_SPAN_MINUTES * MINUTE_MS;
    busyRef.current = "window";
    loadPrograms(channelsRef.current, from, to)
      .then(() => {
        windowEndRef.current = to;
        setWindowEndMs(to);
      })
      .catch((err) => logger.warn("Guide window extension failed", err, { hook: "useGuide" }))
      .finally(() => {
        busyRef.current = null;
        if (pagePendingRef.current) loadMoreRows();
      });
  }, [isLoading, loadPrograms, loadMoreRows]);

  // The minute tick retries a page that failed.
  useEffect(() => {
    if (pagePendingRef.current) loadMoreRows();
  }, [nowMs, loadMoreRows]);

  const retry = useCallback(() => {
    setIsLoading(true);
    setError(null);
    setAttempt((n) => n + 1);
  }, []);

  const rows = useMemo<GuideRow[]>(() => channels.map((channel) => ({ channel, programs: programsByChannel[channel.Id] ?? [] })), [channels, programsByChannel]);

  const timersByProgramId = useMemo(() => {
    const map = new Map<string, JellyfinTimer>();
    for (const timer of timers) {
      if (!timer.ProgramId || !isActiveTimer(timer)) continue;
      map.set(timer.ProgramId, timer);
    }
    return map;
  }, [timers]);

  return { rows, windowStartMs, windowEndMs, nowMs, timersByProgramId, isLoading, error, retry, extendWindow, loadMoreRows, refreshTimers };
}
