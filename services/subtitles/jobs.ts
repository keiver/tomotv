/**
 * A video's search job: its query, language, results and pick. Pure transitions here; the runner
 * below walks the idle ones.
 */
import type { JellyfinVideoItem } from "@/types/jellyfin";
import { queryLabel, subtitleQuery } from "./query";
import type { Refusal } from "./chain";
import type { SubtitleHit, SubtitleJob, SubtitleQuery } from "./types";

export const JOB_CONCURRENCY = 3;

function cleanTitle(item: JellyfinVideoItem): string {
  return item.Name?.trim() || item.Path?.split(/[\\/]/).pop() || item.Id;
}

export function makeJob(item: JellyfinVideoItem, language: string): SubtitleJob {
  const query = subtitleQuery(item);
  return { item, label: queryLabel(query), title: cleanTitle(item), query, language, status: "idle", results: [], note: null, picked: null, applied: null, error: null };
}

export function withLanguage(jobs: SubtitleJob[], language: string): SubtitleJob[] {
  return jobs.map((job) => ({ ...job, language, status: "idle", results: [], note: null, picked: null, applied: null, error: null }));
}

export function withQuery(jobs: SubtitleJob[], index: number, query: SubtitleQuery): SubtitleJob[] {
  return jobs.map((job, at) => (at === index ? { ...job, query, label: queryLabel(query), status: "idle", results: [], note: null, picked: null, applied: null, error: null } : job));
}

export function jobSearching(jobs: SubtitleJob[], index: number): SubtitleJob[] {
  return jobs.map((job, at) => (at === index ? { ...job, status: "searching", error: null } : job));
}

export function jobSearched(jobs: SubtitleJob[], index: number, hits: SubtitleHit[], note: string | null): SubtitleJob[] {
  return jobs.map((job, at) => (at === index ? { ...job, status: hits.length > 0 ? "found" : "none", results: hits, note } : job));
}

export function jobFailed(jobs: SubtitleJob[], index: number, error: string): SubtitleJob[] {
  return jobs.map((job, at) => (at === index ? { ...job, status: "failed", error } : job));
}

export function jobApplying(jobs: SubtitleJob[], index: number, hit: SubtitleHit): SubtitleJob[] {
  return jobs.map((job, at) => (at === index ? { ...job, status: "applying", picked: hit, error: null } : job));
}

export function jobApplied(jobs: SubtitleJob[], index: number, applied: NonNullable<SubtitleJob["applied"]>): SubtitleJob[] {
  return jobs.map((job, at) => (at === index ? { ...job, status: "applied", applied } : job));
}

/** Back to the results with the error; the pick stays so the error line can name it. */
export function jobApplyFailed(jobs: SubtitleJob[], index: number, error: string): SubtitleJob[] {
  return jobs.map((job, at) => (at === index ? { ...job, status: "found", error } : job));
}

/** One line for the state column from a chain's refusals, as source names the screen translates. */
export function refusalSources(refused: Refusal[]): string[] {
  return [...new Set(refused.map((refusal) => refusal.source))];
}

export type JobSearch = (job: SubtitleJob) => Promise<{ hits: SubtitleHit[]; note: string | null }>;

/**
 * Searches every idle job, a few at a time, reporting the list and the one job that changed after
 * each step. The caller's `live` says whether it still wants updates; a false answer stops new searches.
 */
export async function runJobs(
  initial: SubtitleJob[],
  search: JobSearch,
  report: (jobs: SubtitleJob[], index: number) => void,
  live: () => boolean,
  concurrency: number = JOB_CONCURRENCY,
): Promise<SubtitleJob[]> {
  let jobs = initial;
  const pending = jobs.map((job, index) => (job.status === "idle" ? index : -1)).filter((index) => index >= 0);
  const worker = async (): Promise<void> => {
    while (pending.length > 0 && live()) {
      const index = pending.shift() as number;
      jobs = jobSearching(jobs, index);
      report(jobs, index);
      try {
        const answer = await search(jobs[index]);
        if (!live()) return;
        jobs = jobSearched(jobs, index, answer.hits, answer.note);
      } catch (error) {
        if (!live()) return;
        jobs = jobFailed(jobs, index, error instanceof Error ? error.message : String(error));
      }
      report(jobs, index);
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(concurrency, pending.length)) }, () => worker()));
  return jobs;
}
