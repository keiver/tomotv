/**
 * A downloaded item is answered off the disk, without touching the network.
 *
 * This is the whole promise of Downloads. It used to ask the server first and only reach the
 * stored payload from a catch, so with no route to the server a file already on the device
 * waited out three 15s timeouts and two backoffs before it played.
 */

jest.mock("expo-file-system", () => require("./fakeFileSystem"));

const mockFetch = jest.fn();

jest.mock("react-native", () => ({
  Platform: { OS: "ios", isTV: false },
  NativeModules: { FileAttributes: { setExcludedFromBackup: jest.fn(async () => null) } },
}));

jest.mock("@/utils/logger", () => ({ logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() } }));
jest.mock("@/services/jellyfin/session", () => ({
  getConfig: jest.fn(async () => ({ server: "https://jf", apiKey: "key", userId: "u", deviceId: "d" })),
  getAuthHeader: jest.fn(() => 'MediaBrowser Token="key"'),
}));
jest.mock("@/services/jellyfin/http", () => ({ fetchWithTimeout: (...args: unknown[]) => mockFetch(...args) }));

import { fetchVideoDetails } from "@/services/jellyfin/items";
import { recordLocalPosition } from "@/services/downloads/offlineProgress";
import { manifestEntry, putEntry, resetManifestCache } from "@/services/downloads/manifest";
import { ensureItemDirectory, mediaFile } from "@/services/downloads/paths";
import { fakeFs } from "./fakeFileSystem";

const ITEM = "held-offline";

function seedReady(positionTicks = 0): void {
  ensureItemDirectory(ITEM);
  mediaFile(ITEM, "mkv").write("0123456789");
  putEntry({
    itemId: ITEM,
    fileUri: mediaFile(ITEM, "mkv").uri,
    artworkUri: null,
    bytesWritten: 10,
    totalBytes: 10,
    state: "ready",
    addedAt: 1,
    item: {
      Id: ITEM,
      Name: "Held",
      MediaSources: [{ Container: "mkv", Id: ITEM }],
      MediaStreams: [{ Type: "Video", Codec: "h264", Index: 0 }],
      UserData: { PlaybackPositionTicks: positionTicks, Played: false },
    } as unknown as Parameters<typeof putEntry>[0]["item"],
  });
}

describe("a held item never waits on the server", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    fakeFs.clear();
    resetManifestCache();
    // Any call at all is a failure, so make one loud rather than slow.
    mockFetch.mockImplementation(() => {
      throw new Error("the network was asked about a file that is already on disk");
    });
  });

  it("answers from the stored payload with no request", async () => {
    seedReady();

    const details = await fetchVideoDetails(ITEM);

    expect(mockFetch).not.toHaveBeenCalled();
    expect(details?.Id).toBe(ITEM);
    expect(details?.MediaStreams?.[0]?.Codec).toBe("h264");
  });

  it("carries the position this device last played, not the one from download day", async () => {
    seedReady(0);
    recordLocalPosition(ITEM, 1_234_567, false);

    const details = await fetchVideoDetails(ITEM);

    expect(mockFetch).not.toHaveBeenCalled();
    expect(details?.UserData?.PlaybackPositionTicks).toBe(1_234_567);
  });

  it("records the position whether or not the server took the write", () => {
    seedReady(0);
    // The success path: the server accepted it, and the payload still has to know.
    recordLocalPosition(ITEM, 999, true);
    const entry = manifestEntry(ITEM);
    expect(entry?.item.UserData?.PlaybackPositionTicks).toBe(999);
    expect(entry?.item.UserData?.Played).toBe(true);
    // Nothing is owed to the server, so no replay is queued.
    expect(entry?.pendingProgress).toBeUndefined();
  });

  it("still asks the server for something that is not downloaded", async () => {
    await expect(fetchVideoDetails("not-downloaded")).rejects.toThrow();
    expect(mockFetch).toHaveBeenCalled();
  });
});
