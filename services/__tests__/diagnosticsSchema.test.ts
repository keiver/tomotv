/** The diagnostics document: what parses, what is lifted from version 1, and what is refused. */
import { parseSession, SCHEMA_VERSION, type PlaybackSession } from "@/services/diagnosticsSchema";

const document: PlaybackSession = {
  schemaVersion: 2,
  app: { name: "Tomo TV", version: "2.2.5", build: "1" },
  os: { name: "tvOS", version: "26.0" },
  device: {
    family: "Apple TV",
    model: "AppleTV6,2",
    marketingName: "Apple TV 4K",
    cores: 4,
    memoryBytes: 3221225472,
    decode: { hevc: true, hevcMain10: true, av1: false, h264MaxHeight: null, hevcMaxHeight: null },
  },
  playback: { itemId: "i", startedAt: 1000, outcome: "playing", events: [{ t: 1000, event: "mode", mode: "direct" }], progress: [] },
};

describe("parseSession", () => {
  it("returns the current shape as it is, hardware nulls included", () => {
    expect(SCHEMA_VERSION).toBe(2);
    expect(parseSession(document, "iPhone")).toBe(document);
    const bare = { ...document, device: { family: "Mac", model: null, marketingName: null, cores: null, memoryBytes: null, decode: null } };
    expect(parseSession(bare, "iPhone")).toBe(bare);
  });

  it("lifts version 1, reading the build and the OS out of its two strings", () => {
    const v1 = { itemId: "i", app: "Tomo TV 2.2.4 (25)", os: "iOS 26.5", startedAt: 1, outcome: "error", events: [], progress: [{ t: 2, position: 3 }] };
    expect(parseSession(v1, "iPad")).toEqual({
      schemaVersion: 2,
      app: { name: "Tomo TV", version: "2.2.4", build: "25" },
      os: { name: "iOS", version: "26.5" },
      device: { family: "iPad", model: null, marketingName: null, cores: null, memoryBytes: null, decode: null },
      playback: { itemId: "i", startedAt: 1, outcome: "error", events: [], progress: [{ t: 2, position: 3 }] },
    });
    expect(parseSession({ ...v1, app: "Tomo TV 1.0.0" }, "iPad")?.app).toEqual({ name: "Tomo TV", version: "1.0.0", build: "" });
  });

  it("refuses what no build wrote: a later version, a missing head, a bad family, a malformed playback", () => {
    expect(parseSession(null, "iPhone")).toBeNull();
    expect(parseSession("text", "iPhone")).toBeNull();
    expect(parseSession({ ...document, schemaVersion: 3 }, "iPhone")).toBeNull();
    expect(parseSession({ ...document, os: { name: "watchOS", version: "1" } }, "iPhone")).toBeNull();
    expect(parseSession({ ...document, device: { ...document.device, family: "Toaster" } }, "iPhone")).toBeNull();
    expect(parseSession({ ...document, device: { ...document.device, decode: { hevc: "yes" } } }, "iPhone")).toBeNull();
    expect(parseSession({ ...document, playback: { ...document.playback, outcome: "maybe" } }, "iPhone")).toBeNull();
    expect(parseSession({ itemId: "i", os: "iOS 1", startedAt: 1, outcome: "playing", events: [], progress: [] }, "iPhone")).toBeNull();
  });
});
