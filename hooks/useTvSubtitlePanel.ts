/**
 * The tvOS in-player subtitle panel: opened from the transport bar, fed the one playing video's
 * job, closed by Menu. The search itself is the same hook the iOS screen uses.
 */
import { useSubtitleSearch } from "@/hooks/useSubtitleSearch";
import { t } from "@/services/i18n";
import { fetchVideoDetails } from "@/services/jellyfinApi";
import { hitBadges, hitMeta, jobErrorLine, jobNoteLine, jobStateLine, SOURCE_MONOGRAM } from "@/services/subtitles/jobText";
import type { SubtitleJob } from "@/services/subtitles/types";
import { dismissSubtitlePanel, listenToSubtitlePanel, presentSubtitlePanel, subtitlePanelAvailable, updateSubtitlePanel, type PanelState } from "@/services/subtitleSearchPanel";
import type { JellyfinVideoItem } from "@/types/jellyfin";
import { logger } from "@/utils/logger";
import { useCallback, useEffect, useRef, useState } from "react";

/** The panel's state for one job, every string in the viewer's language. */
export function panelStateFor(job: SubtitleJob | undefined, language: string, choices: { code: string; native: string }[], busy: boolean): PanelState {
  return {
    title: t("subtitles.title"),
    query: job?.query.keywords ?? "",
    queryPlaceholder: t("subtitles.searchPlaceholder"),
    languages: choices.map((row) => ({ code: row.code, name: row.native })),
    selectedLanguage: language,
    stateLine: job ? jobStateLine(job) : t("subtitles.searching"),
    note: job ? (jobErrorLine(job) ?? jobNoteLine(job) ?? "") : "",
    busy,
    results: (job?.results ?? []).map((hit) => ({
      id: `${hit.source}:${hit.id}`,
      name: hit.name,
      meta: hitMeta(hit),
      badges: hitBadges(hit),
      monogram: SOURCE_MONOGRAM[hit.source],
      hashMatch: hit.hashMatch,
      applying: job?.status === "applying" && job.picked?.id === hit.id && job.picked.source === hit.source,
      applied: job?.status === "applied" && job.picked?.id === hit.id && job.picked.source === hit.source,
    })),
  };
}

export function useTvSubtitlePanel(videoId: string): { available: boolean; open: () => void } {
  const [items, setItems] = useState<JellyfinVideoItem[] | null>(null);
  const [shown, setShown] = useState(false);
  const search = useSubtitleSearch(items, false);
  const searchRef = useRef(search);
  useEffect(() => {
    searchRef.current = search;
  }, [search]);
  const presented = useRef(false);

  const open = useCallback(() => {
    if (!subtitlePanelAvailable()) return;
    setShown(true);
    fetchVideoDetails(videoId)
      .then((details) => {
        if (details) setItems([details]);
        else setShown(false);
      })
      .catch((error) => {
        logger.warn("Subtitle panel could not read the item", error, { service: "Subtitles", videoId });
        setShown(false);
      });
  }, [videoId]);

  // The panel shows once the item is read, and follows every change of the job after that.
  useEffect(() => {
    if (!shown || !items) return;
    const state = panelStateFor(search.jobs[0], search.language, search.choices, search.running);
    if (!presented.current) {
      presented.current = true;
      void presentSubtitlePanel(state).then((ok) => {
        if (!ok) {
          presented.current = false;
          setShown(false);
        }
      });
      return;
    }
    void updateSubtitlePanel(state);
  }, [shown, items, search.jobs, search.language, search.choices, search.running]);

  useEffect(() => {
    if (!shown) return;
    return listenToSubtitlePanel({
      onQueryChanged: (query) => searchRef.current.setKeywords(0, query),
      onLanguageChanged: (code) => searchRef.current.setLanguage(code),
      onPick: (id) => {
        const job = searchRef.current.jobs[0];
        const hit = job?.results.find((candidate) => `${candidate.source}:${candidate.id}` === id);
        if (hit) void searchRef.current.pick(0, hit);
      },
      onDismissed: () => {
        presented.current = false;
        setShown(false);
        setItems(null);
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

  return { available: subtitlePanelAvailable(), open };
}
