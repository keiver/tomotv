jest.mock("@/services/i18n", () => ({ t: (key: string) => key }));
jest.mock("@/contexts/PlayerSessionContext", () => ({ usePlayerSession: jest.fn() }));
jest.mock("@/hooks/useSubtitleSearch", () => ({ useSubtitleSearch: jest.fn() }));
jest.mock("@/hooks/useSubtitleTiming", () => ({ useSubtitleTiming: jest.fn() }));
jest.mock("@/services/jellyfinApi", () => ({
  fetchItemDetails: jest.fn(),
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
jest.mock("@/services/subtitles/sources/opensubtitles", () => ({ openSubtitlesDownloadsLeft: jest.fn(() => null) }));
jest.mock("@/utils/logger", () => ({ logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() } }));

import { panelStateFor, panelTrackFor, subtitleTransportButton, type PanelTrackInput } from "@/hooks/useSubtitlePanel";
import { makeJob } from "@/services/subtitles/jobs";
import { openSubtitlesDownloadsLeft } from "@/services/subtitles/sources/opensubtitles";
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
const keptTrack: PanelTrackInput = { subtitle: kept, offsetMs: -500, canSync: true };
const english = [{ code: "en", native: "English" }];

describe("the transport bar subtitle button", () => {
  const base = { isLiveChannel: false, available: true, active: null, offsetMs: 0 };

  it("finds subtitles with the magnifying glass over text when none of ours is on", () => {
    expect(subtitleTransportButton(base)).toEqual({ id: "subtitles", title: "player.findSubtitles", sfSymbol: "text.magnifyingglass" });
  });

  it("stays away on a live channel and without the panel", () => {
    expect(subtitleTransportButton({ ...base, isLiveChannel: true })).toBeNull();
    expect(subtitleTransportButton({ ...base, available: false })).toBeNull();
  });

  it("keeps the same glyph and carries the timing of the subtitle of ours that is on", () => {
    const active = { index: 2, name: "English", language: "eng" };
    expect(subtitleTransportButton({ ...base, active })).toEqual({ id: "subtitles", title: "subtitles.timingTitle", sfSymbol: "text.magnifyingglass" });
    expect(subtitleTransportButton({ ...base, active, offsetMs: 1500 })?.title).toBe("subtitles.late");
  });
});

describe("the panel's state", () => {
  const item = { Id: "v1", Name: "Clip", Type: "Video", Path: "/v/Clip.mov", MediaStreams: [] } as unknown as JellyfinVideoItem;
  const search = { language: "en", choices: english };
  const idle = makeJob(item, "en");

  it("puts the timing controls under the result kept as a device copy, and on no other row", () => {
    const job = { ...makeJob(item, "en"), status: "found" as const, results: [hit("a"), hit("b")] };
    const state = panelStateFor(job, search, [keptTrack], "subtitles.title", "#4F99FF");
    expect(state.job.results.map((result) => [result.id, result.applied])).toEqual([
      ["podnapisi:a", true],
      ["podnapisi:b", false],
    ]);
    expect(state.job.results[0].timing).toEqual({
      id: 100000,
      offsetLabel: "subtitles.early",
      earlierLabel: "subtitles.earlier",
      laterLabel: "subtitles.later",
      earlierTitle: "subtitles.earlierStep",
      laterTitle: "subtitles.laterStep",
      resetLabel: "subtitles.resetTiming",
      syncLabel: "subtitles.sync",
      canSync: true,
      syncing: false,
      note: "",
    });
    expect(state.job.results[1].timing).toBeNull();
  });

  it("sends each result's downloads, rating and byline on their own, and names a source other than OpenSubtitles in the byline", () => {
    const job = {
      ...makeJob(item, "en"),
      status: "found" as const,
      results: [hit("a", { source: "opensubtitles", downloads: 42786, rating: 9, author: "devnul13" }), hit("b")],
    };
    const [rated, bare] = panelStateFor(job, search, [], "subtitles.title", "#4F99FF").job.results;
    expect([rated.downloads, rated.rating, rated.byline]).toEqual([42786, 9, "devnul13"]);
    expect(rated.meta).toBe("subtitles.downloads · 9.0 · devnul13");
    expect([bare.downloads, bare.rating, bare.byline]).toEqual([null, null, "subtitles.source.podnapisi"]);
  });

  it("blurs the screen behind unless told the video plays under the panel", () => {
    expect(panelStateFor(idle, search, [], "subtitles.title", "#4F99FF").blurBehind).toBe(true);
    expect(panelStateFor(idle, search, [], "subtitles.title", "#4F99FF", false).blurBehind).toBe(false);
  });

  it("shows no timing controls while the video is not playing", () => {
    const job = { ...makeJob(item, "en"), status: "found" as const, results: [hit("a")] };
    const state = panelStateFor(job, search, [{ ...keptTrack, canSync: false }], "subtitles.title", "#4F99FF");
    expect(state.job.results[0]).toMatchObject({ applied: true, timing: null });
  });

  it("puts the timing controls under a pick saved to the server once that stream is the one playing", () => {
    const saved = { index: 7, name: "English", language: "en" };
    const job = { ...makeJob(item, "en"), status: "applied" as const, results: [hit("a"), hit("b")], picked: hit("b"), applied: { where: "server" as const, language: "en", streamIndex: 7 } };
    const playing = panelStateFor(job, search, [{ subtitle: saved, offsetMs: 0, canSync: true }], "subtitles.title", "#4F99FF");
    expect(playing.job.results.map((result) => result.timing?.id ?? null)).toEqual([null, 7]);
    const stillTheOld = panelStateFor(job, search, [{ subtitle: { ...saved, index: 3 }, offsetMs: 0, canSync: true }], "subtitles.title", "#4F99FF");
    expect(stillTheOld.job.results.map((result) => result.timing ?? null)).toEqual([null, null]);
  });

  it("keeps the downloads left out of the credit, for the download alert alone", () => {
    jest.mocked(openSubtitlesDownloadsLeft).mockReturnValueOnce(4);
    expect(panelStateFor(idle, search, [], "subtitles.title", "#4F99FF").credit).toBe("subtitles.credit");
  });

  it("gives the download alert its words, with the downloads left only once known", () => {
    expect(panelStateFor(idle, search, [], "subtitles.title", "#4F99FF").confirm).toEqual({
      title: "subtitles.confirmDownload",
      remaining: "",
      download: "subtitles.download",
      cancel: "common.cancel",
    });
    jest.mocked(openSubtitlesDownloadsLeft).mockReturnValueOnce(4);
    expect(panelStateFor(idle, search, [], "subtitles.title", "#4F99FF").confirm.remaining).toBe("subtitles.downloadsLeft");
  });

  it("sends the video's search with every language behind the likely ones", () => {
    const state = panelStateFor(idle, search, [], "subtitles.title", "#4F99FF");
    expect(state.accent).toBe("#4F99FF");
    expect(state.job.id).toBe("v1");
    expect(state.job.busy).toBe(true);
    expect(state.languages[0]).toEqual({ code: "en", name: "English" });
    expect(state.languages.length).toBeGreaterThan(50);
  });

  it("asks the viewer to sign in when the free downloads run out, and says when a signed-in account's run out", () => {
    const job = { ...makeJob(item, "en"), status: "found" as const, results: [hit("a")], picked: hit("a") };
    expect(panelStateFor({ ...job, error: "limit" }, search, [], "subtitles.title", "#4F99FF").job.note).toBe("subtitles.downloadLimit");
    expect(panelStateFor({ ...job, error: "accountLimit" }, search, [], "subtitles.title", "#4F99FF").job.note).toBe("subtitles.accountDownloadLimit");
  });

  it("spins the sync button while a match runs and notes how it went", () => {
    const running = panelTrackFor({ ...keptTrack, offsetMs: 0, sync: { status: "syncing", attempt: 1 } });
    expect(running.syncing).toBe(true);
    expect(running.note).toBe("subtitles.syncing");
    expect(panelTrackFor({ ...keptTrack, offsetMs: -1700, sync: { status: "synced" } }).note).toBe("subtitles.synced");
    expect(panelTrackFor({ ...keptTrack, offsetMs: 0, sync: { status: "failed" } }).note).toBe("subtitles.syncFailed");
  });
});
