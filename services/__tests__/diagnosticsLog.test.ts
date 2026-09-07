import type { Playback, PlaybackSession, SessionEvent } from "../diagnosticsSchema";
import { buildLog, headLines, logText, savedAt, titleCase, verdict } from "../diagnosticsLog";

const HEAD = {
  schemaVersion: 2 as const,
  app: { name: "Tomo TV", version: "9.9.9", build: "1" },
  os: { name: "iOS" as const, version: "26.5" },
  device: { family: "iPhone" as const, model: null, marketingName: null, cores: null, memoryBytes: null, decode: null },
};
const at = (event: string, data: Record<string, unknown> = {}, t = 1_700_000_000_000): SessionEvent => ({ t, event, itemId: "i", ...data });

function session(events: SessionEvent[], overrides: Partial<Playback> = {}): PlaybackSession {
  return { ...HEAD, playback: { itemId: "item-1", startedAt: 1_700_000_000_000, outcome: "playing", events, progress: [{ t: 1, position: 62.34 }], ...overrides } };
}

describe("verdict", () => {
  it("reads the outcome and the position together", () => {
    expect(verdict(session([], { outcome: "error" }))).toBe("Failed");
    expect(verdict(session([], { outcome: "ended" }))).toBe("Played to the end");
    expect(verdict(session([]))).toBe("Played, no errors");
    expect(verdict(session([], { progress: [] }))).toBe("Never started");
    expect(verdict(session([], { progress: [{ t: 1, position: 0 }] }))).toBe("Never started");
    expect(verdict(session([at("playing", { afterSeconds: 1.8 })], { progress: [{ t: 1, position: 0 }] }))).toBe("Played, no errors");
  });
});

describe("headLines", () => {
  const tv = (device: Partial<PlaybackSession["device"]>) => ({ ...HEAD, os: { name: "tvOS" as const, version: "26.0" }, device: { ...HEAD.device, family: "Apple TV" as const, ...device } });

  it("names the machine, its identifier and its OS, then what the hardware carries", () => {
    const head = tv({ model: "AppleTV6,2", marketingName: "Apple TV 4K", cores: 4, memoryBytes: 3 * 2 ** 30, decode: { hevc: true, hevcMain10: true, av1: false } });
    expect(headLines(head)).toEqual(["Tomo TV 9.9.9 (1)", "Apple TV 4K (AppleTV6,2), tvOS 26.0", "4 cores, 3 GB, HEVC 10-bit, no AV1"]);
  });

  it("falls back to the family and the raw identifier for a model this build does not know", () => {
    expect(headLines(tv({ model: "AppleTV15,1", cores: 8, memoryBytes: 8 * 2 ** 30 }))[1]).toBe("Apple TV (AppleTV15,1), tvOS 26.0");
  });

  it("drops the hardware line, the identifier and the build number when none were recorded", () => {
    expect(headLines({ ...HEAD, app: { ...HEAD.app, build: "" } })).toEqual(["Tomo TV 9.9.9", "iPhone, iOS 26.5"]);
    expect(headLines(tv({ decode: { hevc: true, hevcMain10: false, av1: true } }))[2]).toBe("HEVC, AV1");
    expect(headLines(tv({ decode: { hevc: false, hevcMain10: false, av1: false } }))[2]).toBe("no HEVC, no AV1");
  });
});

describe("titleCase", () => {
  it("turns an event name into a heading", () => {
    expect(titleCase("enginePlan")).toBe("Engine Plan");
    expect(titleCase("mode")).toBe("Mode");
    expect(titleCase("qualitySwitch")).toBe("Quality Switch");
  });
});

describe("buildLog", () => {
  it("opens with the summary: head, item, start, outcome, position", () => {
    const [summary] = buildLog(session([at("source", { name: "Tears of Steel" })]));
    expect(summary.event).toBeUndefined();
    expect(summary.lines[0]).toBe("Tomo TV 9.9.9 (1)");
    expect(summary.lines[1]).toBe("iPhone, iOS 26.5");
    expect(summary.lines[2]).toBe("Item: Tears of Steel");
    expect(summary.lines[3]).toMatch(/^Started: /);
    expect(summary.lines[4]).toBe("Outcome: Played, no errors");
    expect(summary.lines[5]).toBe("Reached: 62.3s");
  });

  it("falls back to the item id when no source was recorded, and skips Reached with no progress", () => {
    const [summary] = buildLog(session([], { progress: [] }));
    expect(summary.lines[2]).toBe("Item: item-1");
    expect(summary.lines).not.toContainEqual(expect.stringMatching(/^Reached/));
  });

  it("labels a retried error as a detour and a terminal one as the error", () => {
    const retried = buildLog(session([at("error", { message: "Cannot open", willRetry: true })]))[0].lines;
    expect(retried).toContain("Retried after: Cannot open");
    expect(retried).not.toContainEqual(expect.stringMatching(/^Error:/));
    const terminal = buildLog(session([at("error", { message: "gave up", willRetry: false })], { outcome: "error" }))[0].lines;
    expect(terminal).toContain("Error: gave up");
    expect(terminal).toContain("Outcome: Failed");
  });

  it("uses the last error and the last decline reason", () => {
    const lines = buildLog(session([at("error", { message: "first" }), at("error", { message: "second" }), at("decline", { reason: "a" }), at("decline", { reason: "b" })]))[0].lines;
    expect(lines).toContain("Error: second");
    expect(lines).toContain("Engine declined: b");
  });

  it("bands every event but the suite's start marker, with a pretty-printed payload", () => {
    const blocks = buildLog(session([at("start"), at("mode", { mode: "direct", burnIn: false }), at("ended")]));
    expect(blocks.map((block) => block.event?.name)).toEqual([undefined, "Mode", "Ended"]);
    expect(blocks[1].lines).toEqual(["{", '  "mode": "direct",', '  "burnIn": false', "}"]);
    expect(blocks[2].lines).toEqual([]);
  });

  it("drops the item id from every payload", () => {
    const blocks = buildLog(session([at("stream", { url: "http://x" })]));
    expect(blocks[1].lines.join("\n")).not.toContain("itemId");
  });
});

describe("the tier band", () => {
  it("carries the engine's verdict and the reason it gave", () => {
    const blocks = buildLog(session([at("tier", { state: "dropped", reason: "audio HTTP 500, after 2 failures" })]));
    const band = blocks.find((block) => block.event?.name === "Tier");
    expect(band).toBeDefined();
    expect(band!.lines.join("\n")).toContain('"state": "dropped"');
    expect(band!.lines.join("\n")).toContain('"reason": "audio HTTP 500, after 2 failures"');
  });

  it("carries a verdict that needs no reason", () => {
    const blocks = buildLog(session([at("tier", { state: "listed" })]));
    expect(blocks.find((block) => block.event?.name === "Tier")!.lines.join("\n")).toBe('{\n  "state": "listed"\n}');
  });
});

describe("logText", () => {
  it("flattens blocks with a blank line and a banded heading per event", () => {
    const text = logText([{ lines: ["a", "b"] }, { event: { name: "Mode", time: "1:00:00 PM" }, lines: ["{", "}"] }]);
    expect(text).toBe("a\nb\n\nMode   1:00:00 PM\n{\n}");
  });

  it("puts the story first when there is one, and nothing extra when there is none", () => {
    const blocks = [{ lines: ["a"] }];
    expect(logText(blocks, "It played.")).toBe("It played.\n\na");
    expect(logText(blocks, null)).toBe("a");
    expect(logText(blocks)).toBe("a");
  });

  it("matches what buildLog renders, so copy and screen cannot disagree", () => {
    const blocks = buildLog(session([at("mode", { mode: "direct" })]));
    const text = logText(blocks);
    for (const line of blocks.flatMap((block) => block.lines)) expect(text).toContain(line);
    expect(text).toContain("Mode   ");
  });
});

describe("savedAt", () => {
  it("is the newest event or sample, and the start when there are none", () => {
    expect(savedAt(session([at("mode", {}, 1_700_000_005_000)], { progress: [{ t: 1_700_000_009_000, position: 1 }] }))).toBe(1_700_000_009_000);
    expect(savedAt(session([at("mode", {}, 1_700_000_005_000)], { progress: [] }))).toBe(1_700_000_005_000);
    expect(savedAt(session([], { progress: [] }))).toBe(1_700_000_000_000);
  });
});
