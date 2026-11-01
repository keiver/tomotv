jest.mock("expo-file-system", () => require("./fakeFileSystem"));
jest.mock("@/utils/logger", () => ({ logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() } }));
jest.mock("@/constants/app", () => ({ APP_VERSION: "1.0.0" }));
jest.mock("@/services/jellyfin/http", () => ({ fetchWithTimeout: jest.fn() }));
jest.mock("@/services/jellyfin/session", () => ({ getConfig: jest.fn(async () => ({ server: "http://server:8096", apiKey: "k", userId: "u", deviceId: "d" })) }));
const mockPrefs = { findSubtitles: true, saveSubtitles: true };
jest.mock("@/services/uiPreferences", () => ({ getUiPreferences: () => mockPrefs }));
jest.mock("@/services/subtitles/keys", () => ({ readOwnKeys: jest.fn(async () => ({ opensubtitles: null, subdl: null, subsource: null })) }));
jest.mock("@/services/jellyfinApi", () => ({
  canManageSubtitles: jest.fn(async () => true),
  downloadRemoteSubtitle: jest.fn(async () => 204),
  uploadSubtitle: jest.fn(async () => 204),
  waitForSubtitleStream: jest.fn(async () => ({ Type: "Subtitle", Codec: "subrip", Index: 7 })),
  externalTextStreams: jest.fn(() => []),
  searchRemoteSubtitles: jest.fn(),
  fetchRemoteSubtitleFile: jest.fn(),
  notifySubtitlesChanged: jest.fn(),
}));
const mockFetchFile = jest.fn();
const mockRunChain = jest.fn();
jest.mock("@/services/subtitles/chain", () => {
  const actual = jest.requireActual("@/services/subtitles/chain");
  return { ...actual, sourceFor: () => ({ fetch: (...args: unknown[]) => mockFetchFile(...args) }), runChain: (...args: unknown[]) => mockRunChain(...args) };
});

import { fakeFs } from "./fakeFileSystem";
import * as jellyfinApi from "@/services/jellyfinApi";
import { resetSourceChain, sourceDown } from "@/services/subtitles/chain";
import { appliedStreamIndex, applyPick, searchSubtitles, type ApplyResult } from "@/services/subtitles/pipeline";
import { subtitleQuery } from "@/services/subtitles/query";
import { deviceSubtitles } from "@/services/subtitles/store";
import type { SubtitleHit } from "@/services/subtitles/types";
import type { JellyfinVideoItem } from "@/types/jellyfin";

const api = jellyfinApi as jest.Mocked<typeof jellyfinApi>;
const item = { Id: "item1", Name: "Film", Type: "Movie", Path: "/m/Film.mkv", MediaStreams: [] } as unknown as JellyfinVideoItem;
const SRT = "1\n00:00:01,000 --> 00:00:02,000\nHi\n";

function hit(over: Partial<SubtitleHit> = {}): SubtitleHit {
  return {
    id: "p1",
    source: "podnapisi",
    name: "Film.2020",
    language: "es",
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

beforeEach(() => {
  fakeFs.clear();
  resetSourceChain();
  mockPrefs.saveSubtitles = true;
  api.canManageSubtitles.mockResolvedValue(true);
  api.downloadRemoteSubtitle.mockResolvedValue(204);
  api.uploadSubtitle.mockResolvedValue(204);
  api.uploadSubtitle.mockClear();
  api.waitForSubtitleStream.mockResolvedValue({ Type: "Subtitle", Codec: "subrip", Index: 7 });
  mockFetchFile.mockReset();
  mockFetchFile.mockResolvedValue({ text: SRT, format: "srt" });
});

describe("searchSubtitles", () => {
  const episode = {
    Id: "e1",
    Name: "Pilot",
    Type: "Episode",
    Path: "/tv/Some.Show.S04E06.720p.HDTV.mkv",
    SeriesName: "Some Show",
    ParentIndexNumber: 4,
    IndexNumber: 6,
    MediaStreams: [],
  } as unknown as JellyfinVideoItem;

  it("asks by title and by file name, merges the hits once each and keeps every refusal", async () => {
    mockRunChain.mockReset();
    mockRunChain.mockImplementation(async (query: { keywords: string }) =>
      query.keywords === "Some Show"
        ? { hits: [hit({ id: "a", source: "gestdown" }), hit({ id: "b", source: "gestdown" })], answeredBy: "gestdown", refused: [{ source: "server", status: 500 }] }
        : { hits: [hit({ id: "b", source: "gestdown" }), hit({ id: "c", source: "opensubtitles", hashMatch: true })], answeredBy: "gestdown", refused: [{ source: "server", status: 500 }] },
    );
    const answer = await searchSubtitles(episode.Id, subtitleQuery(episode), "en");
    expect(mockRunChain.mock.calls.map((call) => (call[0] as { keywords: string }).keywords)).toEqual(["Some Show", "Some Show S04E06 720p HDTV"]);
    expect(answer.hits.map((entry) => entry.id)).toEqual(["c", "a", "b"]);
    expect(answer.refused).toEqual([{ source: "server", status: 500 }]);
    expect(answer.answeredBy).toBe("gestdown");
  });

  it("asks once when the file name says nothing more than the title", async () => {
    mockRunChain.mockReset();
    mockRunChain.mockResolvedValue({ hits: [], answeredBy: null, refused: [] });
    await searchSubtitles("v1", subtitleQuery({ Id: "v1", Name: "Clip", Type: "Video", Path: "/v/Clip.mov" } as unknown as JellyfinVideoItem), "en");
    expect(mockRunChain).toHaveBeenCalledTimes(1);
  });
});

describe("applyPick", () => {
  it("has the server fetch its own hit and waits for the sidecar to show", async () => {
    const result = await applyPick(item, hit({ source: "server", id: "srv1" }));
    expect(api.downloadRemoteSubtitle).toHaveBeenCalledWith("item1", "srv1");
    expect(result).toEqual({ ok: true, where: "server", language: "es", streamIndex: 7 });
    expect(deviceSubtitles("http://server:8096", "item1")).toEqual([]);
  });

  it("uploads any other hit in ISO 639-2 and reports the new stream", async () => {
    const result = await applyPick(item, hit({ hearingImpaired: true }));
    expect(api.uploadSubtitle).toHaveBeenCalledWith("item1", { language3: "spa", format: "srt", isForced: false, isHearingImpaired: true, text: SRT });
    expect(result).toEqual({ ok: true, where: "server", language: "es", streamIndex: 7 });
  });

  it("keeps the file on the device when the account may not save, as WebVTT", async () => {
    api.canManageSubtitles.mockResolvedValue(false);
    const result = await applyPick(item, hit());
    expect(api.uploadSubtitle).not.toHaveBeenCalled();
    expect(result).toMatchObject({ ok: true, where: "device", language: "es", deviceReason: "permission" });
    const kept = deviceSubtitles("http://server:8096", "item1");
    expect(kept).toHaveLength(1);
    expect(fakeFs.get(kept[0].uri)?.content).toBe("WEBVTT\n\n1\n00:00:01.000 --> 00:00:02.000\nHi\n");
  });

  it("a replacement removes the device copy it names once the new one is kept", async () => {
    api.canManageSubtitles.mockResolvedValue(false);
    await applyPick(item, hit({ id: "old" }));
    const result = await applyPick(item, hit({ id: "new" }), undefined, { ordinal: 0 });
    expect(result).toMatchObject({ ok: true, where: "device" });
    expect(deviceSubtitles("http://server:8096", "item1").map((entry) => [entry.ordinal, entry.sourceId])).toEqual([[1, "new"]]);
  });

  it("keeps the file on the device when saving is switched off", async () => {
    mockPrefs.saveSubtitles = false;
    expect(await applyPick(item, hit())).toMatchObject({ ok: true, where: "device", deviceReason: "savingOff" });
    expect(api.uploadSubtitle).not.toHaveBeenCalled();
  });

  it("falls to the device when the upload is refused", async () => {
    api.uploadSubtitle.mockResolvedValue(403);
    expect(await applyPick(item, hit())).toMatchObject({ ok: true, where: "device", deviceReason: "uploadRefused" });
  });

  it("a kept pick announces the item's subtitles changed, a refused one does not", async () => {
    await applyPick(item, hit());
    expect(api.notifySubtitlesChanged).toHaveBeenCalledWith("item1");
    api.notifySubtitlesChanged.mockClear();
    api.downloadRemoteSubtitle.mockResolvedValue(500);
    await applyPick(item, hit({ source: "server", id: "srv1" }));
    expect(api.notifySubtitlesChanged).not.toHaveBeenCalled();
  });

  it("a server download refused marks the server down for the session", async () => {
    api.downloadRemoteSubtitle.mockResolvedValue(500);
    expect(await applyPick(item, hit({ source: "server", id: "srv1" }))).toEqual({ ok: false, reason: "refused", source: "server", status: 500 });
    expect(sourceDown("server")).toBe(500);
  });

  it("a file nothing can read is reported, not saved", async () => {
    mockFetchFile.mockResolvedValue({ text: "garbage", format: "sup" });
    expect(await applyPick(item, hit())).toEqual({ ok: false, reason: "unreadable", source: "podnapisi" });
    expect(deviceSubtitles("http://server:8096", "item1")).toEqual([]);
  });
});

describe("appliedStreamIndex", () => {
  it("a device copy plays under the device base plus its slot", async () => {
    api.canManageSubtitles.mockResolvedValue(false);
    await applyPick(item, hit({ id: "old" }));
    const result = await applyPick(item, hit({ id: "new" }));
    expect(appliedStreamIndex(result)).toBe(100001);
  });

  it("a server sidecar plays under the stream the server listed", () => {
    expect(appliedStreamIndex({ ok: true, where: "server", language: "es", streamIndex: 7 })).toBe(7);
  });

  it("answers undefined for a sidecar the server never listed and for a failure", () => {
    expect(appliedStreamIndex({ ok: true, where: "server", language: "es", streamIndex: null })).toBeUndefined();
    expect(appliedStreamIndex({ ok: false, reason: "failed", source: "podnapisi" } as ApplyResult)).toBeUndefined();
  });
});
