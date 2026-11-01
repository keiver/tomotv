jest.mock("@/services/i18n", () => ({ t: (key: string) => key }));
jest.mock("@/contexts/PlayerSessionContext", () => ({ usePlayerSession: jest.fn() }));
jest.mock("@/hooks/useSubtitleSearch", () => ({ useSubtitleSearch: jest.fn() }));
jest.mock("@/hooks/useSubtitleTiming", () => ({ useSubtitleTiming: jest.fn() }));
jest.mock("@/services/jellyfinApi", () => ({ fetchVideoDetails: jest.fn() }));
jest.mock("@/services/jellyfin/session", () => ({ getCachedConfig: () => ({ server: "http://a" }) }));
jest.mock("@/services/subtitleSearchPanel", () => ({
  subtitlePanelAvailable: () => false,
  presentSubtitlePanel: jest.fn(),
  updateSubtitlePanel: jest.fn(),
  dismissSubtitlePanel: jest.fn(),
  listenToSubtitlePanel: jest.fn(),
}));
jest.mock("@/services/subtitles/current", () => ({ currentTextSubtitles: () => [], isCurrentPick: jest.requireActual("@/services/subtitles/current").isCurrentPick, replacementFor: jest.fn() }));
jest.mock("@/utils/logger", () => ({ logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() } }));

import { panelCurrentFor, panelStateFor, subtitleTransportButton } from "@/hooks/useTvSubtitlePanel";
import { makeJob } from "@/services/subtitles/jobs";
import type { SubtitleHit } from "@/services/subtitles/types";
import type { JellyfinVideoItem } from "@/types/jellyfin";

function hit(id: string, over: Partial<SubtitleHit> = {}): SubtitleHit {
  return {
    id,
    source: "podnapisi",
    name: `Rel ${id}`,
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

const kept = { index: 100000, name: "Kept", language: "en", device: { ordinal: 0, source: "podnapisi" as const, sourceId: "a" } };

describe("the transport bar subtitle button", () => {
  const base = { isLiveChannel: false, available: true, active: null, offsetMs: 0 };

  it("finds subtitles with the search glyph when none of ours is on", () => {
    expect(subtitleTransportButton(base)).toEqual({ id: "subtitles", title: "player.findSubtitles", sfSymbol: "text.magnifyingglass" });
  });

  it("stays away on a live channel and without the panel", () => {
    expect(subtitleTransportButton({ ...base, isLiveChannel: true })).toBeNull();
    expect(subtitleTransportButton({ ...base, available: false })).toBeNull();
  });

  it("keeps the search glyph and carries the timing of the subtitle of ours that is on", () => {
    const active = { index: 2, name: "English", language: "eng" };
    expect(subtitleTransportButton({ ...base, active })).toEqual({ id: "subtitles", title: "subtitles.timingTitle", sfSymbol: "text.magnifyingglass" });
    expect(subtitleTransportButton({ ...base, active, offsetMs: 1500 })?.title).toBe("subtitles.late");
  });
});

describe("the panel's state", () => {
  const item = { Id: "v1", Name: "Clip", Type: "Video", Path: "/v/Clip.mov", MediaStreams: [] } as unknown as JellyfinVideoItem;

  it("leads with the subtitle that is on and leaves its own copy out of the results", () => {
    const job = { ...makeJob(item, "en"), status: "found" as const, results: [hit("a"), hit("b")] };
    const state = panelStateFor(job, "en", [{ code: "en", native: "English" }], false, { subtitle: kept, offsetMs: -500 });
    expect(state.title).toBe("subtitles.timingTitle");
    expect(state.current).toEqual({
      name: "Kept",
      meta: "subtitles.source.podnapisi · English",
      offsetLabel: "subtitles.early",
      earlierLabel: "subtitles.earlier",
      laterLabel: "subtitles.later",
      resetLabel: "subtitles.resetTiming",
    });
    expect(state.results.map((result) => result.id)).toEqual(["podnapisi:b"]);
  });

  it("searches plainly when nothing is on, with every language behind the likely ones", () => {
    const state = panelStateFor(makeJob(item, "en"), "en", [{ code: "en", native: "English" }], true);
    expect(state.title).toBe("subtitles.title");
    expect(state.current).toBeNull();
    expect(state.languages[0]).toEqual({ code: "en", name: "English" });
    expect(state.languages.length).toBeGreaterThan(50);
    expect(state.busy).toBe(true);
  });

  it("names a file track by its language alone", () => {
    expect(panelCurrentFor({ subtitle: { index: 2, name: "English (SRT)", language: "eng" }, offsetMs: 0 }).meta).toBe("English");
  });
});
