import { setPlaybackProbeEnabled, probeEmit, probeProgress, PROBE_FILENAME } from "../playbackProbe";

jest.mock("expo-file-system", () => {
  const writes: { name: string; content: string }[] = [];
  class File {
    name: string;
    constructor(_dir: string, name: string) {
      this.name = name;
    }
    write(content: string) {
      writes.push({ name: this.name, content });
    }
  }
  return { Paths: { document: "file:///docs/" }, File, __writes: writes };
});

const { __writes: writes } = jest.requireMock("expo-file-system") as { __writes: { name: string; content: string }[] };

/** Events parsed from the most recent full-file rewrite. */
function lastFileEvents(): { event: string; itemId: string | null; [k: string]: unknown }[] {
  const last = writes[writes.length - 1];
  return last.content
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

describe("playbackProbe", () => {
  beforeEach(() => {
    writes.length = 0;
    setPlaybackProbeEnabled(false, "none");
  });

  it("records nothing while disarmed", () => {
    probeEmit("mode", { mode: "direct" });
    probeProgress(5);
    expect(writes).toHaveLength(0);
  });

  it("arming resets the log and emits start; events carry the item id", () => {
    setPlaybackProbeEnabled(true, "item-a");
    probeEmit("mode", { mode: "localRemux" });

    const events = lastFileEvents();
    expect(writes[writes.length - 1].name).toBe(PROBE_FILENAME);
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
    const writesWhenArmed = writes.length;
    setPlaybackProbeEnabled(false, "item-a");
    probeEmit("error", { message: "late" });
    expect(writes).toHaveLength(writesWhenArmed);
  });
});
