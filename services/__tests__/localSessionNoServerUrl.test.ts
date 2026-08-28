/**
 * The rule downloads rest on: a session for a held file carries NO server URL.
 *
 * Three separate server dependencies shipped inside a feature whose whole promise is that the
 * server is optional, because nothing ever asserted this. The engine's config is the one place
 * every one of them is visible at once: the input, the subtitle renditions, the Slipstream tier
 * and its audio group all land in it.
 */

jest.mock("expo-file-system", () => require("./fakeFileSystem"));

jest.mock("react-native", () => ({
  Platform: { OS: "ios", isTV: false },
  NativeModules: {
    FileAttributes: { setExcludedFromBackup: jest.fn(async () => null), isExcludedFromBackup: jest.fn(async () => true) },
    LocalRemuxer: { startRemux: jest.fn(async () => "http://127.0.0.1:1/token/master.m3u8") },
  },
  NativeEventEmitter: class {
    addListener() {
      return { remove() {} };
    }
  },
}));

jest.mock("@/utils/logger", () => ({ logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() } }));

jest.mock("@/services/jellyfin/session", () => ({
  getCachedConfig: () => ({ server: "https://jf.example", apiKey: "key", userId: "u", deviceId: "d" }),
  getQualitySettings: jest.fn(),
  generatePlaySessionId: () => "session",
}));

jest.mock("@/services/playbackProbe", () => ({ probeEmit: jest.fn() }));

// The measurement the tier is gated on. Deliberately slow: without the disk guard this alone
// puts a server variant first in the playlist.
jest.mock("@/services/jellyfin/bitrateTest", () => ({ rememberedBitrate: jest.fn(async () => 500_000) }));

import { NativeModules } from "react-native";
import { startLocalRemux, predictPlaybackLane } from "@/services/localRemux";
import { putEntry, resetManifestCache, type DownloadEntry } from "@/services/downloads/manifest";
import { fakeFs, File } from "./fakeFileSystem";

const MEDIA = "file:///doc/downloads/a/media.mkv";
const SUB = "file:///doc/downloads/a/sub.3.vtt";

/** H.264 with one AAC track and one text subtitle: the ordinary case, and SDR so a tier is eligible. */
const ITEM = {
  Id: "a",
  Name: "Bloom",
  RunTimeTicks: 60 * 10_000_000,
  MediaSources: [{ Id: "a", Container: "mkv", Bitrate: 8_000_000, Size: 100 }],
  MediaStreams: [
    { Type: "Video", Index: 0, Codec: "h264", Width: 1920, Height: 1080, BitRate: 7_000_000, VideoRangeType: "SDR" },
    { Type: "Audio", Index: 1, Codec: "aac", Channels: 2, BitRate: 192_000, SampleRate: 48_000, IsDefault: true },
    { Type: "Subtitle", Index: 3, Codec: "subrip", Language: "eng", IsDefault: true },
  ],
} as never;

function download(): DownloadEntry {
  return {
    itemId: "a",
    fileUri: MEDIA,
    artworkUri: null,
    bytesWritten: 100,
    totalBytes: 100,
    state: "ready",
    addedAt: 1,
    item: ITEM,
  };
}

/** Every string anywhere in the config the engine was handed. */
function stringsIn(value: unknown, found: string[] = []): string[] {
  if (typeof value === "string") found.push(value);
  else if (Array.isArray(value)) value.forEach((entry) => stringsIn(entry, found));
  else if (value && typeof value === "object") Object.values(value).forEach((entry) => stringsIn(entry, found));
  return found;
}

const startRemux = NativeModules.LocalRemuxer.startRemux as jest.Mock;

beforeEach(() => {
  resetManifestCache();
  jest.clearAllMocks();
  fakeFs.clear();
  startRemux.mockResolvedValue("http://127.0.0.1:1/token/master.m3u8");
});

describe("a session for a downloaded item", () => {
  it("carries no server URL anywhere in its config", async () => {
    new File(MEDIA).write("x".repeat(100));
    new File(SUB).write("WEBVTT\n\n");
    putEntry(download());

    await startLocalRemux(ITEM);

    const remote = stringsIn(startRemux.mock.calls[0][0]).filter((value) => value.startsWith("http://") || value.startsWith("https://"));
    expect(remote).toEqual([]);
  });

  it("reads the media and the subtitle track off the disk", async () => {
    new File(MEDIA).write("x".repeat(100));
    new File(SUB).write("WEBVTT\n\n");
    putEntry(download());

    await startLocalRemux(ITEM);
    const config = startRemux.mock.calls[0][0];

    expect(config.inputUrl).toBe(MEDIA);
    expect(config.subtitles).toHaveLength(1);
    // The path, not a URL: a file:// URI inside the loopback playlist is a scheme
    // AVFoundation will not follow, so the engine serves these bytes itself.
    expect(config.subtitles[0].localVtt).toBe(SUB);
    expect(config.subtitles[0].vttUrl).toBe("");
  });

  // The tier is a server-transcoded rung listed FIRST, so on a held file it is the difference
  // between playing off the disk and opening on a host that may not be there at all.
  it("declares no Slipstream tier, however slow the remembered link", async () => {
    new File(MEDIA).write("x".repeat(100));
    new File(SUB).write("WEBVTT\n\n");
    putEntry(download());

    await startLocalRemux(ITEM);
    const config = startRemux.mock.calls[0][0];

    expect(config.tierFirst).toBe(false);
    expect(config.tierPlaylistUrl).toBeUndefined();
  });

  it("does not report a smaller server feed in the lane label", async () => {
    new File(MEDIA).write("x".repeat(100));
    putEntry(download());
    await expect(predictPlaybackLane(ITEM)).resolves.toEqual({ lane: "copy", smallFeedFirst: false });
  });
});

describe("a session for an item that is not downloaded", () => {
  it("still declares the tier on a slow link, and still reads the server", async () => {
    await startLocalRemux(ITEM);
    const config = startRemux.mock.calls[0][0];

    expect(config.inputUrl).toContain("https://jf.example");
    expect(config.tierFirst).toBe(true);
    expect(config.subtitles[0].vttUrl).toContain("https://jf.example");
    expect(config.subtitles[0].localVtt).toBe("");
  });
});
