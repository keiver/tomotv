import { setPlaybackProbeEnabled, probeEmit, probeProgress, readLastSession, PROBE_FILENAME, SESSION_FILENAME } from "../playbackProbe";

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
    setPlaybackProbeEnabled(false, "none");
  });

  it("records nothing while disarmed", () => {
    probeEmit("mode", { mode: "direct" });
    probeProgress(5);
    expect(suiteWrites()).toHaveLength(0);
  });

  it("arming resets the log and emits start; events carry the item id", () => {
    setPlaybackProbeEnabled(true, "item-a");
    probeEmit("mode", { mode: "localRemux" });

    const events = lastFileEvents();
    expect(events.map((e) => e.event)).toEqual(["start", "mode"]);
    expect(events[1]).toMatchObject({ itemId: "item-a", mode: "localRemux" });
  });

  it("re-arming with a new item id starts a fresh log", () => {
    setPlaybackProbeEnabled(true, "item-a");
    probeEmit("mode", { mode: "direct" });
    setPlaybackProbeEnabled(true, "item-b");

    const events = lastFileEvents();
    expect(events.map((e) => e.event)).toEqual(["start"]);
    expect(events[0].itemId).toBe("item-b");
  });

  it("throttles progress samples", () => {
    setPlaybackProbeEnabled(true, "item-a");
    probeProgress(1);
    probeProgress(2); // within the throttle window, dropped

    const progressEvents = lastFileEvents().filter((e) => e.event === "progress");
    expect(progressEvents).toHaveLength(1);
    expect(progressEvents[0].position).toBe(1);
  });

  it("disarming stops recording without clearing the armed item's file", () => {
    setPlaybackProbeEnabled(true, "item-a");
    const armed = suiteWrites().length;
    setPlaybackProbeEnabled(false, "item-a");
    probeEmit("error", { message: "late" });
    expect(suiteWrites()).toHaveLength(armed);
  });

  it("keeps the stream URL raw, because the driver reads it back", () => {
    setPlaybackProbeEnabled(true, "item-a");
    probeEmit("stream", { url: "http://host:8096/Videos/x/stream?Static=true&ApiKey=secret123" });
    expect(lastFileEvents()[1].url).toContain("ApiKey=secret123");
  });
});

describe("playbackProbe session sink", () => {
  beforeEach(() => {
    writes.length = 0;
    files.clear();
    setPlaybackProbeEnabled(false, "none");
    probeEmit("ended");
    writes.length = 0;
    files.clear();
    setPlaybackProbeEnabled(false, "reset");
  });

  it("records in memory while the suite sink is disarmed", () => {
    setPlaybackProbeEnabled(false, "item-a");
    probeEmit("mode", { mode: "direct" });

    expect(suiteWrites()).toHaveLength(0);
    expect(readLastSession()).toMatchObject({ itemId: "item-a", outcome: "playing" });
    expect(readLastSession()?.events.map((e) => e.event)).toEqual(["mode"]);
  });

  it("redacts the api key the suite sink keeps", () => {
    setPlaybackProbeEnabled(false, "item-a");
    probeEmit("stream", { url: "http://host:8096/Videos/x/stream?Static=true&ApiKey=secret123" });

    const url = String(readLastSession()?.events[0].url);
    expect(url).toContain("ApiKey=[redacted]");
    expect(url).not.toContain("secret123");
  });

  it("keeps one session, replacing the previous playback", () => {
    setPlaybackProbeEnabled(false, "item-a");
    probeEmit("mode", { mode: "direct" });
    setPlaybackProbeEnabled(false, "item-b");
    probeEmit("mode", { mode: "transcode" });

    expect(readLastSession()?.itemId).toBe("item-b");
    expect(readLastSession()?.events).toHaveLength(1);
  });

  it("caps progress samples without dropping the session", () => {
    setPlaybackProbeEnabled(false, "item-a");
    for (let i = 0; i < 25; i++) {
      probeEmit("progress", { position: i });
    }
    probeEmit("ended");

    const progress = readLastSession()?.progress ?? [];
    expect(progress).toHaveLength(10);
    expect(progress[progress.length - 1].position).toBe(24);
  });

  it("caps events, keeping the opening decisions and the latest activity", () => {
    setPlaybackProbeEnabled(false, "item-a");
    probeEmit("mode", { mode: "direct" });
    for (let i = 0; i < 60; i++) {
      probeEmit("qualitySwitch", { to: `q${i}` });
    }

    const events = readLastSession()?.events ?? [];
    expect(events).toHaveLength(40);
    expect(events[0].event).toBe("mode");
    expect(events[events.length - 1].to).toBe("q59");
  });

  it("marks the outcome so the screen can lead with it", () => {
    setPlaybackProbeEnabled(false, "item-a");
    probeEmit("error", { message: "failed to load" });
    expect(readLastSession()?.outcome).toBe("error");

    setPlaybackProbeEnabled(false, "item-b");
    probeEmit("ended");
    expect(readLastSession()?.outcome).toBe("ended");
  });

  it("mirrors to disk on a terminal event only, and never into Documents", () => {
    setPlaybackProbeEnabled(false, "item-a");
    probeEmit("mode", { mode: "direct" });
    expect(sessionWrites()).toHaveLength(0);

    probeEmit("ended");
    expect(sessionWrites()).toHaveLength(1);
    expect(sessionWrites()[0].dir).toBe("file:///cache/");
  });

  it("never writes an empty session over a stored one", () => {
    setPlaybackProbeEnabled(false, "item-a");
    probeEmit("mode", { mode: "direct" });
    probeEmit("ended");
    const stored = sessionWrites().length;

    setPlaybackProbeEnabled(false, "item-b");
    expect(sessionWrites()).toHaveLength(stored);
    expect(JSON.parse(files.get(SESSION_FILENAME) ?? "{}").itemId).toBe("item-a");
  });

  it("ignores a mount with no video id", () => {
    setPlaybackProbeEnabled(false, "item-a");
    probeEmit("mode", { mode: "direct" });
    setPlaybackProbeEnabled(false, "");
    expect(readLastSession()).toMatchObject({ itemId: "item-a" });
  });

  it("nothing has played: no memory, no file", () => {
    expect(readLastSession()).toBeNull();
  });
});
