/**
 * The job list behind a subtitle search screen or panel: one job per video, one language at a
 * time, each pick saved where the account allows and then handed to the running player.
 */
import { usePlayerSession } from "@/contexts/PlayerSessionContext";
import { deviceLanguage } from "@/services/i18n";
import { getTrackSettingsSync, recordSubtitlePick } from "@/services/jellyfin/trackSettings";
import { jobApplied, jobApplying, jobApplyFailed, jobSearched, jobSearching, makeJobs, refusalSources, runJobs, takeMatches, withQuery } from "@/services/subtitles/jobs";
import { languageChoices, type SubtitleLanguage } from "@/services/subtitles/languages";
import { appliedStreamIndex, applyPick, searchContext, searchSubtitles, type ApplyResult, type Replacing } from "@/services/subtitles/pipeline";
import { queryFromText } from "@/services/subtitles/query";
import type { SearchContext, SubtitleHit, SubtitleJob } from "@/services/subtitles/types";
import type { JellyfinVideoItem } from "@/types/jellyfin";
import { logger } from "@/utils/logger";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

export interface SubtitleSearchState {
  jobs: SubtitleJob[];
  language: string;
  choices: SubtitleLanguage[];
  running: boolean;
  /** Videos left out because they already carry the language. */
  skipped: number;
  matches: { index: number; hit: SubtitleHit }[];
}

export interface SubtitleSearchActions {
  setLanguage: (code: string) => void;
  /** The typed search text: an "S04E06" in it sets the episode, the rest is the title. */
  setQueryText: (index: number, text: string) => void;
  /** Saves a hit; with `replacing`, the device copy named goes once the new one is kept. */
  pick: (index: number, hit: SubtitleHit, replacing?: Replacing) => Promise<ApplyResult | null>;
  takeAll: () => Promise<void>;
}

interface Board {
  items: JellyfinVideoItem[] | null;
  language: string;
  choices: SubtitleLanguage[];
  jobs: SubtitleJob[];
  skipped: number;
}

/** The first chip: the account's standing language, else the device's, else English. */
export function startingLanguage(items: JellyfinVideoItem[]): { language: string; choices: SubtitleLanguage[] } {
  const stored = getTrackSettingsSync().subtitleLanguage;
  const choices = languageChoices({ item: items[0] ?? {}, stored, deviceTags: [deviceLanguage()] });
  return { language: choices[0]?.code ?? "en", choices };
}

function boardFor(items: JellyfinVideoItem[] | null, skipSubtitled: boolean): Board {
  if (!items) return { items, language: "en", choices: [], jobs: [], skipped: 0 };
  const start = startingLanguage(items);
  const jobs = makeJobs(items, start.language, skipSubtitled);
  return { items, language: start.language, choices: start.choices, jobs, skipped: items.length - jobs.length };
}

/** With `skipSubtitled` on, a video already carrying the language gets no job; a single playing video keeps its job either way. */
export function useSubtitleSearch(items: JellyfinVideoItem[] | null, skipSubtitled: boolean = true): SubtitleSearchState & SubtitleSearchActions {
  const { sessionVideoId, reloadSubtitles } = usePlayerSession();
  const [board, setBoard] = useState<Board>(() => boardFor(items, skipSubtitled));
  // A new set of videos starts a new board; derived in render so the first frame already shows it.
  if (board.items !== items) setBoard(boardFor(items, skipSubtitled));
  const contextRef = useRef<Promise<SearchContext> | null>(null);
  const generation = useRef(0);
  const boardRef = useRef(board);
  useEffect(() => {
    boardRef.current = board;
  }, [board]);

  const setJobs = useCallback((update: (jobs: SubtitleJob[]) => SubtitleJob[]) => {
    setBoard((current) => ({ ...current, jobs: update(current.jobs) }));
  }, []);

  const context = useCallback(async (itemId: string): Promise<SearchContext> => {
    if (!contextRef.current) contextRef.current = searchContext(itemId);
    const shared = await contextRef.current;
    return { ...shared, itemId };
  }, []);

  const start = useCallback(
    (jobs: SubtitleJob[]) => {
      const mine = ++generation.current;
      const live = () => generation.current === mine;
      void runJobs(
        jobs,
        async (job) => {
          const answer = await searchSubtitles(job.item.Id, job.query, job.language, await context(job.item.Id));
          return { hits: answer.hits, note: answer.refused.length > 0 ? refusalSources(answer.refused).join(",") : null };
        },
        (next, index) => {
          // Only the searched job is taken, so a pick made on another job meanwhile keeps its state.
          if (live()) setJobs((current) => current.map((job, at) => (at === index ? next[index] : job)));
        },
        live,
      );
    },
    [context, setJobs],
  );

  const allIdle = board.jobs.length > 0 && board.jobs.every((job) => job.status === "idle");
  useEffect(() => {
    if (!allIdle) return;
    // A fresh job list (new videos, language or query) searches itself on the next tick.
    const timer = setTimeout(() => start(boardRef.current.jobs), 0);
    return () => clearTimeout(timer);
  }, [allIdle, board.jobs, start]);

  const setLanguage = useCallback(
    (code: string) => {
      generation.current += 1;
      setBoard((current) => {
        if (!current.items) return current;
        const jobs = makeJobs(current.items, code, skipSubtitled);
        return { ...current, language: code, jobs, skipped: current.items.length - jobs.length };
      });
    },
    [skipSubtitled],
  );

  const setQueryText = useCallback(
    (index: number, text: string) => {
      generation.current += 1;
      setJobs((current) => {
        const job = current[index];
        if (!job) return current;
        return withQuery(current, index, queryFromText(text, job.query));
      });
    },
    [setJobs],
  );

  const pick = useCallback(
    async (index: number, hit: SubtitleHit, replacing?: Replacing): Promise<ApplyResult | null> => {
      const job = boardRef.current.jobs[index];
      if (!job || job.status === "applying") return null;
      setJobs((current) => jobApplying(current, index, hit));
      let result: ApplyResult;
      try {
        result = await applyPick(job.item, hit, await context(job.item.Id), replacing);
      } catch (error) {
        logger.warn("Subtitle pick could not be saved", error, { service: "Subtitles", source: hit.source });
        setJobs((current) => jobApplyFailed(current, index, "failed"));
        return null;
      }
      if (result.ok) {
        recordSubtitlePick({ kind: "language", tag: result.language });
        setJobs((current) => jobApplied(current, index, { where: result.where, language: result.language }));
        if (sessionVideoId === job.item.Id) reloadSubtitles(appliedStreamIndex(result));
        return result;
      }
      if (result.reason === "refused") {
        // The refusing source is down for the session: the same file asked again goes further down the chain.
        setJobs((current) => jobSearching(current, index));
        const answer = await searchSubtitles(job.item.Id, job.query, job.language, await context(job.item.Id));
        setJobs((current) => jobSearched(current, index, answer.hits, refusalSources(answer.refused).join(",") || null));
        return result;
      }
      setJobs((current) => jobApplyFailed(current, index, result.reason));
      return result;
    },
    [context, reloadSubtitles, sessionVideoId, setJobs],
  );

  const matches = useMemo(() => takeMatches(board.jobs), [board.jobs]);

  const takeAll = useCallback(async () => {
    for (const match of takeMatches(boardRef.current.jobs)) await pick(match.index, match.hit);
  }, [pick]);

  const running = board.jobs.some((job) => job.status === "searching" || job.status === "idle");

  return { jobs: board.jobs, language: board.language, choices: board.choices, running, skipped: board.skipped, matches, setLanguage, setQueryText, pick, takeAll };
}
