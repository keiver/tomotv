import {
  clearLastSession,
  getLastSessionVersion,
  noteDeviceDecode,
  probeEmit,
  probeFirstPlaying,
  probeProgress,
  readLastSession,
  setPlaybackProbeEnabled,
  subscribeLastSession,
  PROBE_FILENAME,
  SESSION_FILENAME,
} from "../playbackProbe";

jest.mock("expo-file-system", () => {
  const writes: { dir: string; name: string; content: string }[] = [];
  const files = new Map<string, string>();
  class File {
    dir: string;
    name: string;
    constructor(dir: string, name: string) {
      this.dir = dir;
      this.name = name;
    }
    write(content: string) {
      writes.push({ dir: this.dir, name: this.name, content });
      files.set(this.name, content);
    }
    create() {
      if (!files.has(this.name)) files.set(this.name, "");
    }
    delete() {
      files.delete(this.name);
    }
    get exists() {
      return files.has(this.name);
    }
    textSync() {
      return files.get(this.name) ?? "";
    }
  }
  return { Paths: { document: "file:///docs/", cache: "file:///cache/" }, File, __writes: writes, __files: files };
});

jest.mock("@/services/engineVerdicts", () => ({ clearVerdicts: jest.fn() }));
const { clearVerdicts } = jest.requireMock("@/services/engineVerdicts") as { clearVerdicts: jest.Mock };

const { __writes: writes, __files: files } = jest.requireMock("expo-file-system") as { __writes: { dir: string; name: string; content: string }[]; __files: Map<string, string> };

const suiteWrites = () => writes.filter((w) => w.name === PROBE_FILENAME);
const sessionWrites = () => writes.filter((w) => w.name === SESSION_FILENAME);

/** Events parsed from the suite sink's most recent full-file rewrite. */
function lastFileEvents(): { event: string; itemId: string | null; [k: string]: unknown }[] {
  const last = suiteWrites()[suiteWrites().length - 1];
  return last.content
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

describe("playbackProbe suite sink", () => {
  beforeEach(() => {
    writes.length = 0;
    files.clear();
    setPlaybackProbeEnabled(null, "none");
  });

  it("records nothing while disarmed", () => {
    probeEmit("mode", { mode: "direct" });
    probeProgress(5);
    expect(suiteWrites()).toHaveLength(0);
  });

  it("arming resets the log and emits start; events carry the item id", () => {
    setPlaybackProbeEnabled("1", "item-a");
    probeEmit("mode", { mode: "localRemux" });

    const events = lastFileEvents();
    expect(events.map((e) => e.event)).toEqual(["start", "mode"]);
    expect(events[1]).toMatchObject({ itemId: "item-a", mode: "localRemux" });
  });

  it("re-arming with a new item id starts a fresh log", () => {
    setPlaybackProbeEnabled("1", "item-a");
    probeEmit("mode", { mode: "direct" });
    setPlaybackProbeEnabled("1", "item-b");

    const events = lastFileEvents();
    expect(events.map((e) => e.event)).toEqual(["start"]);
    expect(events[0].itemId).toBe("item-b");
  });

  it("throttles progress samples", () => {
    setPlaybackProbeEnabled("1", "item-a");
    probeProgress(1);
    probeProgress(2); // within the throttle window, dropped

    const progressEvents = lastFileEvents().filter((e) => e.event === "progress");
    expect(progressEvents).toHaveLength(1);
    expect(progressEvents[0].position).toBe(1);
  });

  it("disarming stops recording without clearing the armed item's file", () => {
    setPlaybackProbeEnabled("1", "item-a");
    const armed = suiteWrites().length;
    setPlaybackProbeEnabled(null, "item-a");
    probeEmit("error", { message: "late" });
    expect(suiteWrites()).toHaveLength(armed);
  });

  it("keeps the stream URL raw, because the driver reads it back", () => {
    setPlaybackProbeEnabled("1", "item-a");
    probeEmit("stream", { url: "http://host:8096/Videos/x/stream?Static=true&ApiKey=secret123" });
    expect(lastFileEvents()[1].url).toContain("ApiKey=secret123");
  });

  it("a URL sink POSTs each event to the driver in order, writes no file, and clears the verdicts", async () => {
    const bodies: string[] = [];
    const fetchMock = jest.fn(async (_url: string, init: { body: string }) => {
      bodies.push(init.body);
      return { ok: true, status: 200 };
    });
    global.fetch = fetchMock as unknown as typeof fetch;
    clearVerdicts.mockClear();

    setPlaybackProbeEnabled("http://10.0.0.2:9000/probe", "item-a");
    probeEmit("mode", { mode: "localRemux" });
    probeEmit("ended");
    await new Promise((resolve) => setImmediate(resolve));

    expect(fetchMock.mock.calls.every(([url]) => url === "http://10.0.0.2:9000/probe")).toBe(true);
    expect(bodies.map((b) => JSON.parse(b).event)).toEqual(["start", "mode", "ended"]);
    expect(JSON.parse(bodies[1])).toMatchObject({ itemId: "item-a", mode: "localRemux" });
    expect(suiteWrites()).toHaveLength(0);
    expect(clearVerdicts).toHaveBeenCalledTimes(1);
  });

  it("a send the driver refuses does not stop the ones after it", async () => {
    const bodies: string[] = [];
    global.fetch = jest.fn(async (_url: string, init: { body: string }) => {
      bodies.push(init.body);
      return bodies.length === 1 ? { ok: false, status: 500 } : { ok: true, status: 200 };
    }) as unknown as typeof fetch;

    setPlaybackProbeEnabled("http://10.0.0.2:9000/probe", "item-b");
    probeEmit("mode", { mode: "direct" });
    await new Promise((resolve) => setImmediate(resolve));

    expect(bodies.map((b) => JSON.parse(b).event)).toEqual(["start", "mode"]);
  });
});

describe("playbackProbe session sink", () => {
  beforeEach(() => {
    writes.length = 0;
    files.clear();
    setPlaybackProbeEnabled(null, "none");
    probeEmit("ended");
    writes.length = 0;
    files.clear();
    setPlaybackProbeEnabled(null, "reset");
  });

  it("records in memory while the suite sink is disarmed, each event naming the item", () => {
    setPlaybackProbeEnabled(null, "item-a");
    probeEmit("mode", { mode: "direct" });

    expect(suiteWrites()).toHaveLength(0);
    expect(readLastSession()?.playback).toMatchObject({ itemId: "item-a", outcome: "playing" });
    expect(readLastSession()?.playback.events).toEqual([expect.objectContaining({ event: "mode", itemId: "item-a", mode: "direct" })]);
  });

  it("names the item now playing, not the one the suite last armed", () => {
    setPlaybackProbeEnabled("1", "item-a");
    probeEmit("mode", { mode: "direct" });
    setPlaybackProbeEnabled(null, "item-b");
    probeEmit("mode", { mode: "transcode" });

    expect(readLastSession()?.playback.events).toEqual([expect.objectContaining({ itemId: "item-b", mode: "transcode" })]);
  });

  it("redacts the api key the suite sink keeps", () => {
    setPlaybackProbeEnabled(null, "item-a");
    probeEmit("stream", { url: "http://host:8096/Videos/x/stream?Static=true&ApiKey=secret123" });

    const url = String(readLastSession()?.playback.events[0].url);
    expect(url).toContain("ApiKey=[redacted]");
    expect(url).not.toContain("secret123");
  });

  it("keeps one session, replacing the previous playback", () => {
    setPlaybackProbeEnabled(null, "item-a");
    probeEmit("mode", { mode: "direct" });
    setPlaybackProbeEnabled(null, "item-b");
    probeEmit("mode", { mode: "transcode" });

    expect(readLastSession()?.playback.itemId).toBe("item-b");
    expect(readLastSession()?.playback.events).toHaveLength(1);
  });

  it("replaying the same item starts a fresh session", () => {
    setPlaybackProbeEnabled(null, "item-a");
    probeEmit("mode", { mode: "direct" });
    probeEmit("ended");
    setPlaybackProbeEnabled(null, "item-a");
    probeEmit("mode", { mode: "localRemux" });

    expect(readLastSession()?.playback).toMatchObject({ itemId: "item-a", outcome: "playing" });
    expect(readLastSession()?.playback.events).toHaveLength(1);
  });

  it("a retried error does not decide the outcome", () => {
    setPlaybackProbeEnabled(null, "item-a");
    probeEmit("error", { message: "engine failed", willRetry: true });
    expect(readLastSession()?.playback.outcome).toBe("playing");

    probeEmit("error", { message: "server failed too", willRetry: false });
    expect(readLastSession()?.playback.outcome).toBe("error");
  });

  it("caps progress samples without dropping the session", () => {
    setPlaybackProbeEnabled(null, "item-a");
    for (let i = 0; i < 25; i++) {
      probeEmit("progress", { position: i });
    }
    probeEmit("ended");

    const progress = readLastSession()?.playback.progress ?? [];
    expect(progress).toHaveLength(10);
    expect(progress[progress.length - 1].position).toBe(24);
  });

  it("caps events, keeping the opening decisions and the latest activity", () => {
    setPlaybackProbeEnabled(null, "item-a");
    probeEmit("mode", { mode: "direct" });
    for (let i = 0; i < 60; i++) {
      probeEmit("qualitySwitch", { to: `q${i}` });
    }

    const events = readLastSession()?.playback.events ?? [];
    expect(events).toHaveLength(40);
    expect(events[0].event).toBe("mode");
    expect(events[events.length - 1].to).toBe("q59");
  });

  it("marks the outcome so the screen can lead with it", () => {
    setPlaybackProbeEnabled(null, "item-a");
    probeEmit("error", { message: "failed to load" });
    expect(readLastSession()?.playback.outcome).toBe("error");

    setPlaybackProbeEnabled(null, "item-b");
    probeEmit("ended");
    expect(readLastSession()?.playback.outcome).toBe("ended");
  });

  it("mirrors to disk on every event, progress included, and never into Documents", () => {
    setPlaybackProbeEnabled(null, "item-a");
    probeEmit("mode", { mode: "direct" });
    expect(sessionWrites()).toHaveLength(1);
    expect(sessionWrites()[0].dir).toBe("file:///cache/");

    probeProgress(5);
    probeEmit("ended");
    expect(sessionWrites()).toHaveLength(3);
    expect(JSON.parse(files.get(SESSION_FILENAME) ?? "{}")).toMatchObject({ schemaVersion: 2, playback: { outcome: "ended", progress: [{ position: 5 }] } });
  });

  it("stamps the session with the build and the machine that recorded it", () => {
    setPlaybackProbeEnabled(null, "item-a");
    probeEmit("mode", { mode: "direct" });
    expect(readLastSession()).toMatchObject({
      schemaVersion: 2,
      app: { name: "Tomo TV", version: "9.9.9", build: "" },
      os: { name: "iOS", version: expect.any(String) },
      device: { family: "iPhone", model: null, marketingName: null, cores: null, memoryBytes: null, decode: null },
    });
  });

  it("carries what the device decodes once the engine has said", () => {
    noteDeviceDecode({ hevc: true, hevcMain10: true, av1: false, h264MaxHeight: null, hevcMaxHeight: null });
    setPlaybackProbeEnabled(null, "item-a");
    probeEmit("mode", { mode: "direct" });
    expect(readLastSession()?.device.decode).toEqual({ hevc: true, hevcMain10: true, av1: false, h264MaxHeight: null, hevcMaxHeight: null });
  });

  it("recovers a stored document when memory is empty, lifts a version 1 file, and drops one without a stamp", () => {
    const stored = { itemId: "old", startedAt: 0, outcome: "ended", events: [{ t: 1, event: "mode" }], progress: [] };
    files.set(SESSION_FILENAME, JSON.stringify({ ...stored, app: "Tomo TV 1.0.0 (1)", os: "tvOS 18.1" }));
    expect(readLastSession()).toMatchObject({
      schemaVersion: 2,
      app: { name: "Tomo TV", version: "1.0.0", build: "1" },
      os: { name: "tvOS", version: "18.1" },
      device: { family: "iPhone" },
      playback: { itemId: "old" },
    });

    setPlaybackProbeEnabled(null, "item-a");
    probeEmit("mode", { mode: "direct" });
    const document = files.get(SESSION_FILENAME) ?? "{}";
    setPlaybackProbeEnabled(null, "");
    clearLastSession();
    files.set(SESSION_FILENAME, document);
    expect(readLastSession()?.playback.itemId).toBe("item-a");

    files.set(SESSION_FILENAME, JSON.stringify(stored));
    expect(readLastSession()).toBeNull();
  });

  it("never writes an empty session over a stored one", () => {
    setPlaybackProbeEnabled(null, "item-a");
    probeEmit("mode", { mode: "direct" });
    probeEmit("ended");
    const stored = sessionWrites().length;

    setPlaybackProbeEnabled(null, "item-b");
    expect(sessionWrites()).toHaveLength(stored);
    expect(JSON.parse(files.get(SESSION_FILENAME) ?? "{}").playback.itemId).toBe("item-a");
  });

  it("ignores a mount with no video id", () => {
    setPlaybackProbeEnabled(null, "item-a");
    probeEmit("mode", { mode: "direct" });
    setPlaybackProbeEnabled(null, "");
    expect(readLastSession()?.playback).toMatchObject({ itemId: "item-a" });
  });

  it("nothing has played: no memory, no file", () => {
    expect(readLastSession()).toBeNull();
  });

  it("clearing forgets memory and the file, and a playback still running records nothing more", () => {
    setPlaybackProbeEnabled(null, "item-a");
    probeEmit("mode", { mode: "direct" });
    expect(files.has(SESSION_FILENAME)).toBe(true);

    clearLastSession();
    expect(readLastSession()).toBeNull();
    expect(files.has(SESSION_FILENAME)).toBe(false);

    probeEmit("ended");
    expect(readLastSession()).toBeNull();
    expect(files.has(SESSION_FILENAME)).toBe(false);
  });

  it("tells a subscriber on every write and on a clear, bumping the version each time", () => {
    const listener = jest.fn();
    const unsubscribe = subscribeLastSession(listener);
    const before = getLastSessionVersion();
    setPlaybackProbeEnabled(null, "item-a");
    probeEmit("mode", { mode: "direct" });
    probeProgress(3);
    clearLastSession();
    expect(listener).toHaveBeenCalledTimes(3);
    expect(getLastSessionVersion()).toBe(before + 3);

    unsubscribe();
    setPlaybackProbeEnabled(null, "item-b");
    probeEmit("ended");
    expect(listener).toHaveBeenCalledTimes(3);
  });
});

describe("probeFirstPlaying", () => {
  beforeEach(() => {
    writes.length = 0;
    files.clear();
    jest.restoreAllMocks();
  });

  it("records one playing event with the seconds since the session opened", () => {
    const now = jest.spyOn(Date, "now");
    now.mockReturnValue(10_000);
    setPlaybackProbeEnabled(null, "item-a");
    now.mockReturnValue(12_940);
    probeFirstPlaying();
    const events = readLastSession()?.playback.events ?? [];
    expect(events.map((e) => e.event)).toEqual(["playing"]);
    expect(events[0].afterSeconds).toBe(2.9);
  });

  it("ignores every call after the first in the same session", () => {
    const now = jest.spyOn(Date, "now");
    now.mockReturnValue(10_000);
    setPlaybackProbeEnabled(null, "item-a");
    now.mockReturnValue(11_000);
    probeFirstPlaying();
    now.mockReturnValue(50_000);
    probeFirstPlaying();
    probeFirstPlaying();
    const events = readLastSession()?.playback.events ?? [];
    expect(events.filter((e) => e.event === "playing")).toHaveLength(1);
    expect(events[0].afterSeconds).toBe(1);
  });

  it("starts counting again for a new session", () => {
    const now = jest.spyOn(Date, "now");
    now.mockReturnValue(10_000);
    setPlaybackProbeEnabled(null, "item-a");
    now.mockReturnValue(11_500);
    probeFirstPlaying();
    now.mockReturnValue(20_000);
    setPlaybackProbeEnabled(null, "item-b");
    now.mockReturnValue(20_400);
    probeFirstPlaying();
    const events = readLastSession()?.playback.events ?? [];
    expect(events).toHaveLength(1);
    expect(events[0].afterSeconds).toBe(0.4);
  });

  it("does nothing without a session", () => {
    setPlaybackProbeEnabled(null, "");
    expect(() => probeFirstPlaying()).not.toThrow();
  });

  it("rounds to a tenth of a second", () => {
    const now = jest.spyOn(Date, "now");
    now.mockReturnValue(0);
    setPlaybackProbeEnabled(null, "item-a");
    now.mockReturnValue(1_249);
    probeFirstPlaying();
    expect(readLastSession()?.playback.events[0].afterSeconds).toBe(1.2);
  });
});
