/**
 * Phase 3: what playback reads when a file is on disk, and what happens to a resume position
 * recorded with no server to tell.
 */

jest.mock("expo-file-system", () => require("./fakeFileSystem"));

jest.mock("react-native", () => ({
  Platform: { OS: "ios", isTV: false },
  NativeModules: { FileAttributes: { setExcludedFromBackup: jest.fn(async () => null), isExcludedFromBackup: jest.fn(async () => true) } },
}));

jest.mock("@/utils/logger", () => ({ logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() } }));

jest.mock("@/services/jellyfin/session", () => ({
  getCachedConfig: () => ({ server: "https://jf", apiKey: "key", userId: "u" }),
  getQualitySettings: jest.fn(),
}));

jest.mock("@/services/jellyfin/subtitles", () => ({ isImageBasedSubtitleCodec: () => false }));
jest.mock("@/services/jellyfin/playback", () => ({ updateUserItemData: jest.fn() }));

import { updateUserItemData } from "@/services/jellyfin/playback";
import { getRemoteVideoStreamUrl, getVideoStreamUrl } from "@/services/jellyfin/streamUrls";
import { downloadedItem, downloadedItems, localArtworkUri, localMediaUri } from "@/services/downloads/localSource";
import { manifestEntry, patchEntry, putEntry, resetManifestCache, type DownloadEntry } from "@/services/downloads/manifest";
import { flushOfflinePositions, recordOfflinePosition } from "@/services/downloads/offlineProgress";
import { fakeFs, File } from "./fakeFileSystem";

const ITEM = { Id: "a", Name: "Bloom", Type: "Audio", RunTimeTicks: 0, Path: "" } as unknown as DownloadEntry["item"];

function entry(overrides: Partial<DownloadEntry> = {}): DownloadEntry {
  return {
    itemId: "a",
    fileUri: "file:///doc/downloads/a/media.flac",
    artworkUri: "file:///doc/downloads/a/poster.jpg",
    bytesWritten: 100,
    totalBytes: 100,
    state: "ready",
    addedAt: 1,
    item: ITEM,
    ...overrides,
  };
}

const MEDIA = "file:///doc/downloads/a/media.flac";
const POSTER = "file:///doc/downloads/a/poster.jpg";

beforeEach(() => {
  resetManifestCache();
  jest.clearAllMocks();
  // Both readers stat the file rather than trust the manifest, so the fixture is on disk.
  fakeFs.clear();
  new File(MEDIA).write("x".repeat(100));
  new File(POSTER).write("poster-bytes");
});

describe("local source", () => {
  it("has nothing for an item that was never downloaded", () => {
    expect(localMediaUri("a")).toBeNull();
    expect(localArtworkUri("a")).toBeNull();
  });

  it("withholds the media until the transfer is complete", () => {
    putEntry(entry({ state: "downloading" }));
    expect(localMediaUri("a")).toBeNull();
  });

  it("offers the poster while the media is still transferring", () => {
    putEntry(entry({ state: "downloading" }));
    expect(localArtworkUri("a")).toBe("file:///doc/downloads/a/poster.jpg");
  });
});

describe("getVideoStreamUrl", () => {
  it("streams from the server when nothing is on disk", () => {
    expect(getVideoStreamUrl("a", null)).toContain("https://jf/Videos/a/stream");
  });

  it("plays the downloaded file once it is complete", () => {
    putEntry(entry());
    expect(getVideoStreamUrl("a", null)).toBe("file:///doc/downloads/a/media.flac");
  });

  it("still builds the server URL for the download itself", () => {
    putEntry(entry());
    expect(getRemoteVideoStreamUrl("a", null)).toContain("https://jf/Videos/a/stream");
  });

  // The manifest outlives the media: a reinstall moves the container, and the row still says
  // ready. Playback has to reach the server rather than open a path that is not there.
  it("streams from the server when the manifest says ready but the file is missing", () => {
    putEntry(entry());
    new File(MEDIA).delete();
    expect(getVideoStreamUrl("a", null)).toContain("https://jf/Videos/a/stream");
  });
});

describe("offline resume positions", () => {
  it("ignores an item that is not a download", () => {
    recordOfflinePosition("a", 500, false);
    expect(manifestEntry("a")).toBeUndefined();
  });

  it("holds a position that could not reach the server", () => {
    putEntry(entry());
    recordOfflinePosition("a", 500, false);
    expect(manifestEntry("a")?.pendingProgress?.ticks).toBe(500);
  });

  it("replays held positions and clears them once the server takes them", async () => {
    putEntry(entry());
    recordOfflinePosition("a", 500, false);
    (updateUserItemData as jest.Mock).mockResolvedValue(true);

    await flushOfflinePositions();

    expect(updateUserItemData).toHaveBeenCalledWith("a", { PlaybackPositionTicks: 500, Played: false });
    expect(manifestEntry("a")?.pendingProgress).toBeUndefined();
  });

  it("keeps them when the server is still away", async () => {
    putEntry(entry());
    recordOfflinePosition("a", 500, false);
    (updateUserItemData as jest.Mock).mockResolvedValue(false);

    await flushOfflinePositions();
    expect(manifestEntry("a")?.pendingProgress?.ticks).toBe(500);
  });

  it("stops at the first failure rather than burning a timeout per item", async () => {
    putEntry(entry());
    putEntry(entry({ itemId: "b", addedAt: 2 }));
    recordOfflinePosition("a", 500, false);
    recordOfflinePosition("b", 900, false);
    (updateUserItemData as jest.Mock).mockResolvedValue(false);

    await flushOfflinePositions();
    expect(updateUserItemData).toHaveBeenCalledTimes(1);
  });

  it("keeps only the newest position for an item", () => {
    putEntry(entry());
    recordOfflinePosition("a", 500, false);
    patchEntry("a", {});
    recordOfflinePosition("a", 900, true);
    expect(manifestEntry("a")?.pendingProgress).toMatchObject({ ticks: 900, played: true });
  });
});

describe("downloaded item payloads", () => {
  it("answers only for a completed download", () => {
    putEntry(entry({ state: "downloading" }));
    expect(downloadedItem("a")).toBeNull();
    expect(downloadedItems()).toEqual([]);

    patchEntry("a", { state: "ready" });
    expect(downloadedItem("a")?.Name).toBe("Bloom");
    expect(downloadedItems()).toHaveLength(1);
  });

  it("lists the newest request first", () => {
    putEntry(entry({ itemId: "a", addedAt: 1 }));
    putEntry(entry({ itemId: "b", addedAt: 2, item: { ...ITEM, Id: "b", Name: "Two Weeks" } }));
    expect(downloadedItems().map((item) => item.Id)).toEqual(["b", "a"]);
  });
});
