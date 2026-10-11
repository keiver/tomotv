jest.mock("expo-file-system", () => require("./fakeFileSystem"));
jest.mock("@keiver/tomo-engine", () => ({ mergeDownloadParts: jest.fn(), canMergeParts: jest.fn(() => true) }));
jest.mock("@/utils/logger", () => ({ logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() } }));

import { File } from "./fakeFileSystem";
import { createDownload, isPartedState, PartedDownload, restoreDownload, type PartedDeps, type PartedPauseState } from "@/services/downloads/partedDownload";
import { MIN_PART_BYTES } from "@/services/downloads/partPlan";

const TOTAL = MIN_PART_BYTES * 3;

interface FakeTask {
  downloadAsync: jest.Mock;
  resumeAsync: jest.Mock;
  pauseAsync: jest.Mock;
  savable: jest.Mock;
  cancel: jest.Mock;
}

function finishedTask(file: unknown): FakeTask {
  return {
    downloadAsync: jest.fn(async () => file),
    resumeAsync: jest.fn(async () => file),
    pauseAsync: jest.fn(async () => {}),
    savable: jest.fn(() => ({ resumeData: "r" })),
    cancel: jest.fn(),
  };
}

function probeAnswering(status: number, total = TOTAL): typeof fetch {
  return jest.fn(async () => ({
    status,
    headers: { get: (name: string) => (name === "content-range" ? `bytes 0-0/${total}` : null) },
    body: { cancel: () => {} },
  })) as unknown as typeof fetch;
}

function deps(overrides: Partial<Record<keyof PartedDeps, unknown>>): PartedDeps {
  const base = {
    createTask: jest.fn(() => finishedTask({})),
    fromSavable: jest.fn(() => finishedTask({})),
    merge: jest.fn(async () => {}),
    canMerge: jest.fn(() => true),
    probe: probeAnswering(206),
  };
  return { ...base, ...overrides } as unknown as PartedDeps;
}

const destination = () => new File("file:///doc/item/media.mkv");
const options = () => ({ headers: { Authorization: "MediaBrowser x" }, onProgress: jest.fn() });

describe("createDownload", () => {
  it("stays a plain task when the server ignores ranges", async () => {
    const plain = finishedTask({});
    const d = deps({ probe: probeAnswering(200), createTask: jest.fn(() => plain) });
    const task = await createDownload("http://s/file", destination() as never, options(), true, d);
    expect(task).toBe(plain);
    expect(d.createTask).toHaveBeenCalledTimes(1);
  });

  it("stays plain when the native binary lacks the merge", async () => {
    const d = deps({ canMerge: jest.fn(() => false) });
    expect(await createDownload("http://s/f", destination() as never, options(), true, d)).not.toBeInstanceOf(PartedDownload);
    expect(d.probe).not.toHaveBeenCalled();
  });

  it("stays plain below two minimum parts, and for conversions", async () => {
    const d = deps({ probe: probeAnswering(206, MIN_PART_BYTES * 2 - 1) });
    expect(await createDownload("http://s/f", destination() as never, options(), true, d)).not.toBeInstanceOf(PartedDownload);
    const d2 = deps({});
    expect(await createDownload("http://s/f", destination() as never, options(), false, d2)).not.toBeInstanceOf(PartedDownload);
    expect(d2.probe).not.toHaveBeenCalled();
  });

  it("splits a ranged file, fetches each part with its own Range, merges in order", async () => {
    const ranges: (string | undefined)[] = [];
    const d = deps({
      createTask: jest.fn((url, partFile, opts) => {
        ranges.push((opts.headers as Record<string, string>).Range);
        opts.onProgress?.({ bytesWritten: 1, totalBytes: 0 });
        return finishedTask(partFile) as never;
      }),
    });
    const opts = options();
    const task = await createDownload("http://s/file", destination() as never, opts, true, d);
    expect(task).toBeInstanceOf(PartedDownload);
    const file = await (task as PartedDownload).downloadAsync();
    expect(file?.uri).toBe("file:///doc/item/media.mkv");
    expect(ranges).toEqual([`bytes=0-${MIN_PART_BYTES - 1}`, `bytes=${MIN_PART_BYTES}-${2 * MIN_PART_BYTES - 1}`, `bytes=${2 * MIN_PART_BYTES}-${TOTAL - 1}`]);
    expect(d.merge).toHaveBeenCalledWith({
      parts: ["/doc/item/media.mkv.part0", "/doc/item/media.mkv.part1", "/doc/item/media.mkv.part2"],
      outputPath: "/doc/item/media.mkv",
    });
    const last = (opts.onProgress as jest.Mock).mock.calls.at(-1)?.[0];
    expect(last).toEqual({ bytesWritten: TOTAL, totalBytes: TOTAL });
  });

  it("a failing part fails the download", async () => {
    const d = deps({
      createTask: jest
        .fn()
        .mockImplementationOnce(() => finishedTask({}))
        .mockImplementationOnce(() => ({ ...finishedTask({}), downloadAsync: jest.fn(async () => Promise.reject(new Error("part died"))) }))
        .mockImplementation(() => finishedTask({})),
    });
    const task = (await createDownload("http://s/file", destination() as never, options(), true, d)) as PartedDownload;
    await expect(task.downloadAsync()).rejects.toThrow("part died");
    expect(d.merge).not.toHaveBeenCalled();
  });
});

describe("pause, savable and restore", () => {
  it("pause answers null, savable records done and resumable parts, restore finishes the rest", async () => {
    const releases: ((value: null) => void)[] = [];
    const stuckTask = (): FakeTask => ({
      downloadAsync: jest.fn(() => new Promise<null>((resolve) => releases.push(resolve))),
      resumeAsync: jest.fn(async () => ({})),
      pauseAsync: jest.fn(async () => {}),
      savable: jest.fn(() => ({ resumeData: "part-resume" })),
      cancel: jest.fn(),
    });
    const d = deps({
      createTask: jest
        .fn()
        .mockImplementationOnce((url, partFile) => finishedTask(partFile))
        .mockImplementationOnce(() => stuckTask())
        .mockImplementationOnce(() => stuckTask()),
    });
    const task = (await createDownload("http://s/file", destination() as never, options(), true, d)) as PartedDownload;
    const running = task.downloadAsync();
    await new Promise((resolve) => setTimeout(resolve, 0));
    const pausing = task.pauseAsync();
    releases.forEach((release) => release(null));
    await pausing;
    expect(await running).toBeNull();

    const saved = task.savable();
    expect(isPartedState(saved)).toBe(true);
    expect(saved.states.filter((part) => part.done)).toHaveLength(1);
    expect(saved.states.filter((part) => part.savable)).toHaveLength(2);

    const d2 = deps({});
    const restored = restoreDownload(saved, options(), d2) as PartedDownload;
    expect(await restored.resumeAsync()).not.toBeNull();
    expect(d2.fromSavable).toHaveBeenCalledTimes(2);
    expect(d2.createTask).not.toHaveBeenCalled();
    expect(d2.merge).toHaveBeenCalledTimes(1);
  });

  it("cancel rejects the run and deletes part files", async () => {
    let releaseAll: (value: null) => void = () => {};
    const gate = new Promise<null>((resolve) => (releaseAll = resolve));
    const d = deps({
      createTask: jest.fn((url, partFile: File) => {
        partFile.write("bytes");
        return {
          downloadAsync: jest.fn(() => gate),
          resumeAsync: jest.fn(() => gate),
          pauseAsync: jest.fn(async () => {}),
          savable: jest.fn(() => ({})),
          cancel: jest.fn(),
        } as never;
      }),
    });
    const task = (await createDownload("http://s/file", destination() as never, options(), true, d)) as PartedDownload;
    const running = task.downloadAsync();
    await new Promise((resolve) => setTimeout(resolve, 0));
    task.cancel();
    releaseAll(null);
    await expect(running).rejects.toThrow("cancelled");
    expect(new File("file:///doc/item/media.mkv.part0").exists).toBe(false);
    expect(new File("file:///doc/item/media.mkv.part1").exists).toBe(false);
  });
});

describe("restoreDownload for plain states", () => {
  it("hands a non-parted savable to DownloadTask.fromSavable", () => {
    const plain = finishedTask({});
    const d = deps({ fromSavable: jest.fn(() => plain) });
    const task = restoreDownload({ url: "u", resumeData: "r" } as never, options(), d);
    expect(task).toBe(plain);
  });
});

type _Assert = PartedPauseState;
