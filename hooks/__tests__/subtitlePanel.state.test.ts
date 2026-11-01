jest.mock("@/services/i18n", () => ({ t: (key: string) => key }));
jest.mock("@/contexts/PlayerSessionContext", () => ({ usePlayerSession: jest.fn() }));
jest.mock("@/hooks/useSubtitleSearch", () => ({ useSubtitleSearch: jest.fn() }));
jest.mock("@/hooks/useSubtitleTiming", () => ({ useSubtitleTiming: jest.fn() }));
jest.mock("@/services/jellyfinApi", () => ({
  fetchItemDetails: jest.fn(),
  fetchRecursiveDownloadables: jest.fn(),
  isAudioItem: jest.fn(),
  isBook: jest.fn(),
  isFolder: jest.fn(),
  isPhoto: jest.fn(),
}));
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

import { panelStateFor, panelTrackFor, subtitleTransportButton, type PanelTrackInput } from "@/hooks/useSubtitlePanel";
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
const keptTrack: PanelTrackInput = { subtitle: kept, offsetMs: -500, canSync: true, canReplace: true, replacing: false };
const english = [{ code: "en", native: "English" }];

describe("the transport bar subtitle button", () => {
  const base = { isLiveChannel: false, available: true, active: null, offsetMs: 0 };

  it("finds subtitles with the download glyph when none of ours is on", () => {
    expect(subtitleTransportButton(base)).toEqual({ id: "subtitles", title: "player.findSubtitles", sfSymbol: "square.and.arrow.down" });
  });

  it("stays away on a live channel and without the panel", () => {
    expect(subtitleTransportButton({ ...base, isLiveChannel: true })).toBeNull();
    expect(subtitleTransportButton({ ...base, available: false })).toBeNull();
  });

  it("keeps the download glyph and carries the timing of the subtitle of ours that is on", () => {
    const active = { index: 2, name: "English", language: "eng" };
    expect(subtitleTransportButton({ ...base, active })).toEqual({ id: "subtitles", title: "subtitles.timingTitle", sfSymbol: "square.and.arrow.down" });
    expect(subtitleTransportButton({ ...base, active, offsetMs: 1500 })?.title).toBe("subtitles.late");
  });
});

describe("the panel's state", () => {
  const item = { Id: "v1", Name: "Clip", Type: "Video", Path: "/v/Clip.mov", MediaStreams: [] } as unknown as JellyfinVideoItem;
  const second = { Id: "v2", Name: "Clip Two", Type: "Video", Path: "/v/Clip Two.mov", MediaStreams: [] } as unknown as JellyfinVideoItem;
  const search = (jobs: ReturnType<typeof makeJob>[], over: Partial<Parameters<typeof panelStateFor>[0]> = {}) => ({ jobs, language: "en", choices: english, skipped: 0, matches: [], ...over });

  it("leads with the video's tracks and shows its own copy in place as applied", () => {
    const job = { ...makeJob(item, "en"), status: "found" as const, results: [hit("a"), hit("b")] };
    const state = panelStateFor(search([job]), [keptTrack], 1, "subtitles.title");
    expect(state.tracks).toEqual([
      {
        id: 100000,
        name: "Kept",
        meta: "subtitles.source.podnapisi · English",
        monogram: "P",
        offsetLabel: "subtitles.early",
        earlierLabel: "subtitles.earlier",
        laterLabel: "subtitles.later",
        resetLabel: "subtitles.resetTiming",
        syncLabel: "subtitles.sync",
        replaceLabel: "subtitles.replace",
        canSync: true,
        canReplace: true,
        replacing: false,
        syncing: false,
        note: "",
      },
    ]);
    expect(state.jobs[0].results.map((result) => [result.id, result.applied])).toEqual([
      ["podnapisi:a", true],
      ["podnapisi:b", false],
    ]);
  });

  it("gives a lone job no heading and every language behind the likely ones", () => {
    const state = panelStateFor(search([makeJob(item, "en")]), [], 1, "subtitles.title");
    expect(state.jobs[0].heading).toBe("");
    expect(state.jobs[0].busy).toBe(true);
    expect(state.languages[0]).toEqual({ code: "en", name: "English" });
    expect(state.languages.length).toBeGreaterThan(50);
  });

  it("names every job of a folder's search and counts the matches on the take-all button", () => {
    const one = { ...makeJob(item, "en"), status: "found" as const, results: [hit("a", { hashMatch: true })] };
    const two = makeJob(second, "en");
    const state = panelStateFor(search([one, two], { skipped: 2, matches: [{ index: 0, hit: one.results[0] }] }), [], 4, "subtitles.title");
    expect(state.jobs.map((job) => job.heading)).toEqual(["Clip", "Clip Two"]);
    expect(state.takeAll).toEqual({ label: "subtitles.takeMatches", busy: false });
    expect(state.skippedLine).toBe("subtitles.filesSkipped");
  });

  it("says every file is subtitled, or that a folder holds no videos, only when no job exists", () => {
    expect(panelStateFor(search([]), [], 3, "subtitles.title").emptyLine).toBe("subtitles.allSubtitled");
    expect(panelStateFor(search([]), [], 0, "subtitles.title").emptyLine).toBe("subtitles.noVideos");
    expect(panelStateFor(search([makeJob(item, "en")]), [], 1, "subtitles.title").emptyLine).toBe("");
  });

  it("names a file track by its language alone", () => {
    expect(panelTrackFor({ subtitle: { index: 2, name: "English (SRT)", language: "eng" }, offsetMs: 0, canSync: false, canReplace: true, replacing: false }).meta).toBe("English");
  });

  it("spins the sync button while a match runs and notes how it went", () => {
    const running = panelTrackFor({ ...keptTrack, offsetMs: 0, sync: { status: "syncing", attempt: 1 } });
    expect(running.syncing).toBe(true);
    expect(running.note).toBe("subtitles.syncing");
    expect(panelTrackFor({ ...keptTrack, offsetMs: -1700, sync: { status: "synced" } }).note).toBe("subtitles.synced");
    expect(panelTrackFor({ ...keptTrack, offsetMs: 0, sync: { status: "failed" } }).note).toBe("subtitles.syncFailed");
  });

  it("marks the armed track so the panel shows where the next pick lands", () => {
    expect(panelTrackFor({ ...keptTrack, replacing: true }).replacing).toBe(true);
  });
});
