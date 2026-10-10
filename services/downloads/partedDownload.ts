/**
 * A Static download fetched as concurrent ranged parts, presenting the one
 * DownloadTask surface the manager drives (downloadAsync/resumeAsync/pauseAsync/
 * savable/cancel). Part files land beside the destination and the engine joins
 * them; anything that cannot run parted answers a plain DownloadTask instead.
 */
import { mergeDownloadParts } from "@keiver/tomo-engine";
import { File, DownloadTask, type DownloadPauseState, type DownloadTaskOptions } from "expo-file-system";

import { aggregateProgress, MIN_PART_BYTES, PART_CONCURRENCY, partRangeHeader, partSize, planParts, type DownloadPart } from "./partPlan";
import { logger } from "@/utils/logger";

export interface PartedPauseState {
  parted: true;
  url: string;
  destinationUri: string;
  parts: DownloadPart[];
  /** Per part: finished parts carry done, interrupted ones a savable when resume data exists. */
  states: { index: number; done: boolean; savable?: DownloadPauseState }[];
}

export type AnyPauseState = DownloadPauseState | PartedPauseState;
export type AnyDownload = DownloadTask | PartedDownload;

export function isPartedState(state: AnyPauseState): state is PartedPauseState {
  return (state as PartedPauseState).parted === true;
}

/** Seams the tests replace: task construction, the size probe and the native merge. */
export interface PartedDeps {
  createTask: (url: string, destination: File, options: DownloadTaskOptions) => DownloadTask;
  fromSavable: (state: DownloadPauseState, options: DownloadTaskOptions) => DownloadTask;
  merge: (request: { parts: string[]; outputPath: string }) => Promise<void>;
  probe: typeof fetch;
}

const defaultDeps: PartedDeps = {
  createTask: (url, destination, options) => File.createDownloadTask(url, destination, options),
  fromSavable: (state, options) => DownloadTask.fromSavable(state, options),
  merge: mergeDownloadParts,
  probe: fetch,
};

/**
 * The size a ranged probe reports, or null where the server ignores Range:
 * parts only make sense against a 206 with a total.
 */
async function rangedSize(url: string, headers: Record<string, string> | undefined, probe: typeof fetch): Promise<number | null> {
  try {
    const response = await probe(url, { headers: { ...headers, Range: "bytes=0-0" }, signal: AbortSignal.timeout(15000) });
    response.body?.cancel?.();
    if (response.status !== 206) return null;
    const total = Number(response.headers.get("content-range")?.split("/")[1]);
    return Number.isFinite(total) && total > 0 ? total : null;
  } catch {
    return null;
  }
}

/**
 * A parted download when the server answers ranges and the file is worth
 * splitting, the plain task otherwise.
 */
export async function createDownload(url: string, destination: File, options: DownloadTaskOptions, allowParts: boolean, deps: PartedDeps = defaultDeps): Promise<AnyDownload> {
  if (allowParts) {
    const total = await rangedSize(url, options.headers, deps.probe);
    if (total !== null && total >= 2 * MIN_PART_BYTES) {
      const plan = planParts(total);
      if (plan.length > 1) return new PartedDownload(url, destination, options, plan, undefined, deps);
    }
  }
  return deps.createTask(url, destination, options);
}

/** Rebuilds the download a pause recorded, parted or plain. */
export function restoreDownload(state: AnyPauseState, options: DownloadTaskOptions, deps: PartedDeps = defaultDeps): AnyDownload {
  if (isPartedState(state)) return new PartedDownload(state.url, new File(state.destinationUri), options, state.parts, state.states, deps);
  return deps.fromSavable(state, options);
}

export class PartedDownload {
  private readonly written = new Map<number, number>();
  private readonly done = new Set<number>();
  private readonly savables = new Map<number, DownloadPauseState>();
  private readonly running = new Map<number, DownloadTask>();
  private paused = false;
  private cancelled = false;

  constructor(
    private readonly url: string,
    private readonly destination: File,
    private readonly options: DownloadTaskOptions,
    private readonly plan: DownloadPart[],
    restored: PartedPauseState["states"] | undefined,
    private readonly deps: PartedDeps,
  ) {
    for (const state of restored ?? []) {
      if (state.done) {
        this.done.add(state.index);
        this.written.set(state.index, partSize(this.plan[state.index]));
      } else if (state.savable) {
        this.savables.set(state.index, state.savable);
      }
    }
  }

  private get totalBytes(): number {
    return this.plan.reduce((sum, part) => sum + partSize(part), 0);
  }

  private partFile(part: DownloadPart): File {
    return new File(`${this.destination.uri}.part${part.index}`);
  }

  private reportProgress(): void {
    this.options.onProgress?.({ bytesWritten: aggregateProgress(this.plan, this.written), totalBytes: this.totalBytes });
  }

  /** Runs one part to its end; resolves false when the run stopped (pause or cancel). */
  private async runPart(part: DownloadPart): Promise<boolean> {
    const options: DownloadTaskOptions = {
      headers: { ...this.options.headers, ...partRangeHeader(part) },
      sessionType: this.options.sessionType,
      onProgress: ({ bytesWritten }) => {
        this.written.set(part.index, bytesWritten);
        this.reportProgress();
      },
    };
    const saved = this.savables.get(part.index);
    this.savables.delete(part.index);
    const task = saved ? this.deps.fromSavable(saved, options) : this.deps.createTask(this.url, this.partFile(part), options);
    this.running.set(part.index, task);
    try {
      const file = saved ? await task.resumeAsync() : await task.downloadAsync();
      this.running.delete(part.index);
      if (!file) return false; // paused; pauseAsync() recorded the savable
      this.done.add(part.index);
      this.written.set(part.index, partSize(part));
      this.reportProgress();
      return true;
    } catch (error) {
      this.running.delete(part.index);
      throw error;
    }
  }

  private async run(): Promise<File | null> {
    const pending = this.plan.filter((part) => !this.done.has(part.index));
    const queue = [...pending];
    let failure: unknown = null;
    const workers = Array.from({ length: Math.min(PART_CONCURRENCY, queue.length) }, async () => {
      while (queue.length && !this.paused && !this.cancelled && !failure) {
        const part = queue.shift()!;
        try {
          await this.runPart(part);
        } catch (error) {
          failure = error;
        }
      }
    });
    await Promise.all(workers);
    if (failure) throw failure;
    if (this.cancelled) throw new Error("cancelled");
    if (this.paused || this.done.size < this.plan.length) return null;
    const parts = this.plan.map((part) => this.partFile(part).uri.replace(/^file:\/\//, ""));
    await this.deps.merge({ parts, outputPath: this.destination.uri.replace(/^file:\/\//, "") });
    logger.info("Parted download merged", { service: "Downloads", parts: parts.length, bytes: this.totalBytes });
    return new File(this.destination.uri);
  }

  downloadAsync(): Promise<File | null> {
    return this.run();
  }

  resumeAsync(): Promise<File | null> {
    return this.run();
  }

  async pauseAsync(): Promise<void> {
    this.paused = true;
    const active = [...this.running.entries()];
    await Promise.all(
      active.map(async ([index, task]) => {
        await task.pauseAsync();
        const saved = task.savable();
        if (saved.resumeData) this.savables.set(index, saved);
      }),
    );
  }

  savable(): PartedPauseState {
    return {
      parted: true,
      url: this.url,
      destinationUri: this.destination.uri,
      parts: this.plan,
      states: this.plan.map((part) => ({
        index: part.index,
        done: this.done.has(part.index),
        ...(this.savables.has(part.index) ? { savable: this.savables.get(part.index) } : {}),
      })),
    };
  }

  cancel(): void {
    this.cancelled = true;
    for (const task of this.running.values()) task.cancel();
    this.running.clear();
    for (const part of this.plan) {
      try {
        const file = this.partFile(part);
        if (file.exists) file.delete();
      } catch {}
    }
  }
}
