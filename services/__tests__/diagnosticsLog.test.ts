import type { Playback, PlaybackSession, SessionEvent } from "../diagnosticsSchema";
import { displayed, documentLines, documentText, logText, savedAt, started, summarize, verdict } from "../diagnosticsLog";

const HEAD = {
  schemaVersion: 2 as const,
  app: { name: "Tomo TV", version: "9.9.9", build: "1" },
  os: { name: "iOS" as const, version: "26.5" },
  device: { family: "iPhone" as const, model: "iPhone18,1", marketingName: null, cores: 6, memoryBytes: 12_291_751_936, decode: { hevc: true, hevcMain10: true, av1: true } },
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
    expect(started(session([], { progress: [] }))).toBe(false);
  });
});

describe("summarize", () => {
  it("carries the item, the start, the outcome and the position", () => {
    const summary = summarize(session([at("source", { name: "Tears of Steel" })]));
    expect(summary).toMatchObject({ item: "Tears of Steel", outcome: "Played, no errors", reachedSeconds: 62.3, error: null, retriedAfter: null, engineDeclined: null });
    expect(summary.started).toBe(new Date(1_700_000_000_000).toLocaleString());
  });

  it("falls back to the item id when no source was recorded, and to null with no progress", () => {
    expect(summarize(session([], { progress: [] }))).toMatchObject({ item: "item-1", reachedSeconds: null });
  });

  it("keeps a retried error apart from the terminal one", () => {
    expect(summarize(session([at("error", { message: "Cannot open", willRetry: true })]))).toMatchObject({ error: null, retriedAfter: "Cannot open" });
    expect(summarize(session([at("error", { message: "gave up", willRetry: false })], { outcome: "error" }))).toMatchObject({ error: "gave up", retriedAfter: null, outcome: "Failed" });
  });

  it("uses the last error and the last decline reason", () => {
    const summary = summarize(session([at("error", { message: "first" }), at("error", { message: "second" }), at("decline", { reason: "a" }), at("decline", { reason: "b" })]));
    expect(summary).toMatchObject({ error: "second", engineDeclined: "b" });
  });
});

describe("documentText", () => {
  it("is the document, the version then the summary, pretty-printed, and parses back to it", () => {
    const recorded = session([at("mode", { mode: "direct", burnIn: false }), at("stream", { url: "http://x?ApiKey=[redacted]" })]);
    const text = documentText(recorded);
    expect(JSON.parse(text)).toEqual(displayed(recorded));
    expect(Object.keys(JSON.parse(text))).toEqual(["schemaVersion", "summary", "app", "os", "device", "playback"]);
    expect(text).toContain('    "model": "iPhone18,1",');
  });

  it("splits into one line per row, indented as the JSON is", () => {
    const lines = documentLines(session([at("mode", { mode: "direct" })]));
    expect(lines[0]).toBe("{");
    expect(lines[1]).toBe('  "schemaVersion": 2,');
    expect(lines[2]).toBe('  "summary": {');
    expect(lines).toContain('  "playback": {');
    expect(lines).toContain('        "mode": "direct"');
    expect(lines[lines.length - 1]).toBe("}");
  });
});

describe("logText", () => {
  it("carries the story as summary.description and stays one JSON document", () => {
    const recorded = session([at("mode", { mode: "direct" })]);
    const parsed = JSON.parse(logText(recorded, "It played."));
    expect(parsed.summary.description).toBe("It played.");
    expect(Object.keys(parsed.summary)).toEqual([...Object.keys(summarize(recorded)), "description"]);
    expect({ ...parsed, summary: summarize(recorded) }).toEqual(displayed(recorded));
    expect(logText(recorded, "It played.")).toContain('    "description": "It played."');
  });

  it("is the document alone when there is no story", () => {
    const recorded = session([at("mode", { mode: "direct" })]);
    expect(logText(recorded, null)).toBe(documentText(recorded));
    expect(logText(recorded)).toBe(documentText(recorded));
  });
});

describe("savedAt", () => {
  it("is the newest event or sample, and the start when there are none", () => {
    expect(savedAt(session([at("mode", {}, 1_700_000_005_000)], { progress: [{ t: 1_700_000_009_000, position: 1 }] }))).toBe(1_700_000_009_000);
    expect(savedAt(session([at("mode", {}, 1_700_000_005_000)], { progress: [] }))).toBe(1_700_000_005_000);
    expect(savedAt(session([], { progress: [] }))).toBe(1_700_000_000_000);
  });
});
