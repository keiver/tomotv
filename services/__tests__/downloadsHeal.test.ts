/**
 * The heal sweep: downloads that finished before this build could rewrap them get rewrapped
 * on a later launch, without the user asking or noticing.
 *
 * This is what makes a decline safe. A build with no subtitle encoder refuses every file
 * carrying subtitles, and those files have to convert themselves once the encoder ships
 * rather than staying on the slow path for the life of the download.
 */

jest.mock("expo-file-system", () => require("./fakeFileSystem"));

const mockRepackage = jest.fn();

jest.mock("react-native", () => ({
  Platform: { OS: "ios", isTV: false },
  NativeModules: {
    FileAttributes: { setExcludedFromBackup: jest.fn(async () => null) },
    LocalRemuxer: {
      repackageDownload: (config: unknown) => mockRepackage(config),
      cancelRepackage: jest.fn(async (_itemId: string) => null),
    },
  },
}));

jest.mock("@/utils/logger", () => ({ logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() } }));
jest.mock("@/services/jellyfin/session", () => ({
  getConfig: jest.fn(async () => ({ server: "https://jf", apiKey: "key", userId: "u", deviceId: "d" })),
  getAuthHeader: jest.fn(() => 'MediaBrowser Token="key"'),
}));
jest.mock("@/services/jellyfin/constants", () => ({ API_TIMEOUTS: { QUICK: 10000 } }));
jest.mock("@/services/jellyfin/http", () => ({ fetchWithTimeout: jest.fn(async () => ({ ok: false })) }));
jest.mock("@/services/jellyfin/streamUrls", () => ({ getRemoteVideoStreamUrl: jest.fn(() => "https://jf/stream") }));
jest.mock("@/services/jellyfin/images", () => ({ getPosterUrl: jest.fn(() => "https://jf/poster"), hasPoster: jest.fn(() => false) }));
jest.mock("@/services/itemArtwork", () => ({ wantsPosterFrame: jest.fn(() => false) }));
jest.mock("@/services/localRemux", () => ({ requestPosterFrame: jest.fn(async () => null) }));
jest.mock("@/services/jellyfin/subtitles", () => ({ getRemoteSubtitleUrl: jest.fn(() => "https://jf/sub"), getTextSubtitleStreams: jest.fn(() => []) }));

import { Paths } from "expo-file-system";
import { downloadManager } from "@/services/downloads/manager";
import { manifestEntry, resetManifestCache } from "@/services/downloads/manifest";
import { ensureDownloadsRoot, ensureItemDirectory, manifestFile, mediaFile, repackagedFile } from "@/services/downloads/paths";
import { setPlaybackHold } from "@/services/playbackHold";
import { fakeFs } from "./fakeFileSystem";

const ITEM = "held1";

/** A launch that finds one finished mkv nothing has rewrapped yet. */
async function seedReadyMkv(extra: Record<string, unknown> = {}): Promise<void> {
  await ensureDownloadsRoot();
  ensureItemDirectory(ITEM);
  mediaFile(ITEM, "mkv").write("0123456789");
  manifestFile().write(
    JSON.stringify({
      [ITEM]: {
        itemId: ITEM,
        fileUri: mediaFile(ITEM, "mkv").uri,
        artworkUri: null,
        bytesWritten: 10,
        totalBytes: 10,
        state: "ready",
        addedAt: 1,
        item: { Id: ITEM, Name: "Held", MediaSources: [{ Container: "mkv" }] },
        ...extra,
      },
    }),
  );
  resetManifestCache();
}

/** The sweep is detached from hydrate on purpose, so the screen never waits on it. */
async function settle(): Promise<void> {
  for (let i = 0; i < 20; i += 1) await Promise.resolve();
}

describe("heal sweep", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    fakeFs.clear();
    resetManifestCache();
    (downloadManager as any).hydrated = false;
    (downloadManager as any).hydrating = null;
    (Paths as unknown as { availableDiskSpace: number }).availableDiskSpace = 50 * 1024 * 1024 * 1024;
    setPlaybackHold("audio", false);
    setPlaybackHold("video", false);
  });

  // A queue resolves its file URLs once at start; a rewrap that deletes the source mid-queue
  // leaves every later track pointing at nothing, and the native player skips through them.
  it("waits for playback to let go before rewrapping, then finishes the pass", async () => {
    await seedReadyMkv();
    mockRepackage.mockImplementation(async () => {
      repackagedFile(ITEM).write("rewrapped");
      return { repackaged: true, subtitleStreamIndices: [] };
    });
    setPlaybackHold("audio", true);

    await downloadManager.hydrate();
    await settle();
    expect(mockRepackage).not.toHaveBeenCalled();
    expect(manifestEntry(ITEM)?.fileUri).toBe(mediaFile(ITEM, "mkv").uri);
    expect(manifestEntry(ITEM)?.state).toBe("ready");

    setPlaybackHold("audio", false);
    await settle();
    expect(mockRepackage).toHaveBeenCalledTimes(1);
    expect(manifestEntry(ITEM)?.fileUri).toBe(repackagedFile(ITEM).uri);
    expect(manifestEntry(ITEM)?.repackaged).toBe(true);
  });

  it("rewraps a download an earlier build had to leave alone", async () => {
    await seedReadyMkv();
    mockRepackage.mockImplementation(async () => {
      repackagedFile(ITEM).write("rewrapped");
      return { repackaged: true, subtitleStreamIndices: [2] };
    });

    await downloadManager.hydrate();
    await settle();

    expect(mockRepackage).toHaveBeenCalledTimes(1);
    const entry = manifestEntry(ITEM);
    expect(entry?.repackaged).toBe(true);
    expect(entry?.state).toBe("ready");
    expect(entry?.fileUri).toBe(repackagedFile(ITEM).uri);
  });

  it("counts a decline this build could undo, and leaves the file playable", async () => {
    await seedReadyMkv();
    mockRepackage.mockResolvedValue({ repackaged: false, reason: "this build has no mov_text encoder", permanent: false });

    await downloadManager.hydrate();
    await settle();

    const entry = manifestEntry(ITEM);
    expect(entry?.state).toBe("ready");
    expect(entry?.repackaged).toBe(false);
    // Unset, which is what keeps the next launch offering it to the sweep.
    expect(entry?.repackageDeclined).toBeUndefined();
    expect(entry?.repackageAttempts).toBe(1);
    expect(entry?.fileUri).toBe(mediaFile(ITEM, "mkv").uri);
  });

  it("leaves the allowance alone when there was no room to try", async () => {
    await seedReadyMkv();
    (Paths as unknown as { availableDiskSpace: number }).availableDiskSpace = 1024;

    await downloadManager.hydrate();
    await settle();

    const entry = manifestEntry(ITEM);
    expect(mockRepackage).not.toHaveBeenCalled();
    expect(entry?.state).toBe("ready");
    expect(entry?.repackageAttempts).toBeUndefined();
  });

  it("never offers a permanently declined file again", async () => {
    await seedReadyMkv();
    mockRepackage.mockResolvedValue({ repackaged: false, reason: "image subtitles need the engine's overlay", permanent: true });

    await downloadManager.hydrate();
    await settle();
    expect(manifestEntry(ITEM)?.repackageDeclined).toBe(true);

    // A second launch against the same manifest.
    (downloadManager as any).hydrated = false;
    (downloadManager as any).hydrating = null;
    mockRepackage.mockClear();
    await downloadManager.hydrate();
    await settle();

    expect(mockRepackage).not.toHaveBeenCalled();
  });

  it("gives up on a file that keeps failing", async () => {
    await seedReadyMkv({ repackageAttempts: 3 });
    await downloadManager.hydrate();
    await settle();
    expect(mockRepackage).not.toHaveBeenCalled();
  });

  it("leaves a download that is already an mp4 alone", async () => {
    await ensureDownloadsRoot();
    ensureItemDirectory(ITEM);
    mediaFile(ITEM, "mp4").write("0123456789");
    manifestFile().write(
      JSON.stringify({
        [ITEM]: {
          itemId: ITEM,
          fileUri: mediaFile(ITEM, "mp4").uri,
          artworkUri: null,
          bytesWritten: 10,
          totalBytes: 10,
          state: "ready",
          addedAt: 1,
          item: { Id: ITEM, Name: "Held", MediaSources: [{ Container: "mp4" }] },
        },
      }),
    );
    resetManifestCache();

    await downloadManager.hydrate();
    await settle();

    expect(mockRepackage).not.toHaveBeenCalled();
  });
});
