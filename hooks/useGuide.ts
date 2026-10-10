import { useAuthSession } from "@/hooks/useAuthSession";
import { useLiveTvPreferences } from "@/hooks/useLiveTvPreferences";
import { usePlaylistChannelIds } from "@/hooks/useTunerGroups";
import { useHealthGeneration } from "@/hooks/useChannelHealth";
import { healthFor } from "@/services/channelHealth";
import { fetchChannels, fetchChannelsByIds, fetchGuideHorizon, fetchGuidePrograms, fetchListedChannels, fetchTimers } from "@/services/jellyfinApi";
import { reportRecordingTimers } from "@/services/recordingStatus";
import { activeGuideUrls, fetchExternalProgramWindow } from "@/services/externalGuide";
import { activeCategory, activeChannelList, channelSortParam, getLiveTvPreferences, type LiveTvPreferences } from "@/services/liveTvPreferences";
import { fetchTunerData } from "@/services/jellyfin/tunerGroups";
import type { JellyfinItem, JellyfinProgram, JellyfinTimer } from "@/types/jellyfin";
import {
  activeRecordTimer,
  dayHasListings,
  dayStartMs,
  EXTERNAL_GUIDE_PREFIX,
  GUIDE_SPAN_MINUTES,
  guideDays,
  guideDayWindow,
  isActiveTimer,
  keepRange,
  mergePrograms,
  MINUTE_MS,
  programTimes,
  trimPrograms,
} from "@/utils/guide";
import { logger } from "@/utils/logger";
import { useIsFocused } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AppState } from "react-native";

/** Channels per page: each page's programs load with it; the next page waits until the list nears it. */
export const GUIDE_CHANNEL_PAGE = 40;
/** One list for every row still waiting on its programs: a fresh one per rebuild re-renders the row. */
const NO_PROGRAMS: JellyfinProgram[] = [];

/** The external guide choices a program load read: the viewer's guides and the ones turned off. */
function guideSourcesKey(preferences: Pick<LiveTvPreferences, "guideUrls" | "guideSourcesOff">): string {
  return JSON.stringify([preferences.guideUrls, preferences.guideSourcesOff]);
}

export interface GuideRow {
  channel: JellyfinItem;
  programs: JellyfinProgram[];
}

/** One day the strip offers; null listings until the server has said where its guide ends. */
export interface GuideDay {
  startMs: number;
  hasListings: boolean | null;
}

export interface GuideState {
  rows: GuideRow[];
  windowStartMs: number;
  windowEndMs: number;
  nowMs: number;
  /** Today and the days after it, with whether each has listings. */
  days: GuideDay[];
  /** The picked day's local midnight. */
  selectedDayMs: number;
  /** Opens the guide on a day: today from the current half hour, another day from its midnight. */
  selectDay: (dayMs: number) => void;
  /** Live timers by program id; a cell reads its recording state here, never off the program. */
  timersByProgramId: Map<string, JellyfinTimer>;
  /** Channels a timer covers right now; their cards wear REC. */
  recordingChannelIds: Set<string>;
  isLoading: boolean;
  /** True while programs are being fetched; the refresh cell drops presses and spins. */
  isUpdating: boolean;
  error: string | null;
  retry: () => void;
  /** The canvas names the stretch it needs: the window loads to cover it up to the horizon, then lets go of what lies GUIDE_KEEP_SPANS spans past it. */
  holdWindow: (needFromMs: number, needToMs: number) => void;
  /** Load the next page of channels with their programs; the list calls it as it nears the bottom. */
  loadMoreRows: () => void;
  refreshTimers: () => void;
}

type ChannelPage = { hasMore: boolean; pageLength: number };

/** Lands a page in two steps: channels as soon as they are known, programs when they arrive. */
type PageLand = { channels: (items: JellyfinItem[]) => void; programs: (items: JellyfinItem[], programs: JellyfinProgram[], window: { from: number; to: number }) => void };

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
 * The guide's data: channels a page at a time, each with its programs over the loaded stretch, and
 * the timers that mark recordings. The window opens on the current half hour; its loaded stretch follows the view.
 */
export function useGuide(): GuideState {
  const [channels, setChannels] = useState<JellyfinItem[]>([]);
  const [programsByChannel, setProgramsByChannel] = useState<Record<string, JellyfinProgram[]>>({});
  const [timers, setTimers] = useState<JellyfinTimer[]>([]);
  // The picked day: its window start, and the horizon nothing loads or scrolls past.
  const [day, setDay] = useState(() => {
    const now = Date.now();
    return { dayMs: dayStartMs(now), ...guideDayWindow(dayStartMs(now), now) };
  });
  const [windowStartMs, setWindowStartMs] = useState(day.startMs);
  const [windowEndMs, setWindowEndMs] = useState(() => windowStartMs + GUIDE_SPAN_MINUTES * MINUTE_MS);
  const [nowMs, setNowMs] = useState(() => Date.now());
  // Where the server's guide ends and the days loaded listings fell on: the strip's availability marks.
  const [guideEndMs, setGuideEndMs] = useState<number | null>(null);
  const [coveredDays, setCoveredDays] = useState<ReadonlySet<number>>(() => new Set());
  const [externalGuides, setExternalGuides] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [pendingPrograms, setPendingPrograms] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const windowEndRef = useRef(windowEndMs);
  /** Where the loaded listings begin: the window's start until the view moves far enough right to let it go. */
  const loadedStartRef = useRef(windowStartMs);
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
    setGuideEndMs(null);
    setCoveredDays(new Set());
    setExternalGuides(false);
    const today = { dayMs: dayStartMs(nowMs), ...guideDayWindow(dayStartMs(nowMs), nowMs) };
    setDay(today);
    setWindowStartMs(today.startMs);
    setWindowEndMs(today.startMs + GUIDE_SPAN_MINUTES * MINUTE_MS);
  }
  // Another group opens at the window's start, where the canvas rewinds to.
  const [rowsFilter, setRowsFilter] = useState(preferences.filter);
  if (rowsFilter !== preferences.filter) {
    setRowsFilter(preferences.filter);
    setWindowEndMs(windowStartMs + GUIDE_SPAN_MINUTES * MINUTE_MS);
  }

  const applyPrograms = useCallback((list: JellyfinItem[], programs: JellyfinProgram[], window: { from: number; to: number }) => {
    // A program landing on a day proves the day has listings, whichever guide it came from.
    setCoveredDays((current) => {
      let next: Set<number> | null = null;
      for (const program of programs) {
        const dayMs = program.StartDate ? dayStartMs(Date.parse(program.StartDate)) : NaN;
        if (Number.isNaN(dayMs) || current.has(dayMs) || next?.has(dayMs)) continue;
        (next ??= new Set(current)).add(dayMs);
      }
      return next ?? current;
    });
    setProgramsByChannel((current) => {
      const next = { ...current };
      const byChannel = new Map<string, JellyfinProgram[]>();
      for (const program of programs) {
        if (program.ChannelId) byChannel.set(program.ChannelId, [...(byChannel.get(program.ChannelId) ?? []), program]);
      }
      for (const channel of list) next[channel.Id] = mergePrograms(next[channel.Id], byChannel.get(channel.Id) ?? [], window);
      return next;
    });
  }, []);

  /** Server programs for the page; channels the server has none for fall back to the external
   *  guides: the viewer's own, then the ones the tuner playlists declare. */
  const fetchPrograms = useCallback(async (list: JellyfinItem[], startMs: number, endMs: number) => {
    if (list.length === 0) return { channels: list, programs: [] };
    const preferences = getLiveTvPreferences();
    setPendingPrograms((count) => count + 1);
    try {
      const programs = await fetchGuidePrograms({ channelIds: list.map((channel) => channel.Id), startMs, endMs });
      if (guideSourcesKey(getLiveTvPreferences()) !== guideSourcesKey(preferences)) return null;
      const covered = new Set(programs.map((program) => program.ChannelId));
      const bare = list.filter((channel) => !covered.has(channel.Id));
      if (bare.length === 0) return { channels: list, programs };
      // No M3U tuner (or a read it refused) still leaves the viewer's guides, matched by name.
      const data = await fetchTunerData().catch(() => null);
      if (guideSourcesKey(getLiveTvPreferences()) !== guideSourcesKey(preferences)) return null;
      const urls = activeGuideUrls(preferences, data?.tvgUrls ?? []);
      if (urls.length === 0) return { channels: data ? list : list.filter((channel) => covered.has(channel.Id)), programs };
      const wanted = bare.map((channel) => ({ channelId: channel.Id, tvgId: data?.tvgById[channel.Id], tvgName: data?.tvgNameById[channel.Id], name: channel.Name ?? "" }));
      const external = await fetchExternalProgramWindow(urls, wanted, { from: startMs, to: endMs });
      // Sources changed while these loaded: the reload that change started answers for them instead.
      if (guideSourcesKey(getLiveTvPreferences()) !== guideSourcesKey(preferences)) return null;
      const failed = new Set(external.failedChannelIds);
      if (!data) {
        const externallyCovered = new Set(external.programs.map((program) => program.ChannelId));
        for (const channel of bare) if (!externallyCovered.has(channel.Id)) failed.add(channel.Id);
      }
      return { channels: list.filter((channel) => !failed.has(channel.Id)), programs: programs.concat(external.programs) };
    } finally {
      setPendingPrograms((count) => count - 1);
    }
  }, []);

  /** False when a guide source change discarded the programs. */
  const loadPrograms = useCallback(
    async (list: JellyfinItem[], startMs: number, endMs: number, load: GuideLoad): Promise<boolean> => {
      if (list.length === 0) return true;
      const result = await fetchPrograms(list, startMs, endMs);
      if (result === null) return false;
      load.land.programs(result.channels, result.programs, { from: startMs, to: endMs });
      return true;
    },
    [fetchPrograms],
  );

  /** The channel page at `startIndex`, held to the filter's list or category. Channels land as
   *  soon as they are known, so the grid renders while the page's programs load behind it. */
  const loadChannelPage = useCallback(
    async (startIndex: number, land: PageLand) => {
      const window = { from: loadedStartRef.current, to: windowEndRef.current };
      const landPrograms = async (items: JellyfinItem[]) => {
        const result = await fetchPrograms(items, window.from, window.to);
        if (result !== null) land.programs(result.channels, result.programs, window);
      };
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
        await landPrograms(items);
        return { hasMore: startIndex + consumed < playlistIds.length, pageLength: consumed };
      }
      // A list is fetched by its entries in one page: a catalog can hold thousands of channels.
      if (list) {
        const items = await fetchListedChannels(list);
        land.channels(items);
        await landPrograms(items);
        return { hasMore: false, pageLength: items.length };
      }
      const { items, total } = await fetchChannels({ startIndex, limit: GUIDE_CHANNEL_PAGE, sortBy: channelSortParam(sort), ...(category ? { category } : {}) });
      const loaded = startIndex + items.length;
      const hasMore = total !== undefined ? loaded < total : items.length >= GUIDE_CHANNEL_PAGE;
      land.channels(items);
      await landPrograms(items);
      return { hasMore, pageLength: items.length };
    },
    [sort, list, category, playlistIds, fetchPrograms],
  );

  const sessionRef = useRef(session);
  useEffect(() => {
    sessionRef.current = session;
  }, [session]);
  // The last sign-in's timers landing late would put REC on this server's channels of the same id.
  const refreshTimers = useCallback(() => {
    fetchTimers()
      .then((timers) => {
        if (sessionRef.current !== session) return;
        reportRecordingTimers(timers);
        // The clock moves with the timers: a recording started since the last minute tick is on already.
        setNowMs(Date.now());
        setTimers(timers);
      })
      .catch((err) => logger.warn("Timers refresh failed", err, { hook: "useGuide" }));
  }, [session]);

  /** A load's landings: its first page replaces the list, later pages append the new channels. */
  const landFor = useCallback(
    (load: GuideLoad): PageLand => ({
      channels: (items) => {
        if (load.retired) return;
        if (load.loaded === 0) {
          channelsRef.current = items;
          // Listings of channels the new list does not hold go with the old one.
          const held = new Set(items.map((channel) => channel.Id));
          setProgramsByChannel((current) => (Object.keys(current).every((id) => held.has(id)) ? current : Object.fromEntries(Object.entries(current).filter(([id]) => held.has(id)))));
        } else {
          const seen = new Set(channelsRef.current.map((channel) => channel.Id));
          channelsRef.current = channelsRef.current.concat(items.filter((channel) => !seen.has(channel.Id)));
        }
        setChannels(channelsRef.current);
      },
      programs: (items, programs, window) => {
        if (!load.retired) applyPrograms(items, programs, window);
      },
    }),
    [applyPrograms],
  );
  const loadMoreRows = useCallback(() => loadNextPage(loadRef.current), []);
  // An added guide can list past the server's end, so while one is active the server's end closes no day.
  const readExternalGuides = useCallback((load: GuideLoad) => {
    void fetchTunerData()
      .catch(() => null)
      .then((data) => {
        if (!load.retired) setExternalGuides(activeGuideUrls(getLiveTvPreferences(), data?.tvgUrls ?? []).length > 0);
      });
  }, []);

  useEffect(() => {
    channelsRef.current = [];
    windowEndRef.current = windowStartMs + GUIDE_SPAN_MINUTES * MINUTE_MS;
    loadedStartRef.current = windowStartMs;
  }, [session, windowStartMs, preferences.filter]);

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
        readExternalGuides(load);
        fetchGuideHorizon()
          .then((end) => {
            if (!load.retired) setGuideEndMs(end);
          })
          .catch((err) => logger.warn("Guide horizon read failed", err, { hook: "useGuide" }));
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
  }, [attempt, session, loadChannelPage, landFor, refreshTimers, playlistIds, readExternalGuides]);

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

  /** Moves the loaded edges and drops the listings outside them. */
  const setLoaded = useCallback((start: number, end: number) => {
    loadedStartRef.current = start;
    windowEndRef.current = end;
    setWindowEndMs(end);
    setProgramsByChannel((current) => {
      let changed = false;
      const next: Record<string, JellyfinProgram[]> = {};
      for (const [channelId, programs] of Object.entries(current)) {
        next[channelId] = trimPrograms(programs, start, end);
        if (next[channelId] !== programs) changed = true;
      }
      return changed ? next : current;
    });
  }, []);

  const holdWindow = useCallback(
    (needFromMs: number, needToMs: number) => {
      const load = loadRef.current;
      if (load.retired || load.loading || load.busy) return;
      const span = GUIDE_SPAN_MINUTES * MINUTE_MS;
      const start = loadedStartRef.current;
      const end = windowEndRef.current;
      const wantFrom = Math.max(windowStartMs, windowStartMs + Math.floor((needFromMs - windowStartMs) / span) * span);
      const wantTo = Math.min(day.horizonMs, windowStartMs + Math.ceil((needToMs - windowStartMs) / span) * span);
      // Wholly past the horizon: nothing to load.
      if (wantFrom >= wantTo) return;
      // A stretch with a gap to the loaded one starts over there; one touching it grows the nearer edge.
      const apart = wantFrom > end || wantTo < start;
      const missing = apart
        ? { from: wantFrom, to: wantTo, start: wantFrom, end: wantTo }
        : wantTo > end
          ? { from: end, to: wantTo, start, end: wantTo }
          : wantFrom < start
            ? { from: wantFrom, to: start, start: wantFrom, end }
            : null;
      if (!missing) {
        const keep = keepRange(windowStartMs, needFromMs, needToMs);
        if (keep.from > start || keep.to < end) setLoaded(Math.max(start, keep.from), Math.min(end, keep.to));
        return;
      }
      load.busy = "window";
      loadPrograms(channelsRef.current, missing.from, missing.to, load)
        .then((landed) => {
          // A list loaded since holds programs up to the old edges only; the window stays there for it.
          // So does a source change: its reload reaches the old edges, and the next ask loads again.
          if (load.retired || !landed) return;
          setLoaded(missing.start, missing.end);
        })
        .catch((err) => logger.warn("Guide window load failed", err, { hook: "useGuide" }))
        .finally(() => {
          load.busy = null;
          if (!load.retired && load.pagePending) loadMoreRows();
        });
    },
    [windowStartMs, day.horizonMs, loadPrograms, loadMoreRows, setLoaded],
  );

  /** A fresh load on the picked day's window; today's pick again rewinds to the current half hour. */
  const selectDay = useCallback((dayMs: number) => {
    const now = Date.now();
    const next = { dayMs, ...guideDayWindow(dayMs, now) };
    setDay(next);
    setWindowStartMs(next.startMs);
    setWindowEndMs(next.startMs + GUIDE_SPAN_MINUTES * MINUTE_MS);
    setProgramsByChannel({});
    setIsLoading(true);
    setError(null);
    setAttempt((n) => n + 1);
  }, []);
  const days = useMemo<GuideDay[]>(
    () => guideDays(nowMs).map((startMs) => ({ startMs, hasListings: dayHasListings(startMs, externalGuides ? null : guideEndMs, coveredDays) })),
    [nowMs, guideEndMs, coveredDays, externalGuides],
  );

  // The minute tick retries a page that failed.
  useEffect(() => {
    if (loadRef.current.pagePending) loadMoreRows();
  }, [nowMs, loadMoreRows]);

  // A guide source added, turned off or removed: external listings leave the rows and the loaded channels ask again.
  const guideSources = guideSourcesKey(preferences);
  const guideSourcesRef = useRef(guideSources);
  useEffect(() => {
    if (guideSourcesRef.current === guideSources) return;
    guideSourcesRef.current = guideSources;
    setProgramsByChannel((current) =>
      Object.fromEntries(Object.entries(current).map(([channelId, programs]) => [channelId, programs.filter((program) => !program.Id?.startsWith(EXTERNAL_GUIDE_PREFIX))])),
    );
    const load = loadRef.current;
    readExternalGuides(load);
    if (load.retired || channelsRef.current.length === 0) return;
    loadPrograms(channelsRef.current, loadedStartRef.current, windowEndRef.current, load).catch((err) => logger.warn("Guide source reload failed", err, { hook: "useGuide" }));
  }, [guideSources, loadPrograms, readExternalGuides]);

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
    return listed.map((channel) => ({ channel, programs: programsByChannel[channel.Id] ?? NO_PROGRAMS }));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- healthGen re-filters when any verdict moves
  }, [channels, programsByChannel, hideOffline, healthGen]);

  const timersByProgramId = useMemo(() => {
    const map = new Map<string, JellyfinTimer>();
    for (const timer of timers) {
      if (!isActiveTimer(timer)) continue;
      if (timer.ProgramId) {
        map.set(timer.ProgramId, timer);
        continue;
      }
      // A channel recording names no program: it marks every cell its span overlaps.
      const { startMs, endMs } = programTimes(timer);
      for (const program of programsByChannel[timer.ChannelId ?? ""] ?? []) {
        const cell = programTimes(program);
        if (program.Id && !map.has(program.Id) && cell.startMs < endMs && startMs < cell.endMs) map.set(program.Id, timer);
      }
    }
    return map;
  }, [timers, programsByChannel]);
  const recordingChannelIds = useMemo(() => new Set(channels.filter((channel) => activeRecordTimer(timers, { channelId: channel.Id }, nowMs)).map((channel) => channel.Id)), [channels, timers, nowMs]);

  return {
    rows,
    windowStartMs,
    windowEndMs,
    nowMs,
    days,
    selectedDayMs: day.dayMs,
    selectDay,
    timersByProgramId,
    recordingChannelIds,
    isLoading: isLoading || playlistIds === "loading",
    isUpdating: pendingPrograms > 0,
    error,
    retry,
    holdWindow,
    loadMoreRows,
    refreshTimers,
  };
}
