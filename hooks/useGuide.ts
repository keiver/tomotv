import { useAuthSession } from "@/hooks/useAuthSession";
import { useLiveTvPreferences } from "@/hooks/useLiveTvPreferences";
import { usePlaylistChannelIds } from "@/hooks/useTunerGroups";
import { useHealthGeneration } from "@/hooks/useChannelHealth";
import { healthFor } from "@/services/channelHealth";
import { fetchChannels, fetchChannelsByIds, fetchGuidePrograms, fetchListedChannels, fetchTimers } from "@/services/jellyfinApi";
import { activeGuideUrls, fetchExternalPrograms } from "@/services/externalGuide";
import { activeCategory, activeChannelList, channelSortParam, getLiveTvPreferences } from "@/services/liveTvPreferences";
import { fetchTunerData } from "@/services/jellyfin/tunerGroups";
import type { JellyfinItem, JellyfinProgram, JellyfinTimer } from "@/types/jellyfin";
import { activeRecordTimer, GUIDE_SPAN_MINUTES, guideWindowStart, isActiveTimer, mergePrograms, MINUTE_MS } from "@/utils/guide";
import { logger } from "@/utils/logger";
import { useIsFocused } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AppState } from "react-native";

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
  /** Channels a timer covers right now; their cards wear REC. */
  recordingChannelIds: Set<string>;
  isLoading: boolean;
  /** True while programs are being fetched; the HUD shows its thin bar for it. */
  isUpdating: boolean;
  error: string | null;
  retry: () => void;
  /** Grow the window by one span; the canvas calls it as it nears the right edge. */
  extendWindow: () => void;
  /** Load the next page of channels with their programs; the list calls it as it nears the bottom. */
  loadMoreRows: () => void;
  refreshTimers: () => void;
}

type ChannelPage = { hasMore: boolean; pageLength: number };

/** Lands a page in two steps: channels as soon as they are known, programs when they arrive. */
type PageLand = { channels: (items: JellyfinItem[]) => void; programs: (items: JellyfinItem[], programs: JellyfinProgram[]) => void };

/**
 * One fresh load of the list: a sort, a filter change or a retry starts another and retires this
 * one. Every page and extension holds the load it started under, so a superseded one settles nothing.
 */
interface GuideLoad {
  fetchPage: (startIndex: number, land: PageLand) => Promise<ChannelPage>;
  /** This load's own landings, each held to it: a superseded load's pages settle nothing. */
  land: PageLand;
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
const RETIRED_LOAD: GuideLoad = {
  fetchPage: () => Promise.reject(new Error("retired")),
  land: { channels: () => {}, programs: () => {} },
  retired: true,
  loading: true,
  busy: null,
  pagePending: false,
  loaded: 0,
  hasMore: false,
};

/** The next page of `load`; the page lands itself through the load's own landings. */
function loadNextPage(load: GuideLoad): void {
  if (load.retired || load.loading || !load.hasMore) return;
  if (load.busy) {
    // A page already loading answers this request; an extension does not.
    if (load.busy === "window") load.pagePending = true;
    return;
  }
  load.pagePending = false;
  load.busy = "page";
  load
    .fetchPage(load.loaded, load.land)
    .then(({ hasMore, pageLength }) => {
      if (load.retired) return;
      load.hasMore = hasMore;
      load.loaded += pageLength;
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
  const [windowStartMs, setWindowStartMs] = useState(() => guideWindowStart(Date.now()));
  const [windowEndMs, setWindowEndMs] = useState(() => windowStartMs + GUIDE_SPAN_MINUTES * MINUTE_MS);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [isLoading, setIsLoading] = useState(true);
  const [pendingPrograms, setPendingPrograms] = useState(0);
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
  // Another sign-in starts over: channel ids repeat across servers, so no program may merge into the last one's rows.
  const session = useAuthSession();
  const [rowsSession, setRowsSession] = useState(session);
  if (rowsSession !== session) {
    setRowsSession(session);
    setChannels([]);
    setProgramsByChannel({});
    setTimers([]);
    setError(null);
    setIsLoading(true);
    const start = guideWindowStart(nowMs);
    setWindowStartMs(start);
    setWindowEndMs(start + GUIDE_SPAN_MINUTES * MINUTE_MS);
  }

  const applyPrograms = useCallback((list: JellyfinItem[], programs: JellyfinProgram[]) => {
    setProgramsByChannel((current) => {
      const next = { ...current };
      for (const channel of list) if (!next[channel.Id]) next[channel.Id] = [];
      const byChannel = new Map<string, JellyfinProgram[]>();
      for (const program of programs) {
        if (program.ChannelId) byChannel.set(program.ChannelId, [...(byChannel.get(program.ChannelId) ?? []), program]);
      }
      for (const [channelId, incoming] of byChannel) next[channelId] = mergePrograms(next[channelId], incoming);
      return next;
    });
  }, []);

  /** Server programs for the page; channels the server has none for fall back to the external
   *  guides: the viewer's own, then the ones the tuner playlists declare. */
  const fetchPrograms = useCallback(async (list: JellyfinItem[], startMs: number, endMs: number) => {
    if (list.length === 0) return [];
    setPendingPrograms((count) => count + 1);
    try {
      const programs = await fetchGuidePrograms({ channelIds: list.map((channel) => channel.Id), startMs, endMs });
      const covered = new Set(programs.map((program) => program.ChannelId));
      const bare = list.filter((channel) => !covered.has(channel.Id));
      if (bare.length === 0) return programs;
      // No M3U tuner (or a read it refused) still leaves the viewer's guides, matched by name.
      const data = await fetchTunerData().catch(() => null);
      const urls = activeGuideUrls(getLiveTvPreferences(), data?.tvgUrls ?? []);
      if (urls.length === 0) return programs;
      const wanted = bare.map((channel) => ({ channelId: channel.Id, tvgId: data?.tvgById[channel.Id], tvgName: data?.tvgNameById[channel.Id], name: channel.Name ?? "" }));
      return programs.concat(await fetchExternalPrograms(urls, wanted, { from: startMs, to: endMs }));
    } finally {
      setPendingPrograms((count) => count - 1);
    }
  }, []);

  const loadPrograms = useCallback(
    async (list: JellyfinItem[], startMs: number, endMs: number, load: GuideLoad) => {
      if (list.length === 0) return;
      load.land.programs(list, await fetchPrograms(list, startMs, endMs));
    },
    [fetchPrograms],
  );

  /** The channel page at `startIndex`, held to the filter's list or category. Channels land as
   *  soon as they are known, so the grid renders while the page's programs load behind it. */
  const loadChannelPage = useCallback(
    async (startIndex: number, land: PageLand) => {
      if (Array.isArray(playlistIds)) {
        // Slices whose ids the server does not know come back empty; keep going until items or the end.
        let consumed = 0;
        let items: JellyfinItem[] = [];
        while (items.length === 0 && startIndex + consumed < playlistIds.length) {
          const slice = playlistIds.slice(startIndex + consumed, startIndex + consumed + GUIDE_CHANNEL_PAGE);
          items = await fetchChannelsByIds(slice);
          consumed += slice.length;
        }
        land.channels(items);
        land.programs(items, await fetchPrograms(items, windowStartMs, windowEndRef.current));
        return { hasMore: startIndex + consumed < playlistIds.length, pageLength: consumed };
      }
      // A list is fetched by its entries in one page: a catalog can hold thousands of channels.
      if (list) {
        const items = await fetchListedChannels(list);
        land.channels(items);
        land.programs(items, await fetchPrograms(items, windowStartMs, windowEndRef.current));
        return { hasMore: false, pageLength: items.length };
      }
      const { items, total } = await fetchChannels({ startIndex, limit: GUIDE_CHANNEL_PAGE, sortBy: channelSortParam(sort), ...(category ? { category } : {}) });
      const loaded = startIndex + items.length;
      const hasMore = total !== undefined ? loaded < total : items.length >= GUIDE_CHANNEL_PAGE;
      land.channels(items);
      land.programs(items, await fetchPrograms(items, windowStartMs, windowEndRef.current));
      return { hasMore, pageLength: items.length };
    },
    [windowStartMs, sort, list, category, playlistIds, fetchPrograms],
  );

  const refreshTimers = useCallback(() => {
    fetchTimers()
      .then(setTimers)
      .catch((err) => logger.warn("Timers refresh failed", err, { hook: "useGuide" }));
  }, []);

  /** A load's landings: its first page replaces the list, later pages append the new channels. */
  const landFor = useCallback(
    (load: GuideLoad): PageLand => ({
      channels: (items) => {
        if (load.retired) return;
        if (load.loaded === 0) channelsRef.current = items;
        else {
          const seen = new Set(channelsRef.current.map((channel) => channel.Id));
          channelsRef.current = channelsRef.current.concat(items.filter((channel) => !seen.has(channel.Id)));
        }
        setChannels(channelsRef.current);
      },
      programs: (items, programs) => {
        if (!load.retired) applyPrograms(items, programs);
      },
    }),
    [applyPrograms],
  );
  const loadMoreRows = useCallback(() => loadNextPage(loadRef.current), []);

  useEffect(() => {
    channelsRef.current = [];
    windowEndRef.current = windowStartMs + GUIDE_SPAN_MINUTES * MINUTE_MS;
  }, [session, windowStartMs]);

  useEffect(() => {
    const load: GuideLoad = { fetchPage: loadChannelPage, land: RETIRED_LOAD.land, retired: false, loading: true, busy: null, pagePending: false, loaded: 0, hasMore: false };
    load.land = landFor(load);
    loadRef.current = load;
    // The ids still loading: the returned isLoading covers it without a state write.
    if (playlistIds === "loading") {
      return () => {
        load.retired = true;
      };
    }
    (async () => {
      try {
        const { hasMore, pageLength } = await loadChannelPage(0, load.land);
        if (load.retired) return;
        load.hasMore = hasMore;
        load.loaded = pageLength;
        refreshTimers();
      } catch (err) {
        if (load.retired) return;
        logger.error("Guide load failed", err, { hook: "useGuide" });
        setError(err instanceof Error ? err.message : String(err));
        // The minute tick retries the page; channels already landed keep their rows meanwhile.
        load.hasMore = true;
        load.pagePending = true;
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
  }, [attempt, session, loadChannelPage, landFor, refreshTimers, playlistIds]);

  // Ticks on the clock's minute boundaries, rescheduled each time so the ruler's now mark lands on :00.
  // Timers stall while the app is suspended, so a return to the foreground resyncs at once.
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const tick = () => {
      clearTimeout(timer);
      setNowMs(Date.now());
      timer = setTimeout(tick, MINUTE_MS - (Date.now() % MINUTE_MS));
    };
    timer = setTimeout(tick, MINUTE_MS - (Date.now() % MINUTE_MS));
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") tick();
    });
    return () => {
      clearTimeout(timer);
      subscription.remove();
    };
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
    loadPrograms(channelsRef.current, from, to, load)
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

  // Hide offline narrows to channels whose health check concluded down; unchecked ones stay.
  const { hideOffline } = preferences;
  const healthGen = useHealthGeneration(hideOffline);
  const rows = useMemo<GuideRow[]>(() => {
    const listed = hideOffline ? channels.filter((channel) => healthFor(channel.Id) !== "down") : channels;
    return listed.map((channel) => ({ channel, programs: programsByChannel[channel.Id] ?? [] }));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- healthGen re-filters when any verdict moves
  }, [channels, programsByChannel, hideOffline, healthGen]);

  const timersByProgramId = useMemo(() => {
    const map = new Map<string, JellyfinTimer>();
    for (const timer of timers) {
      if (!timer.ProgramId || !isActiveTimer(timer)) continue;
      map.set(timer.ProgramId, timer);
    }
    return map;
  }, [timers]);
  const recordingChannelIds = useMemo(() => new Set(channels.filter((channel) => activeRecordTimer(timers, { channelId: channel.Id }, nowMs)).map((channel) => channel.Id)), [channels, timers, nowMs]);

  return {
    rows,
    windowStartMs,
    windowEndMs,
    nowMs,
    timersByProgramId,
    recordingChannelIds,
    isLoading: isLoading || playlistIds === "loading",
    isUpdating: pendingPrograms > 0,
    error,
    retry,
    extendWindow,
    loadMoreRows,
    refreshTimers,
  };
}
