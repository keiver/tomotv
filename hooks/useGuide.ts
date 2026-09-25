import { useLiveTvPreferences } from "@/hooks/useLiveTvPreferences";
import { usePlaylistChannelIds } from "@/hooks/useTunerGroups";
import { fetchChannels, fetchChannelsByIds, fetchGuidePrograms, fetchListedChannels, fetchTimers } from "@/services/jellyfinApi";
import { fetchExternalPrograms } from "@/services/externalGuide";
import { activeCategory, activeChannelList, channelSortParam, getLiveTvPreferences } from "@/services/liveTvPreferences";
import { fetchTunerData } from "@/services/jellyfin/tunerGroups";
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

type ChannelPage = { items: JellyfinItem[]; programs: JellyfinProgram[]; hasMore: boolean; pageLength: number };

/**
 * One fresh load of the list: a sort, a filter change or a retry starts another and retires this
 * one. Every page and extension holds the load it started under, so a superseded one settles nothing.
 */
interface GuideLoad {
  fetchPage: (startIndex: number) => Promise<ChannelPage>;
  retired: boolean;
  loading: boolean;
  /** Pages and window extensions take turns: both read the loaded channel list. */
  busy: "page" | "window" | null;
  /** A page asked for during an extension, or one that failed: the list's onEndReached will not ask again. */
  pagePending: boolean;
  /** Channels the server has handed over, listed or not: the next page starts after them. */
  loaded: number;
  /** Past the loaded ones: the server's total when it reports one, else a full page. */
  hasMore: boolean;
}

/** Before the first load and after unmount: nothing may start. */
const RETIRED_LOAD: GuideLoad = { fetchPage: () => Promise.reject(new Error("retired")), retired: true, loading: true, busy: null, pagePending: false, loaded: 0, hasMore: false };

/** The next page of `load`, landed by `land`. */
function loadNextPage(load: GuideLoad, land: (items: JellyfinItem[], programs: JellyfinProgram[]) => void): void {
  if (load.retired || load.loading || !load.hasMore) return;
  if (load.busy) {
    // A page already loading answers this request; an extension does not.
    if (load.busy === "window") load.pagePending = true;
    return;
  }
  load.pagePending = false;
  load.busy = "page";
  load
    .fetchPage(load.loaded)
    .then(({ items, programs, hasMore, pageLength }) => {
      if (load.retired) return;
      load.hasMore = hasMore;
      load.loaded += pageLength;
      if (items.length > 0) land(items, programs);
    })
    .catch((err) => {
      load.pagePending = true;
      logger.warn("Guide page load failed", err, { hook: "useGuide" });
    })
    .finally(() => {
      load.busy = null;
    });
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
  const windowEndRef = useRef(windowEndMs);
  const channelsRef = useRef<JellyfinItem[]>([]);
  const loadRef = useRef<GuideLoad>(RETIRED_LOAD);
  const isFocused = useIsFocused();
  const preferences = useLiveTvPreferences();
  const { sort } = preferences;
  // The list alone, not the preferences object: toggling Auto update must not reload the guide.
  const list = activeChannelList(preferences);
  const category = activeCategory(preferences.filter);
  const playlistIds = usePlaylistChannelIds(preferences.filter);

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

  /** Server programs for the page; channels the server has none for fall back to the external guide:
   *  the viewer's URL, or the first guide the playlist itself declares (x-tvg-url / url-tvg). */
  const fetchPrograms = useCallback(async (list: JellyfinItem[], startMs: number, endMs: number) => {
    if (list.length === 0) return [];
    const programs = await fetchGuidePrograms({ channelIds: list.map((channel) => channel.Id), startMs, endMs });
    const covered = new Set(programs.map((program) => program.ChannelId));
    const bare = list.filter((channel) => !covered.has(channel.Id));
    if (bare.length === 0) return programs;
    const data = await fetchTunerData().catch(() => null);
    const url = getLiveTvPreferences().guideUrl || data?.tvgUrls[0] || "";
    if (!url || !data) return programs;
    const wanted = bare.flatMap((channel) => (data.tvgById[channel.Id] ? [{ channelId: channel.Id, tvgId: data.tvgById[channel.Id] }] : []));
    return programs.concat(await fetchExternalPrograms(url, wanted, { from: startMs, to: endMs }));
  }, []);

  const loadPrograms = useCallback(
    async (list: JellyfinItem[], startMs: number, endMs: number) => {
      if (list.length === 0) return;
      applyPrograms(list, await fetchPrograms(list, startMs, endMs));
    },
    [applyPrograms, fetchPrograms],
  );

  /** The channel page at `startIndex`, held to the filter's list or category, and its programs over the loaded window. */
  const loadChannelPage = useCallback(
    async (startIndex: number) => {
      if (Array.isArray(playlistIds)) {
        // Slices whose ids the server does not know come back empty; keep going until items or the end.
        let consumed = 0;
        let items: JellyfinItem[] = [];
        while (items.length === 0 && startIndex + consumed < playlistIds.length) {
          const slice = playlistIds.slice(startIndex + consumed, startIndex + consumed + GUIDE_CHANNEL_PAGE);
          items = await fetchChannelsByIds(slice);
          consumed += slice.length;
        }
        const programs = await fetchPrograms(items, windowStartMs, windowEndRef.current);
        return { items, programs, hasMore: startIndex + consumed < playlistIds.length, pageLength: consumed };
      }
      // A list is fetched by its entries in one page: a catalog can hold thousands of channels.
      if (list) {
        const items = await fetchListedChannels(list);
        const programs = await fetchPrograms(items, windowStartMs, windowEndRef.current);
        return { items, programs, hasMore: false, pageLength: items.length };
      }
      const { items, total } = await fetchChannels({ startIndex, limit: GUIDE_CHANNEL_PAGE, sortBy: channelSortParam(sort), ...(category ? { category } : {}) });
      const loaded = startIndex + items.length;
      const hasMore = total !== undefined ? loaded < total : items.length >= GUIDE_CHANNEL_PAGE;
      const programs = await fetchPrograms(items, windowStartMs, windowEndRef.current);
      return { items, programs, hasMore, pageLength: items.length };
    },
    [windowStartMs, sort, list, category, playlistIds, fetchPrograms],
  );

  const refreshTimers = useCallback(() => {
    fetchTimers()
      .then(setTimers)
      .catch((err) => logger.warn("Timers refresh failed", err, { hook: "useGuide" }));
  }, []);

  const landPage = useCallback(
    (items: JellyfinItem[], programs: JellyfinProgram[]) => {
      channelsRef.current = channelsRef.current.concat(items);
      setChannels(channelsRef.current);
      applyPrograms(items, programs);
    },
    [applyPrograms],
  );
  const loadMoreRows = useCallback(() => loadNextPage(loadRef.current, landPage), [landPage]);

  useEffect(() => {
    const load: GuideLoad = { fetchPage: loadChannelPage, retired: false, loading: true, busy: null, pagePending: false, loaded: 0, hasMore: false };
    loadRef.current = load;
    // The ids still loading: the returned isLoading covers it without a state write.
    if (playlistIds === "loading") {
      return () => {
        load.retired = true;
      };
    }
    (async () => {
      try {
        const { items, programs, hasMore, pageLength } = await loadChannelPage(0);
        if (load.retired) return;
        load.hasMore = hasMore;
        load.loaded = pageLength;
        channelsRef.current = items;
        setChannels(items);
        applyPrograms(items, programs);
        refreshTimers();
      } catch (err) {
        if (load.retired) return;
        logger.error("Guide load failed", err, { hook: "useGuide" });
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        if (!load.retired) {
          load.loading = false;
          setIsLoading(false);
        }
      }
    })();
    return () => {
      load.retired = true;
    };
  }, [attempt, loadChannelPage, applyPrograms, refreshTimers, playlistIds]);

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

  const extendWindow = useCallback(() => {
    const load = loadRef.current;
    if (load.retired || load.loading || load.busy) return;
    const from = windowEndRef.current;
    const to = from + GUIDE_SPAN_MINUTES * MINUTE_MS;
    load.busy = "window";
    loadPrograms(channelsRef.current, from, to)
      .then(() => {
        // A list loaded since holds programs up to the old edge only; the window stays there for it.
        if (load.retired) return;
        windowEndRef.current = to;
        setWindowEndMs(to);
      })
      .catch((err) => logger.warn("Guide window extension failed", err, { hook: "useGuide" }))
      .finally(() => {
        load.busy = null;
        if (!load.retired && load.pagePending) loadMoreRows();
      });
  }, [loadPrograms, loadMoreRows]);

  // The minute tick retries a page that failed.
  useEffect(() => {
    if (loadRef.current.pagePending) loadMoreRows();
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

  return { rows, windowStartMs, windowEndMs, nowMs, timersByProgramId, isLoading: isLoading || playlistIds === "loading", error, retry, extendWindow, loadMoreRows, refreshTimers };
}
