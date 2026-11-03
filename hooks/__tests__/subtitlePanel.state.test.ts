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
jest.mock("@/services/subtitles/sources/opensubtitles", () => ({ openSubtitlesDownloadsLeft: jest.fn(() => null) }));
jest.mock("@/utils/logger", () => ({ logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() } }));

import { panelStateFor, panelTrackFor, subtitleTransportButton, type PanelTrackInput } from "@/hooks/useSubtitlePanel";
import { makeJob } from "@/services/subtitles/jobs";
import { queryPrefix } from "@/services/subtitles/jobText";
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
  const second = { Id: "v2", Name: "Clip Two", Type: "Video", Path: "/v/Clip Two.mov", MediaStreams: [] } as unknown as JellyfinVideoItem;
  const search = (jobs: ReturnType<typeof makeJob>[], over: Partial<Parameters<typeof panelStateFor>[0]> = {}) => ({ jobs, language: "en", choices: english, skipped: 0, matches: [], ...over });

  it("puts the timing controls under the result kept as a device copy, and on no other row", () => {
    const job = { ...makeJob(item, "en"), status: "found" as const, results: [hit("a"), hit("b")] };
    const state = panelStateFor(search([job]), [keptTrack], 1, "subtitles.title", "#4F99FF");
    expect(state.jobs[0].results.map((result) => [result.id, result.applied])).toEqual([
      ["podnapisi:a", true],
      ["podnapisi:b", false],
    ]);
    expect(state.jobs[0].results[0].timing).toEqual({
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
    expect(state.jobs[0].results[1].timing).toBeNull();
  });

  it("sends each result's downloads, rating and byline on their own, and names a source other than OpenSubtitles in the byline", () => {
    const job = {
      ...makeJob(item, "en"),
      status: "found" as const,
      results: [hit("a", { source: "opensubtitles", downloads: 42786, rating: 9, author: "devnul13" }), hit("b")],
    };
    const [rated, bare] = panelStateFor(search([job]), [], 1, "subtitles.title", "#4F99FF").jobs[0].results;
    expect([rated.downloads, rated.rating, rated.byline]).toEqual([42786, 9, "devnul13"]);
    expect(rated.meta).toBe("subtitles.downloads · 9.0 · devnul13");
    expect([bare.downloads, bare.rating, bare.byline]).toEqual([null, null, "subtitles.source.podnapisi"]);
  });

  it("sends the start of each result's name that only repeats the query", () => {
    const job = { ...makeJob(item, "en"), status: "found" as const, results: [hit("a", { name: "Clip.2020.1080p.WEB-CAKES" }), hit("b", { name: "Other Thing" })] };
    const [match, other] = panelStateFor(search([job]), [], 1, "subtitles.title", "#4F99FF").jobs[0].results;
    expect(match.namePrefix).toBe("Clip.");
    expect(other.namePrefix).toBe("");
  });

  it("shows no timing controls while the video is not playing", () => {
    const job = { ...makeJob(item, "en"), status: "found" as const, results: [hit("a")] };
    const state = panelStateFor(search([job]), [{ ...keptTrack, canSync: false }], 1, "subtitles.title", "#4F99FF");
    expect(state.jobs[0].results[0]).toMatchObject({ applied: true, timing: null });
  });

  it("puts the timing controls under a pick saved to the server once that stream is the one playing", () => {
    const saved = { index: 7, name: "English", language: "en" };
    const job = { ...makeJob(item, "en"), status: "applied" as const, results: [hit("a"), hit("b")], picked: hit("b"), applied: { where: "server" as const, language: "en", streamIndex: 7 } };
    const playing = panelStateFor(search([job]), [{ subtitle: saved, offsetMs: 0, canSync: true }], 1, "subtitles.title", "#4F99FF");
    expect(playing.jobs[0].results.map((result) => result.timing?.id ?? null)).toEqual([null, 7]);
    const stillTheOld = panelStateFor(search([job]), [{ subtitle: { ...saved, index: 3 }, offsetMs: 0, canSync: true }], 1, "subtitles.title", "#4F99FF");
    expect(stillTheOld.jobs[0].results.map((result) => result.timing ?? null)).toEqual([null, null]);
  });

  it("keeps the downloads left out of the credit, for the download alert alone", () => {
    jest.mocked(openSubtitlesDownloadsLeft).mockReturnValueOnce(4);
    expect(panelStateFor(search([]), [], 1, "subtitles.title", "#4F99FF").credit).toBe("subtitles.credit");
  });

  it("gives the download alert its words, with the downloads left only once known", () => {
    expect(panelStateFor(search([]), [], 1, "subtitles.title", "#4F99FF").confirm).toEqual({
      title: "subtitles.confirmDownload",
      remaining: "",
      download: "subtitles.download",
      cancel: "common.cancel",
    });
    jest.mocked(openSubtitlesDownloadsLeft).mockReturnValueOnce(4);
    expect(panelStateFor(search([]), [], 1, "subtitles.title", "#4F99FF").confirm.remaining).toBe("subtitles.downloadsLeft");
  });

  it("gives a lone job no heading and every language behind the likely ones", () => {
    const state = panelStateFor(search([makeJob(item, "en")]), [], 1, "subtitles.title", "#4F99FF");
    expect(state.accent).toBe("#4F99FF");
    expect(state.jobs[0].heading).toBe("");
    expect(state.jobs[0].busy).toBe(true);
    expect(state.languages[0]).toEqual({ code: "en", name: "English" });
    expect(state.languages.length).toBeGreaterThan(50);
  });

  it("names every job of a folder's search and counts the matches on the take-all button", () => {
    const one = { ...makeJob(item, "en"), status: "found" as const, results: [hit("a", { hashMatch: true })] };
    const two = makeJob(second, "en");
    const state = panelStateFor(search([one, two], { skipped: 2, matches: [{ index: 0, hit: one.results[0] }] }), [], 4, "subtitles.title", "#4F99FF");
    expect(state.jobs.map((job) => job.heading)).toEqual(["Clip", "Clip Two"]);
    expect(state.takeAll).toEqual({ label: "subtitles.takeMatches", busy: false });
    expect(state.skippedLine).toBe("subtitles.filesSkipped");
  });

  it("says every file is subtitled, or that a folder holds no videos, only when no job exists", () => {
    expect(panelStateFor(search([]), [], 3, "subtitles.title", "#4F99FF").emptyLine).toBe("subtitles.allSubtitled");
    expect(panelStateFor(search([]), [], 0, "subtitles.title", "#4F99FF").emptyLine).toBe("subtitles.noVideos");
    expect(panelStateFor(search([makeJob(item, "en")]), [], 1, "subtitles.title", "#4F99FF").emptyLine).toBe("");
  });

  it("asks the viewer to sign in when the free downloads run out, and says when a signed-in account's run out", () => {
    const job = { ...makeJob(item, "en"), status: "found" as const, results: [hit("a")], picked: hit("a") };
    expect(panelStateFor(search([{ ...job, error: "limit" }]), [], 1, "subtitles.title", "#4F99FF").jobs[0].note).toBe("subtitles.downloadLimit");
    expect(panelStateFor(search([{ ...job, error: "accountLimit" }]), [], 1, "subtitles.title", "#4F99FF").jobs[0].note).toBe("subtitles.accountDownloadLimit");
  });

  it("finds the query's words at the start of a release name, ignoring case, up to the first word the query lacks", () => {
    const query = "The Lord of the Rings: The Rings of Power S01E01";
    expect(queryPrefix("The.Lord.of.the.Rings.The.Rings.of.Power.S01E01.A.Shadow.of.the.Past.1080p-CMRG", query)).toBe("The.Lord.of.the.Rings.The.Rings.of.Power.S01E01.");
    expect(queryPrefix("the lord of the rings - s01e01 - CAKES", query)).toBe("the lord of the rings - s01e01 - ");
  });

  it("finds no start when the name opens with a word the query lacks, or is nothing but the query", () => {
    expect(queryPrefix("101 - The One Where Monica Gets a Roommate", "Friends S01E01")).toBe("");
    expect(queryPrefix("[YTS] Friends S01E01", "Friends S01E01")).toBe("");
    expect(queryPrefix("Friends.S01E01", "Friends S01E01")).toBe("");
    expect(queryPrefix("Friends.S01E01.srt", "Friends S01E01")).toBe("Friends.S01E01.");
  });

  it("spins the sync button while a match runs and notes how it went", () => {
    const running = panelTrackFor({ ...keptTrack, offsetMs: 0, sync: { status: "syncing", attempt: 1 } });
    expect(running.syncing).toBe(true);
    expect(running.note).toBe("subtitles.syncing");
    expect(panelTrackFor({ ...keptTrack, offsetMs: -1700, sync: { status: "synced" } }).note).toBe("subtitles.synced");
    expect(panelTrackFor({ ...keptTrack, offsetMs: 0, sync: { status: "failed" } }).note).toBe("subtitles.syncFailed");
  });
});
