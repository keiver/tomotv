/**
 * The tvOS subtitle panel: opened from the player's transport bar or a video's info panel, fed one
 * video's job, closed by Menu. With a subtitle on it leads with that subtitle's timing controls and
 * the search becomes the way to replace it. The search itself is the same hook the iOS screen uses.
 */
import type { ActiveTextSubtitle } from "@/contexts/PlayerSessionContext";
import { useSubtitleSearch } from "@/hooks/useSubtitleSearch";
import { useSubtitleTiming } from "@/hooks/useSubtitleTiming";
import { t } from "@/services/i18n";
import { fetchVideoDetails } from "@/services/jellyfinApi";
import { getCachedConfig } from "@/services/jellyfin/session";
import { currentTextSubtitles, isCurrentPick, replacementFor, type CurrentSubtitle } from "@/services/subtitles/current";
import { hitBadges, hitMeta, jobErrorLine, jobNoteLine, jobStateLine, offsetLabel, SOURCE_MONOGRAM, sourceName, syncStateLine } from "@/services/subtitles/jobText";
import { ALL_LANGUAGES, languageFor } from "@/services/subtitles/languages";
import { queryText } from "@/services/subtitles/query";
import { SUBTITLE_OFFSET_STEP_MS, type SubtitleSyncState } from "@/services/subtitles/timing";
import type { SubtitleJob } from "@/services/subtitles/types";
import { dismissSubtitlePanel, listenToSubtitlePanel, presentSubtitlePanel, subtitlePanelAvailable, type PanelCurrent, type PanelState } from "@/services/subtitleSearchPanel";
import type { JellyfinVideoItem } from "@/types/jellyfin";
import { logger } from "@/utils/logger";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

export interface PanelCurrentInput {
  subtitle: CurrentSubtitle;
  offsetMs: number;
  /** How the match against the audio stands, or null when none ran. */
  sync?: SubtitleSyncState | null;
}

/** The words the timing block shows for the subtitle that is on. */
export function panelCurrentFor(input: PanelCurrentInput): PanelCurrent {
  const language = languageFor(input.subtitle.language)?.native ?? input.subtitle.language;
  return {
    name: input.subtitle.name,
    meta: input.subtitle.device ? `${sourceName(input.subtitle.device.source)} · ${language}` : language,
    monogram: input.subtitle.device ? SOURCE_MONOGRAM[input.subtitle.device.source] : "",
    offsetLabel: offsetLabel(input.offsetMs),
    earlierLabel: t("subtitles.earlier"),
    laterLabel: t("subtitles.later"),
    resetLabel: t("subtitles.resetTiming"),
    syncLabel: t("subtitles.sync"),
    syncing: input.sync?.status === "syncing",
    note: syncStateLine(input.sync),
  };
}

/** The panel's state for one job, every string in the viewer's language; the likely languages lead the whole table. The results keep their order, and the copy that is on shows as applied. */
export function panelStateFor(job: SubtitleJob | undefined, language: string, choices: { code: string; native: string }[], busy: boolean, current: PanelCurrentInput | null = null): PanelState {
  const rest = ALL_LANGUAGES.filter((row) => !choices.some((choice) => choice.code === row.code));
  const results = job?.results ?? [];
  return {
    title: current ? t("subtitles.timingTitle") : t("subtitles.title"),
    current: current ? panelCurrentFor(current) : null,
    query: job ? queryText(job.query) : "",
    queryPlaceholder: t("subtitles.searchPlaceholder"),
    searchLabel: t("subtitles.search"),
    languages: [...choices, ...rest].map((row) => ({ code: row.code, name: row.native })),
    selectedLanguage: language,
    stateLine: job ? jobStateLine(job) : t("subtitles.searching"),
    note: job ? (jobErrorLine(job) ?? jobNoteLine(job) ?? "") : "",
    busy,
    results: results.map((hit) => ({
      id: `${hit.source}:${hit.id}`,
      name: hit.name,
      meta: hitMeta(hit),
      badges: hitBadges(hit),
      monogram: SOURCE_MONOGRAM[hit.source],
      hashMatch: hit.hashMatch,
      applying: job?.status === "applying" && job.picked?.id === hit.id && job.picked.source === hit.source,
      applied: (job?.status === "applied" && job.picked?.id === hit.id && job.picked.source === hit.source) || isCurrentPick(hit, current?.subtitle),
    })),
  };
}

export interface TransportButtonInput {
  isLiveChannel: boolean;
  available: boolean;
  active: ActiveTextSubtitle | null;
  offsetMs: number;
}

/** Our transport bar button on every video, or null on a live channel: it finds subtitles, and its title carries the timing of the one of ours that is on. */
export function subtitleTransportButton(input: TransportButtonInput): { id: "subtitles"; title: string; sfSymbol: string } | null {
  if (input.isLiveChannel || !input.available) return null;
  const title = !input.active ? t("player.findSubtitles") : input.offsetMs === 0 ? t("subtitles.timingTitle") : offsetLabel(input.offsetMs);
  return { id: "subtitles", title, sfSymbol: "square.and.arrow.down" };
}

export function useTvSubtitlePanel(videoId: string, active: ActiveTextSubtitle | null): { available: boolean; open: () => void; offsetMs: number } {
  // The item read for one video, kept between opens with its jobs and results; another video starts over.
  const [loaded, setLoaded] = useState<{ videoId: string; items: JellyfinVideoItem[] } | null>(null);
  const items = loaded?.videoId === videoId ? loaded.items : null;
  const [shown, setShown] = useState(false);
  const search = useSubtitleSearch(items, false);
  const timing = useSubtitleTiming(videoId);
  const searchRef = useRef(search);
  const timingRef = useRef(timing);
  useEffect(() => {
    searchRef.current = search;
    timingRef.current = timing;
  }, [search, timing]);
  const presented = useRef(false);

  // The subtitle that is on, as the item lists it: a device copy carries what a replacement removes.
  const current = useMemo<CurrentSubtitle | null>(() => {
    if (!active) return null;
    const listed = items?.[0] ? currentTextSubtitles(items[0], getCachedConfig().server).find((entry) => entry.index === active.index) : undefined;
    return listed ?? { index: active.index, name: active.name, language: active.language };
  }, [active, items]);
  const offsetMs = active ? timing.offsetFor(active.index) : 0;
  const sync = active ? timing.syncStateFor(active.index) : null;
  const currentRef = useRef(current);
  useEffect(() => {
    currentRef.current = current;
  }, [current]);

  // A copy just picked here is matched to the audio as soon as it is the track on, once per track.
  const autoSynced = useRef<string | null>(null);
  useEffect(() => {
    const job = search.jobs[0];
    if (!current?.device || !job || job.status !== "applied" || !job.picked) return;
    if (job.picked.source !== current.device.source || job.picked.id !== current.device.sourceId) return;
    const key = `${videoId}:${current.index}`;
    if (autoSynced.current === key) return;
    autoSynced.current = key;
    void timingRef.current.sync(current.index);
  }, [current, search.jobs, videoId]);

  // A panel still up when another video starts closes; its dismissed event clears the shown state.
  useEffect(() => {
    if (presented.current) void dismissSubtitlePanel();
  }, [videoId]);

  const open = useCallback(() => {
    if (!videoId || !subtitlePanelAvailable()) return;
    setShown(true);
    if (items) return;
    fetchVideoDetails(videoId)
      .then((details) => {
        if (details) setLoaded({ videoId, items: [details] });
        else setShown(false);
      })
      .catch((error) => {
        logger.warn("Subtitle panel could not read the item", error, { service: "Subtitles", videoId });
        setShown(false);
      });
  }, [videoId, items]);

  // The panel shows once the item is read and follows every change of the job after that; the native
  // side applies the state to the panel on screen, or presents a new one when none is.
  useEffect(() => {
    if (!shown || !items) return;
    const state = panelStateFor(search.jobs[0], search.language, search.choices, search.running, current ? { subtitle: current, offsetMs, sync } : null);
    void presentSubtitlePanel(state).then((ok) => {
      presented.current = ok;
      if (!ok) setShown(false);
    });
  }, [shown, items, search.jobs, search.language, search.choices, search.running, current, offsetMs, sync]);

  useEffect(() => {
    if (!shown) return;
    return listenToSubtitlePanel({
      onQueryChanged: (query) => searchRef.current.setQueryText(0, query),
      onLanguageChanged: (code) => searchRef.current.setLanguage(code),
      onPick: (id) => {
        const job = searchRef.current.jobs[0];
        const hit = job?.results.find((candidate) => `${candidate.source}:${candidate.id}` === id);
        if (!hit) return;
        void searchRef.current.pick(0, hit, replacementFor(hit, currentRef.current));
      },
      onShift: (deltaMs) => {
        const on = currentRef.current;
        if (!on) return;
        timingRef.current.shift(on.index, deltaMs === null ? null : Math.sign(deltaMs) * SUBTITLE_OFFSET_STEP_MS);
      },
      onSync: () => {
        const on = currentRef.current;
        if (on) void timingRef.current.sync(on.index);
      },
      onDismissed: () => {
        presented.current = false;
        setShown(false);
      },
    });
  }, [shown]);

  // Leaving the player takes the panel with it.
  useEffect(
    () => () => {
      if (presented.current) {
        presented.current = false;
        void dismissSubtitlePanel();
      }
    },
    [],
  );

  return { available: subtitlePanelAvailable(), open, offsetMs };
}
