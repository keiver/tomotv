jest.mock("expo-file-system", () => require("./fakeFileSystem"));
jest.mock("@/utils/logger", () => ({ logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() } }));

import { fakeFs } from "./fakeFileSystem";
import { currentTextSubtitles, isCurrentPick, replacementFor } from "@/services/subtitles/current";
import { saveDeviceSubtitle } from "@/services/subtitles/store";
import type { SubtitleHit } from "@/services/subtitles/types";
import type { JellyfinVideoItem } from "@/types/jellyfin";

const item = {
  Id: "item1",
  MediaStreams: [
    { Type: "Video", Codec: "h264", Index: 0 },
    { Type: "Subtitle", Codec: "subrip", Index: 2, Language: "eng", DisplayTitle: "English (SRT)" },
    { Type: "Subtitle", Codec: "pgssub", Index: 3, Language: "eng" },
    { Type: "Subtitle", Codec: "ass", Index: 4, Language: "spa", Title: "Signs" },
  ],
} as unknown as JellyfinVideoItem;

function hit(over: Partial<SubtitleHit> = {}): SubtitleHit {
  return {
    id: "p1",
    source: "podnapisi",
    name: "Rel",
    language: "en",
    format: "",
    hashMatch: false,
    forced: false,
    hearingImpaired: false,
    machineTranslated: false,
    rating: null,
    downloads: null,
    author: "",
    ...over,
  };
}

describe("currentTextSubtitles", () => {
  beforeEach(() => fakeFs.clear());

  it("lists the file's text tracks and the device copies, never an image track", () => {
    saveDeviceSubtitle({
      server: "http://a",
      itemId: "item1",
      language: "en",
      name: "Kept",
      source: "podnapisi",
      sourceId: "p1",
      forced: false,
      hearingImpaired: false,
      vtt: "WEBVTT\n\n00:00:01.000 --> 00:00:02.000\nHi\n",
    });
    expect(currentTextSubtitles(item, "http://a")).toEqual([
      { index: 2, name: "English (SRT)", language: "eng" },
      { index: 4, name: "Signs", language: "spa" },
      { index: 100000, name: "Kept", language: "en", device: { ordinal: 0, source: "podnapisi", sourceId: "p1" } },
    ]);
  });

  it("knows the copy that is on and what a pick in its language replaces", () => {
    const kept = { index: 100000, name: "Kept", language: "en", device: { ordinal: 0, source: "podnapisi" as const, sourceId: "p1" } };
    expect(isCurrentPick(hit(), kept)).toBe(true);
    expect(isCurrentPick(hit({ id: "p2" }), kept)).toBe(false);
    expect(isCurrentPick(hit(), { index: 2, name: "English", language: "eng" })).toBe(false);
    expect(replacementFor(hit({ id: "p2", language: "en" }), kept)).toEqual({ ordinal: 0 });
    expect(replacementFor(hit({ id: "p2", language: "es" }), kept)).toBeUndefined();
    expect(replacementFor(hit(), { index: 2, name: "English", language: "eng" })).toBeUndefined();
  });
});
