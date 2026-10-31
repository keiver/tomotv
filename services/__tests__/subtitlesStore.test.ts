jest.mock("expo-file-system", () => require("./fakeFileSystem"));
jest.mock("@/utils/logger", () => ({ logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() } }));

import { fakeFs } from "./fakeFileSystem";
import { DEVICE_SUBTITLE_INDEX_BASE, deviceSubtitleIndex, deviceSubtitles, saveDeviceSubtitle } from "@/services/subtitles/store";

const save = (over: Partial<Parameters<typeof saveDeviceSubtitle>[0]> = {}) =>
  saveDeviceSubtitle(
    {
      server: "http://a:8096",
      itemId: "item1",
      language: "en",
      name: "Rel",
      source: "podnapisi",
      sourceId: "p1",
      forced: false,
      hearingImpaired: false,
      vtt: "WEBVTT\n\n00:00:01.000 --> 00:00:02.000\nHi\n",
      ...over,
    },
    1000,
  );

describe("device subtitle store", () => {
  beforeEach(() => fakeFs.clear());

  it("keeps a subtitle under Documents and lists it back with its file", () => {
    const saved = save();
    expect(saved).toMatchObject({ ordinal: 0, language: "en", name: "Rel", savedAt: 1000 });
    expect(saved?.uri.startsWith("file:///doc/subtitles/")).toBe(true);
    expect(deviceSubtitles("http://a:8096", "item1")).toEqual([saved]);
    expect(fakeFs.get(saved?.uri as string)?.content).toContain("WEBVTT");
  });

  it("keeps items and servers apart, since item ids repeat across servers", () => {
    save();
    save({ server: "http://b:8096", sourceId: "p2" });
    expect(deviceSubtitles("http://a:8096", "item1")).toHaveLength(1);
    expect(deviceSubtitles("http://b:8096", "item1")).toHaveLength(1);
    expect(deviceSubtitles("http://a:8096", "other")).toEqual([]);
  });

  it("replaces the same source's subtitle and appends a different one", () => {
    save();
    save({ vtt: "WEBVTT\n\nnew" });
    save({ sourceId: "p2", language: "fr" });
    const kept = deviceSubtitles("http://a:8096", "item1");
    expect(kept.map((entry) => [entry.ordinal, entry.sourceId])).toEqual([
      [0, "p1"],
      [1, "p2"],
    ]);
    expect(fakeFs.get(kept[0].uri)?.content).toBe("WEBVTT\n\nnew");
  });

  it("leaves out an entry whose file is gone", () => {
    const saved = save();
    fakeFs.delete(saved?.uri as string);
    expect(deviceSubtitles("http://a:8096", "item1")).toEqual([]);
  });

  it("numbers device subtitles far above any stream in a file", () => {
    expect(deviceSubtitleIndex(0)).toBe(DEVICE_SUBTITLE_INDEX_BASE);
    expect(deviceSubtitleIndex(3)).toBe(DEVICE_SUBTITLE_INDEX_BASE + 3);
    expect(DEVICE_SUBTITLE_INDEX_BASE).toBeGreaterThan(10000);
  });
});
