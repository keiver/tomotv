/** The guide disk cache: fresh copies skip the network, downloads replace atomically, failures serve stale. */
jest.mock("expo-file-system", () => require("./fakeFileSystem"));
jest.mock("@/utils/logger", () => ({ logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() } }));

import { PlaybackHoldError } from "@keiver/tomo-live";
import { cachedGuideFile, cachedPlaylistFile, clearGuideFileCache, guideCacheBytes, guideFileInfo, onGuideFileRefreshed } from "../guideFileCache";
import { setPlaybackHold } from "../playbackHold";
import { fakeFs, File } from "./fakeFileSystem";

const URL = "http://g/guide.xml.gz";
const HOUR = 60 * 60 * 1000;

type Behavior = { held?: boolean; error?: Error; resumeData?: string; lostPauses?: number };

/** A download task the test drives: it lands at once unless `held`; a pause yields `resumeData`.
 *  `lostPauses` drops that many pauses, as native does with one sent before its task exists. */
class Task {
  state = "idle";
  resumeData: string | undefined;
  downloads = 0;
  resumes = 0;
  pauses = 0;
  private settle: ((file: File | null) => void) | null = null;
  private failure: ((error: Error) => void) | null = null;
  constructor(
    public destination: File,
    public options: { headers?: Record<string, string>; sessionType?: string; onProgress?: (progress: { bytesWritten: number; totalBytes: number }) => void },
    private behavior: Behavior,
  ) {}
  private run(): Promise<File | null> {
    this.state = "active";
    return new Promise((resolve, reject) => {
      this.settle = resolve;
      this.failure = reject;
      if (this.behavior.error) this.fail(this.behavior.error);
      else if (!this.behavior.held) this.land();
    });
  }
  downloadAsync() {
    this.downloads++;
    return this.run();
  }
  resumeAsync() {
    this.resumes++;
    return this.run();
  }
  /** The native task's progress event: only a running task sends one. */
  report(bytesWritten = 1) {
    this.options.onProgress?.({ bytesWritten, totalBytes: 10 });
  }
  pause() {
    this.pauses++;
    if (this.pauses <= (this.behavior.lostPauses ?? 0)) return;
    this.state = "paused";
    this.resumeData = this.behavior.resumeData;
    this.settle?.(null);
  }
  savable() {
    return { url: URL, fileUri: this.destination.uri, isDirectory: false, resumeData: this.resumeData };
  }
  land() {
    this.destination.write("guide-bytes");
    this.state = "completed";
    this.settle?.(this.destination);
  }
  fail(error: Error) {
    this.state = "error";
    this.failure?.(error);
  }
}

const tasks: Task[] = [];
const createTask = File.createDownloadTask as jest.Mock;

function downloadsWith(behavior: Behavior = {}): void {
  createTask.mockImplementation((_url: string, destination: File, options: Task["options"]) => {
    const task = new Task(destination, options, behavior);
    tasks.push(task);
    return task;
  });
}

async function flush(): Promise<void> {
  for (let i = 0; i < 10; i++) await Promise.resolve();
}

/** Lets go of the link and waits out the settle window. */
async function release(owner = "video"): Promise<void> {
  setPlaybackHold(owner, false);
  jest.advanceTimersByTime(2000);
  await flush();
}

describe("cachedGuideFile", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    fakeFs.clear();
    clearGuideFileCache();
    tasks.length = 0;
    createTask.mockReset();
    downloadsWith();
  });
  afterEach(() => {
    setPlaybackHold("video", false);
    setPlaybackHold("audio", false);
    jest.useRealTimers();
  });

  it("downloads once, then serves the file without the network while it is fresh", async () => {
    const uri = await cachedGuideFile(URL);
    expect(uri.startsWith("file:///cache/guides/guide-")).toBe(true);
    expect(createTask).toHaveBeenCalledTimes(1);
    expect(tasks[0].options.sessionType).toBe("foreground");
    jest.setSystemTime(Date.now() + HOUR / 2);
    await expect(cachedGuideFile(URL)).resolves.toBe(uri);
    expect(createTask).toHaveBeenCalledTimes(1);
    // Past the freshness window it re-downloads to the same path.
    jest.setSystemTime(Date.now() + HOUR);
    await expect(cachedGuideFile(URL)).resolves.toBe(uri);
    expect(createTask).toHaveBeenCalledTimes(2);
  });

  it("sends the caller's headers with the download", async () => {
    await cachedPlaylistFile("http://t/one.m3u", undefined, { headers: { "User-Agent": "UA/1" } });
    expect(tasks[0].options.headers).toEqual({ "User-Agent": "UA/1" });
  });

  it("serves the stale copy when a re-download fails, and skips the network during the backoff", async () => {
    const uri = await cachedGuideFile(URL);
    jest.setSystemTime(Date.now() + 2 * HOUR);
    downloadsWith({ error: new Error("offline") });
    await expect(cachedGuideFile(URL)).resolves.toBe(uri);
    await expect(cachedGuideFile(URL)).resolves.toBe(uri);
    expect(createTask).toHaveBeenCalledTimes(2);
  });

  it("throws on a failed first download and keeps skipping while the failure is recent", async () => {
    downloadsWith({ error: new Error("offline") });
    await expect(cachedGuideFile(URL)).rejects.toThrow("offline");
    await expect(cachedGuideFile(URL)).rejects.toThrow("skipped after a recent failure");
    expect(createTask).toHaveBeenCalledTimes(1);
    jest.setSystemTime(Date.now() + 6 * 60 * 1000);
    downloadsWith();
    await expect(cachedGuideFile(URL)).resolves.toContain("guides/guide-");
  });

  it("force re-downloads inside the freshness window and past a recent failure", async () => {
    const uri = await cachedGuideFile(URL);
    await cachedGuideFile(URL, undefined, { force: true });
    expect(createTask).toHaveBeenCalledTimes(2);
    // A forced attempt ignores the failure backoff but still serves the stale copy on failure.
    downloadsWith({ error: new Error("offline") });
    await expect(cachedGuideFile(URL, undefined, { force: true })).resolves.toBe(uri);
    await expect(cachedGuideFile(URL, undefined, { force: true })).resolves.toBe(uri);
    expect(createTask).toHaveBeenCalledTimes(4);
  });

  it("keeps separate files per URL and sweeps copies older than two days", async () => {
    const first = await cachedGuideFile(URL);
    jest.setSystemTime(Date.now() + 49 * HOUR);
    const second = await cachedGuideFile("http://g/other.xml");
    expect(second).not.toBe(first);
    // The two-day-old copy is gone; the fresh one stays.
    expect([...fakeFs.keys()].filter((key) => key.includes("guide-"))).toEqual([second]);
  });

  it("spares the stale copy of a guide still in use", async () => {
    const first = await cachedGuideFile(URL);
    jest.setSystemTime(Date.now() + 49 * HOUR);
    const second = await cachedGuideFile("http://g/other.xml", undefined, { keep: [URL] });
    expect([...fakeFs.keys()].filter((key) => key.includes("guide-")).sort()).toEqual([first, second].sort());
  });

  it("reports a held copy's size and landing time, the total on disk, and nothing once cleared", async () => {
    expect(guideFileInfo(URL)).toBeNull();
    expect(guideCacheBytes()).toBe(0);
    const landed = Date.now();
    await cachedGuideFile(URL);
    await cachedGuideFile("http://g/other.xml");
    expect(guideFileInfo(URL)).toEqual({ bytes: "guide-bytes".length, savedAt: landed });
    expect(guideCacheBytes()).toBe(2 * "guide-bytes".length);
    clearGuideFileCache();
    expect(guideFileInfo(URL)).toBeNull();
    expect(guideCacheBytes()).toBe(0);
  });

  describe("while playback holds the link", () => {
    it("serves a fresh copy and owes nothing", async () => {
      const uri = await cachedGuideFile(URL);
      setPlaybackHold("video", true);
      await expect(cachedGuideFile(URL)).resolves.toBe(uri);
      await release();
      expect(createTask).toHaveBeenCalledTimes(1);
    });

    it("serves a stale copy at once and downloads it after playback lets go, then says so", async () => {
      const refreshed = jest.fn();
      const stop = onGuideFileRefreshed(refreshed);
      const uri = await cachedGuideFile(URL);
      jest.setSystemTime(Date.now() + 2 * HOUR);
      setPlaybackHold("video", true);
      await expect(cachedGuideFile(URL)).resolves.toBe(uri);
      await flush();
      expect(createTask).toHaveBeenCalledTimes(1);
      await release();
      expect(createTask).toHaveBeenCalledTimes(2);
      expect(refreshed).toHaveBeenCalledWith(URL);
      stop();
    });

    it("serves the copy for a forced refresh and downloads it after playback lets go", async () => {
      const refreshed = jest.fn();
      const stop = onGuideFileRefreshed(refreshed);
      const uri = await cachedGuideFile(URL);
      setPlaybackHold("audio", true);
      await expect(cachedGuideFile(URL, undefined, { force: true })).resolves.toBe(uri);
      await flush();
      expect(createTask).toHaveBeenCalledTimes(1);
      await release("audio");
      expect(createTask).toHaveBeenCalledTimes(2);
      expect(refreshed).toHaveBeenCalledTimes(1);
      stop();
    });

    it("tells a caller served the copy during playback when the download paused under it lands", async () => {
      const refreshed = jest.fn();
      const stop = onGuideFileRefreshed(refreshed);
      const uri = await cachedGuideFile(URL);
      jest.setSystemTime(Date.now() + 2 * HOUR);
      downloadsWith({ held: true, resumeData: "partial" });
      void cachedGuideFile(URL);
      await flush();
      const [, running] = tasks;
      running.report();
      setPlaybackHold("video", true);
      await expect(cachedGuideFile(URL)).resolves.toBe(uri);
      await release();
      running.land();
      await flush();
      expect(tasks).toHaveLength(2);
      expect(refreshed).toHaveBeenCalledWith(URL);
      stop();
    });

    it("owes nothing for a stale copy whose download failed recently", async () => {
      await cachedGuideFile(URL);
      jest.setSystemTime(Date.now() + 2 * HOUR);
      downloadsWith({ error: new Error("offline") });
      await cachedGuideFile(URL);
      setPlaybackHold("video", true);
      await cachedGuideFile(URL);
      await release();
      expect(createTask).toHaveBeenCalledTimes(2);
    });

    it("rejects a read with no copy at once, downloads after playback lets go, then serves the file", async () => {
      const refreshed = jest.fn();
      const stop = onGuideFileRefreshed(refreshed);
      setPlaybackHold("video", true);
      await expect(cachedGuideFile(URL)).rejects.toBeInstanceOf(PlaybackHoldError);
      expect(createTask).not.toHaveBeenCalled();
      await release();
      expect(createTask).toHaveBeenCalledTimes(1);
      expect(refreshed).toHaveBeenCalledWith(URL);
      await expect(cachedGuideFile(URL)).resolves.toContain("guides/guide-");
      expect(createTask).toHaveBeenCalledTimes(1);
      stop();
    });

    it("rejects a read with no copy and a recent failure as skipped, and downloads nothing after", async () => {
      downloadsWith({ error: new Error("offline") });
      await expect(cachedGuideFile(URL)).rejects.toThrow("offline");
      setPlaybackHold("video", true);
      await expect(cachedGuideFile(URL)).rejects.toThrow("skipped after a recent failure");
      await release();
      expect(createTask).toHaveBeenCalledTimes(1);
    });

    it("starts the owed download only once the link stays free for the settle window", async () => {
      setPlaybackHold("video", true);
      await expect(cachedGuideFile(URL)).rejects.toBeInstanceOf(PlaybackHoldError);
      setPlaybackHold("video", false);
      setPlaybackHold("audio", true);
      jest.advanceTimersByTime(2000);
      await flush();
      expect(createTask).not.toHaveBeenCalled();
      await release("audio");
      expect(createTask).toHaveBeenCalledTimes(1);
    });

    it("hands a waiting caller PlaybackHoldError when playback starts, and finishes the download after", async () => {
      const refreshed = jest.fn();
      const stop = onGuideFileRefreshed(refreshed);
      downloadsWith({ held: true, resumeData: "partial" });
      const waiting = cachedGuideFile(URL);
      await flush();
      const [task] = tasks;
      task.report();
      setPlaybackHold("video", true);
      await expect(waiting).rejects.toBeInstanceOf(PlaybackHoldError);
      expect(task.pauses).toBe(1);
      await release();
      expect(task.resumes).toBe(1);
      task.land();
      await flush();
      expect(refreshed).toHaveBeenCalledWith(URL);
      stop();
    });

    it("hands a waiting caller the copy on disk when playback starts", async () => {
      const uri = await cachedGuideFile(URL);
      jest.setSystemTime(Date.now() + 2 * HOUR);
      downloadsWith({ held: true, resumeData: "partial" });
      const waiting = cachedGuideFile(URL);
      await flush();
      tasks[1].report();
      setPlaybackHold("video", true);
      await expect(waiting).resolves.toBe(uri);
      await release();
      tasks[1].land();
      await flush();
    });

    it("stops a handed-off caller's progress, so the resumed download reports to nobody it left", async () => {
      await cachedGuideFile(URL);
      jest.setSystemTime(Date.now() + 2 * HOUR);
      downloadsWith({ held: true, resumeData: "partial" });
      const onProgress = jest.fn();
      void cachedGuideFile(URL, onProgress);
      await flush();
      tasks[1].report();
      expect(onProgress).toHaveBeenCalledTimes(1);
      setPlaybackHold("video", true);
      await release();
      tasks[1].report();
      expect(onProgress).toHaveBeenCalledTimes(1);
      tasks[1].land();
      await flush();
    });

    it("pauses the moment playback starts, before any bytes have arrived", async () => {
      downloadsWith({ held: true, resumeData: "partial" });
      cachedGuideFile(URL).catch(() => {});
      await flush();
      const [task] = tasks;
      setPlaybackHold("video", true);
      expect(task.pauses).toBe(1);
      expect(task.state).toBe("paused");
      await release();
      task.land();
      await flush();
    });

    it("sends a pause lost before the native task existed again at the first bytes", async () => {
      downloadsWith({ held: true, resumeData: "partial", lostPauses: 1 });
      cachedGuideFile(URL).catch(() => {});
      await flush();
      const [task] = tasks;
      setPlaybackHold("video", true);
      expect(task.pauses).toBe(1);
      expect(task.state).toBe("active");
      task.report();
      expect(task.pauses).toBe(2);
      expect(task.state).toBe("paused");
      await release();
      task.land();
      await flush();
    });

    it("never repeats a pause sent after bytes arrived", async () => {
      downloadsWith({ held: true, resumeData: "partial", lostPauses: 1 });
      cachedGuideFile(URL).catch(() => {});
      await flush();
      const [task] = tasks;
      task.report();
      setPlaybackHold("video", true);
      expect(task.pauses).toBe(1);
      task.report();
      expect(task.pauses).toBe(1);
      task.land();
      await release();
      await flush();
    });

    it("starts over after playback when the pause left no resume data", async () => {
      downloadsWith({ held: true });
      cachedGuideFile(URL).catch(() => {});
      await flush();
      tasks[0].report();
      setPlaybackHold("video", true);
      await flush();
      await release();
      expect(tasks).toHaveLength(2);
      expect(tasks[1].downloads).toBe(1);
      tasks[1].land();
      await flush();
      await expect(cachedGuideFile(URL)).resolves.toContain("guides/guide-");
    });
  });
});
