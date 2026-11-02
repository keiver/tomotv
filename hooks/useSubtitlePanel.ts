/**
 * The native subtitle panel on every platform: opened from a video's info panel, or from the tvOS
 * player's transport bar, closed by Menu or the sheet pull. From the info panel it carries the
 * selected language's own track (timing, sync while playing, Replace) and one search job per
 * video, a folder's episodes each with their own. In-player it leads with the playing subtitle's
 * timing and a pick is the way to replace it.
 */
import type { ActiveTextSubtitle } from "@/contexts/PlayerSessionContext";
import { useSubtitleSearch } from "@/hooks/useSubtitleSearch";
import { useSubtitleTiming } from "@/hooks/useSubtitleTiming";
import { t } from "@/services/i18n";
import { fetchItemDetails, fetchRecursiveDownloadables, isAudioItem, isBook, isFolder, isPhoto } from "@/services/jellyfinApi";
import { getCachedConfig } from "@/services/jellyfin/session";
import { currentTextSubtitles, isCurrentPick, replacementFor, type CurrentSubtitle } from "@/services/subtitles/current";
import { hitBadges, hitMeta, jobErrorLine, jobNoteLine, jobStateLine, offsetLabel, SOURCE_MONOGRAM, sourceName, syncStateLine } from "@/services/subtitles/jobText";
import { ALL_LANGUAGES, languageCode, languageFor } from "@/services/subtitles/languages";
import { queryText } from "@/services/subtitles/query";
import { SUBTITLE_OFFSET_STEP_MS, type SubtitleSyncState } from "@/services/subtitles/timing";
import type { SubtitleJob } from "@/services/subtitles/types";
import { getUiPreferences } from "@/services/uiPreferences";
import { dismissSubtitlePanel, listenToSubtitlePanel, presentSubtitlePanel, subtitlePanelAvailable, type PanelJob, type PanelState, type PanelTrack } from "@/services/subtitleSearchPanel";
import type { JellyfinVideoItem } from "@/types/jellyfin";
import { logger } from "@/utils/logger";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

/** The videos a search covers: the item itself, or every video under a folder, series or season. */
export async function loadSearchItems(itemId: string): Promise<JellyfinVideoItem[]> {
  const details = await fetchItemDetails(itemId);
  if (!details) return [];
  if (!isFolder(details)) return [details];
  const leaves = await fetchRecursiveDownloadables(itemId);
  return leaves.filter((item) => !isAudioItem(item) && !isPhoto(item) && !isBook(item));
}

export interface PanelTrackInput {
  subtitle: CurrentSubtitle;
  offsetMs: number;
  /** How the match against the audio stands, or null when none ran. */
  sync?: SubtitleSyncState | null;
  canSync: boolean;
  canReplace: boolean;
  replacing: boolean;
}

/** One of the video's own text subtitles, with the words its row shows. */
export function panelTrackFor(input: PanelTrackInput): PanelTrack {
  const language = languageFor(input.subtitle.language)?.native ?? input.subtitle.language;
  return {
    id: input.subtitle.index,
    name: input.subtitle.name,
    meta: input.subtitle.device ? `${sourceName(input.subtitle.device.source)} · ${language}` : language,
    monogram: input.subtitle.device ? SOURCE_MONOGRAM[input.subtitle.device.source] : "",
    offsetLabel: offsetLabel(input.offsetMs),
    earlierLabel: t("subtitles.earlier"),
    laterLabel: t("subtitles.later"),
    earlierTitle: t("subtitles.earlierStep"),
    laterTitle: t("subtitles.laterStep"),
    resetLabel: t("subtitles.resetTiming"),
    syncLabel: t("subtitles.sync"),
    replaceLabel: t("subtitles.replace"),
    canSync: input.canSync,
    canReplace: input.canReplace,
    replacing: input.replacing,
    syncing: input.sync?.status === "syncing",
    note: syncStateLine(input.sync ?? null),
  };
}

/** One job as its panel section; a lone job carries no heading and is the whole search. */
export function panelJobFor(job: SubtitleJob, alone: boolean, currents: CurrentSubtitle[]): PanelJob {
  return {
    id: job.item.Id,
    label: alone ? "" : (job.label ?? ""),
    heading: alone ? "" : job.title,
    query: queryText(job.query),
    stateLine: jobStateLine(job),
    note: jobErrorLine(job) ?? jobNoteLine(job) ?? "",
    // An idle job searches itself on the next tick and already says "Searching", so it spins too.
    busy: job.status === "idle" || job.status === "searching" || job.status === "applying",
    results: job.results.map((hit) => ({
      id: `${hit.source}:${hit.id}`,
      name: hit.name,
      meta: hitMeta(hit),
      badges: hitBadges(hit),
      monogram: SOURCE_MONOGRAM[hit.source],
      hashMatch: hit.hashMatch,
      applying: job.status === "applying" && job.picked?.id === hit.id && job.picked.source === hit.source,
      applied: (job.status === "applied" && job.picked?.id === hit.id && job.picked.source === hit.source) || currents.some((current) => isCurrentPick(hit, current)),
    })),
  };
}

/** The whole panel for one search, every string in the viewer's language; the likely languages lead the menu. */
export function panelStateFor(
  search: { jobs: SubtitleJob[]; language: string; choices: { code: string; native: string }[]; skipped: number; matches: unknown[] },
  tracks: PanelTrackInput[],
  videoCount: number,
  title: string,
  accent: string,
): PanelState {
  const rest = ALL_LANGUAGES.filter((row) => !search.choices.some((choice) => choice.code === row.code));
  const alone = search.jobs.length === 1;
  const busy = search.jobs.some((job) => job.status === "applying");
  const languageName = languageFor(search.language)?.native ?? search.language;
  const currents = tracks.map((track) => track.subtitle);
  return {
    title,
    credit: t("subtitles.credit"),
    accent,
    tracks: tracks.map(panelTrackFor),
    languages: [...search.choices, ...rest].map((row) => ({ code: row.code, name: row.native })),
    selectedLanguage: search.language,
    takeAll: search.matches.length > 0 ? { label: t("subtitles.takeMatches").replace("{count}", String(search.matches.length)), busy } : null,
    skippedLine: search.skipped > 0 ? t("subtitles.filesSkipped").replace("{count}", String(search.skipped)).replace("{language}", languageName) : "",
    emptyLine: search.jobs.length > 0 ? "" : videoCount === 0 ? t("subtitles.noVideos") : t("subtitles.allSubtitled").replace("{language}", languageName),
    queryPlaceholder: t("subtitles.searchPlaceholder"),
    searchLabel: t("subtitles.search"),
    jobs: search.jobs.map((job) => panelJobFor(job, alone, currents)),
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

export function useSubtitlePanel(itemId: string, active: ActiveTextSubtitle | null, inPlayer = false): { available: boolean; open: () => void; offsetMs: number } {
  // The videos read for one item, kept between opens with their jobs and results; another item starts over.
  const [loaded, setLoaded] = useState<{ itemId: string; items: JellyfinVideoItem[] } | null>(null);
  const items = loaded?.itemId === itemId ? loaded.items : null;
  const [shown, setShown] = useState(false);
  // The stream index a Replace press armed: the next pick replaces that copy.
  const [replacingIndex, setReplacingIndex] = useState<number | null>(null);
  // One video always gets its search job, so the field and button never disappear; only a
  // folder's episodes already carrying the language are skipped.
  const presented = useRef(false);
  // In the player a kept pick reloads the session, so the panel closes before the reload starts.
  const closeBeforeReload = useCallback(async () => {
    if (!presented.current) return;
    presented.current = false;
    await dismissSubtitlePanel();
    setShown(false);
    setReplacingIndex(null);
  }, []);
  const search = useSubtitleSearch(items, !inPlayer && (items?.length ?? 0) > 1, inPlayer ? closeBeforeReload : undefined);
  const timing = useSubtitleTiming(itemId);
  const searchRef = useRef(search);
  const timingRef = useRef(timing);
  useEffect(() => {
    searchRef.current = search;
    timingRef.current = timing;
  }, [search, timing]);

  // The subtitle that is on, as the item lists it: a device copy carries what a replacement removes.
  const playerCurrent = useMemo<CurrentSubtitle | null>(() => {
    if (!active) return null;
    const listed = items?.[0] ? currentTextSubtitles(items[0], getCachedConfig().server).find((entry) => entry.index === active.index) : undefined;
    return listed ?? { index: active.index, name: active.name, language: active.language };
  }, [active, items]);
  const offsetMs = active ? timing.offsetFor(active.index) : 0;

  // Only the selected language's track carries a timing row, so the panel never repeats a control
  // strip per embedded track; the row follows the language pill. Rebuilt every render, so a pick's
  // fresh device copy lists itself; the send effect deduplicates, so an unchanged list costs no
  // bridge call.
  const listed = inPlayer
    ? playerCurrent
      ? [playerCurrent]
      : []
    : items?.length === 1
      ? currentTextSubtitles(items[0], getCachedConfig().server).filter((entry) => languageCode(entry.language) === languageCode(search.language))
      : [];
  const tracks: PanelTrackInput[] = listed.map((subtitle) => ({
    subtitle,
    offsetMs: timing.offsetFor(subtitle.index),
    sync: timing.syncStateFor(subtitle.index),
    canSync: timing.canSync,
    canReplace: !inPlayer,
    replacing: replacingIndex === subtitle.index,
  }));
  const tracksRef = useRef(tracks);
  const replacingRef = useRef<CurrentSubtitle | null>(null);
  useEffect(() => {
    tracksRef.current = tracks;
    replacingRef.current = tracks.find((track) => track.replacing)?.subtitle ?? null;
  }, [tracks]);
  const playerCurrentRef = useRef(playerCurrent);
  useEffect(() => {
    playerCurrentRef.current = playerCurrent;
  }, [playerCurrent]);

  // A copy just picked here is matched to the audio as soon as it is the track on, once per track.
  const autoSynced = useRef<string | null>(null);
  useEffect(() => {
    const job = search.jobs.find((candidate) => candidate.status === "applied");
    if (!playerCurrent?.device || !job?.picked) return;
    if (job.picked.source !== playerCurrent.device.source || job.picked.id !== playerCurrent.device.sourceId) return;
    const key = `${itemId}:${playerCurrent.index}`;
    if (autoSynced.current === key) return;
    autoSynced.current = key;
    void timingRef.current.sync(playerCurrent.index);
  }, [playerCurrent, search.jobs, itemId]);

  // A panel still up when another item starts closes; its dismissed event clears the shown state.
  useEffect(() => {
    if (presented.current) void dismissSubtitlePanel();
  }, [itemId]);

  const open = useCallback(() => {
    if (!itemId || !subtitlePanelAvailable()) return;
    setShown(true);
    if (items) return;
    loadSearchItems(itemId)
      .then((found) => {
        if (found.length > 0) setLoaded({ itemId, items: found });
        else setShown(false);
      })
      .catch((error) => {
        logger.warn("Subtitle panel could not read the item", error, { service: "Subtitles", itemId });
        setShown(false);
      });
  }, [itemId, items]);

  // The panel shows once the items are read and follows every change after that; the native side
  // applies the state to the panel on screen, or presents a new one when none is. A state identical
  // to the last sent one stays home, so unrelated re-renders cost no bridge call.
  const lastSent = useRef("");
  useEffect(() => {
    if (!shown || !items) return;
    const title = inPlayer && tracks.length > 0 ? t("subtitles.timingTitle") : t("subtitles.title");
    const state = panelStateFor(search, tracks, items.length, title, getUiPreferences().cardTheme.accent);
    const sent = JSON.stringify(state);
    if (presented.current && sent === lastSent.current) return;
    lastSent.current = sent;
    void presentSubtitlePanel(state).then((ok) => {
      presented.current = ok;
      if (!ok) setShown(false);
    });
  }, [shown, items, search, tracks, inPlayer]);

  useEffect(() => {
    if (!shown) return;
    return listenToSubtitlePanel({
      onQueryChanged: (jobId, query) => {
        const index = searchRef.current.jobs.findIndex((job) => job.item.Id === jobId);
        if (index >= 0) searchRef.current.setQueryText(index, query);
      },
      onLanguageChanged: (code) => searchRef.current.setLanguage(code),
      onPick: (jobId, id) => {
        const index = searchRef.current.jobs.findIndex((job) => job.item.Id === jobId);
        const job = searchRef.current.jobs[index];
        const hit = job?.results.find((candidate) => `${candidate.source}:${candidate.id}` === id);
        if (!hit) return;
        void searchRef.current.pick(index, hit, replacementFor(hit, replacingRef.current ?? playerCurrentRef.current));
      },
      onShift: (trackId, deltaMs) => timingRef.current.shift(trackId, deltaMs === null ? null : Math.sign(deltaMs) * SUBTITLE_OFFSET_STEP_MS),
      onSync: (trackId) => void timingRef.current.sync(trackId),
      onReplace: (trackId) => {
        const track = tracksRef.current.find((candidate) => candidate.subtitle.index === trackId);
        if (!track) return;
        setReplacingIndex(trackId);
        // The armed track's language leads the next search, the way a replacement wants it.
        searchRef.current.setLanguage(languageCode(track.subtitle.language) ?? searchRef.current.language);
      },
      onTakeAll: () => void searchRef.current.takeAll(),
      onDismissed: () => {
        presented.current = false;
        setShown(false);
        setReplacingIndex(null);
      },
    });
  }, [shown]);

  // Leaving the opener takes the panel with it.
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
