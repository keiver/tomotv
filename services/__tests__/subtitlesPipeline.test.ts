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
}));
const mockFetchFile = jest.fn();
jest.mock("@/services/subtitles/chain", () => {
  const actual = jest.requireActual("@/services/subtitles/chain");
  return { ...actual, sourceFor: () => ({ fetch: (...args: unknown[]) => mockFetchFile(...args) }) };
});

import { fakeFs } from "./fakeFileSystem";
import * as jellyfinApi from "@/services/jellyfinApi";
import { resetSourceChain, sourceDown } from "@/services/subtitles/chain";
import { applyPick } from "@/services/subtitles/pipeline";
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
    expect(result).toMatchObject({ ok: true, where: "device", language: "es" });
    const kept = deviceSubtitles("http://server:8096", "item1");
    expect(kept).toHaveLength(1);
    expect(fakeFs.get(kept[0].uri)?.content).toBe("WEBVTT\n\n1\n00:00:01.000 --> 00:00:02.000\nHi\n");
  });

  it("keeps the file on the device when saving is switched off", async () => {
    mockPrefs.saveSubtitles = false;
    expect(await applyPick(item, hit())).toMatchObject({ ok: true, where: "device" });
    expect(api.uploadSubtitle).not.toHaveBeenCalled();
  });

  it("falls to the device when the upload is refused", async () => {
    api.uploadSubtitle.mockResolvedValue(403);
    expect(await applyPick(item, hit())).toMatchObject({ ok: true, where: "device" });
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
