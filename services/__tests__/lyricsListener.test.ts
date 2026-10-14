/**
 * The listening wrapper: which songs it will listen to, where the audio comes from, and that a
 * fetched copy never outlives the listening.
 */
jest.mock("expo-file-system", () => require("./fakeFileSystem"));
jest.mock("@/utils/logger", () => ({ logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() } }));
jest.mock("react-native", () => ({
  Platform: { OS: "ios", isTV: false },
  NativeModules: { LyricsListener: { capability: jest.fn(async () => ({ available: true })), transcribe: jest.fn() } },
}));
jest.mock("@/services/downloads/localSource", () => ({ localMediaUri: jest.fn(() => null) }));
jest.mock("@/services/downloads/paths", () => ({ sizeOf: jest.fn((item: { MediaSources?: { Size?: number }[] }) => item.MediaSources?.[0]?.Size ?? 0) }));
jest.mock("@/services/i18n", () => ({ locale: jest.fn(() => "es"), deviceLanguage: jest.fn(() => "es") }));
jest.mock("@/services/jellyfin/streamUrls", () => ({ getRemoteVideoStreamUrl: jest.fn((id: string) => `http://server/Videos/${id}/stream`) }));

import { NativeModules } from "react-native";
import { localMediaUri } from "@/services/downloads/localSource";
import { listen, listenable, listenHintKey } from "@/services/lyrics/listener";
import type { JellyfinVideoItem } from "@/types/jellyfin";
import { fakeFs, File } from "./fakeFileSystem";

const TICKS = 10_000_000;
const song = (container = "flac", seconds = 200, size = 1000) =>
  ({ Id: "song-1", Name: "Night Drive", Type: "Audio", RunTimeTicks: seconds * TICKS, MediaSources: [{ Id: "source-1", Container: container, Size: size }] }) as JellyfinVideoItem;
const transcribe = NativeModules.LyricsListener.transcribe as jest.Mock;

beforeEach(() => {
  fakeFs.clear();
  jest.clearAllMocks();
  (localMediaUri as jest.Mock).mockReturnValue(null);
  transcribe.mockResolvedValue({ locale: "es_MX", words: [[1, 1.4, "hola"]] });
});

describe("listenHintKey", () => {
  it("points an Apple TV that cannot listen to the lyrics its iPhone, iPad or Mac write", () => {
    expect(listenHintKey(false, true)).toBe("lyrics.listenElsewhere");
    expect(listenHintKey(true, true)).toBe("lyrics.listenHint");
    expect(listenHintKey(false, false)).toBe("lyrics.listenHint");
  });
});

describe("listenable", () => {
  it("takes songs Core Audio can open, up to ten minutes and eighty megabytes", () => {
    expect(listenable(song("flac"))).toBe(true);
    expect(listenable(song("mp3"))).toBe(true);
    expect(listenable(song("ogg"))).toBe(false);
    expect(listenable(song("flac", 601))).toBe(false);
    expect(listenable(song("flac", 0))).toBe(false);
    expect(listenable(song("flac", 200, 81 * 1024 * 1024))).toBe(false);
  });

  it("takes an m4a from a queue item without MediaSources, whose container lists every MP4 name", () => {
    const queued = { Id: "song-1", Name: "Night Drive", Type: "Audio", RunTimeTicks: 200 * TICKS, Container: "mov,mp4,m4a,3gp,3g2,mj2" } as JellyfinVideoItem;
    expect(listenable(queued)).toBe(true);
    expect(listenable({ ...queued, Container: "matroska,webm" })).toBe(false);
  });
});

describe("listen", () => {
  it("fetches a copy of a streamed song, listens with the app's languages, and removes the copy", async () => {
    const heard = await listen(song(), "la letra");

    expect(heard).toEqual([{ start: 1, end: 1.4, text: "hola" }]);
    expect(File.downloadFileAsync).toHaveBeenCalledWith("http://server/Videos/song-1/stream", expect.objectContaining({ uri: "file:///cache/listen-song-1.flac" }), { idempotent: true });
    expect(transcribe).toHaveBeenCalledWith({ fileUri: "file:///cache/listen-song-1.flac", lyrics: "la letra", languages: ["es", "en"] });
    expect(fakeFs.has("file:///cache/listen-song-1.flac")).toBe(false);
  });

  it("names the fetched copy after the first container name Core Audio opens", async () => {
    const queued = { Id: "song-1", Name: "Night Drive", Type: "Audio", RunTimeTicks: 200 * TICKS, Container: "mov,mp4,m4a,3gp,3g2,mj2" } as JellyfinVideoItem;

    await listen(queued, null);

    expect(transcribe).toHaveBeenCalledWith(expect.objectContaining({ fileUri: "file:///cache/listen-song-1.mp4" }));
  });

  it("listens to a downloaded song where it is", async () => {
    (localMediaUri as jest.Mock).mockReturnValue("file:///doc/downloads/song-1/media.flac");

    await listen(song(), null);

    expect(File.downloadFileAsync).not.toHaveBeenCalled();
    expect(transcribe).toHaveBeenCalledWith({ fileUri: "file:///doc/downloads/song-1/media.flac", lyrics: undefined, languages: ["es", "en"] });
  });

  it("is null for a song it will not listen to, a language it cannot, or a failure, and still removes the copy", async () => {
    expect(await listen(song("ogg"), null)).toBeNull();
    expect(transcribe).not.toHaveBeenCalled();

    transcribe.mockResolvedValue(null);
    expect(await listen(song(), null)).toBeNull();

    transcribe.mockRejectedValue(new Error("model unavailable"));
    expect(await listen(song(), null)).toBeNull();
    expect(fakeFs.has("file:///cache/listen-song-1.flac")).toBe(false);
  });
});
