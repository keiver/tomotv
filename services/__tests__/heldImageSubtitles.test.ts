/**
 * Turning a player subtitle selection back into a bitmap track on a repackaged download.
 *
 * An MP4 cannot hold PGS, so each bitmap track ships as an empty tx3g track carrying only its
 * language. That is what puts it in the player's own subtitle menu. AVFoundation then lists
 * every track twice, as the language and as "<language> Forced", adjacent and in file order,
 * so track n occupies ordinals 2n and 2n+1. Getting that wrong paints the wrong subtitles.
 */

jest.mock("expo-file-system", () => require("./fakeFileSystem"));
jest.mock("react-native", () => ({
  Platform: { OS: "ios", isTV: false },
  NativeModules: { FileAttributes: { setExcludedFromBackup: jest.fn(async () => null) } },
}));
jest.mock("@/utils/logger", () => ({ logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() } }));

import { heldImageSubtitleForOrdinal } from "@/services/downloads/localSource";
import { putEntry, resetManifestCache, type DownloadEntry } from "@/services/downloads/manifest";
import { ensureItemDirectory, repackagedFile } from "@/services/downloads/paths";
import { fakeFs } from "./fakeFileSystem";

const ITEM = "held-pgs";

/** Sintel's shape, with the first and last tracks as bitmaps. */
function seed(patch: Partial<DownloadEntry> = {}): void {
  ensureItemDirectory(ITEM);
  repackagedFile(ITEM).write("mp4");
  putEntry({
    itemId: ITEM,
    fileUri: repackagedFile(ITEM).uri,
    artworkUri: null,
    bytesWritten: 3,
    totalBytes: 3,
    state: "ready",
    addedAt: 1,
    repackaged: true,
    subtitleStreamIndices: [4, 5, 6, 7, 8, 9],
    imageSubtitleIndices: [4, 9],
    item: { Id: ITEM, Name: "Held", MediaSources: [{ Container: "mkv" }] } as unknown as DownloadEntry["item"],
    ...patch,
  });
}

describe("heldImageSubtitleForOrdinal", () => {
  beforeEach(() => {
    fakeFs.clear();
    resetManifestCache();
    seed();
  });

  it("resolves both ordinals of a bitmap track to its source stream", () => {
    expect(heldImageSubtitleForOrdinal(ITEM, 0)).toBe(4);
    expect(heldImageSubtitleForOrdinal(ITEM, 1)).toBe(4);
  });

  it("resolves the last track, where an off-by-one would land outside", () => {
    expect(heldImageSubtitleForOrdinal(ITEM, 10)).toBe(9);
    expect(heldImageSubtitleForOrdinal(ITEM, 11)).toBe(9);
  });

  it("says nothing to draw for a text track, which the player renders itself", () => {
    for (const ordinal of [2, 3, 4, 5, 6, 7, 8, 9]) {
      expect(heldImageSubtitleForOrdinal(ITEM, ordinal)).toBeNull();
    }
  });

  it("ignores the options iOS appends after ours", () => {
    // iOS 27 adds its own Translated entries past the file's real tracks.
    expect(heldImageSubtitleForOrdinal(ITEM, 12)).toBeNull();
    expect(heldImageSubtitleForOrdinal(ITEM, 13)).toBeNull();
    expect(heldImageSubtitleForOrdinal(ITEM, -1)).toBeNull();
  });

  it("draws nothing for a download that was never repackaged", () => {
    resetManifestCache();
    seed({ repackaged: undefined });
    expect(heldImageSubtitleForOrdinal(ITEM, 0)).toBeNull();
  });

  it("draws nothing when the file carries no bitmap tracks at all", () => {
    resetManifestCache();
    seed({ imageSubtitleIndices: [] });
    expect(heldImageSubtitleForOrdinal(ITEM, 0)).toBeNull();
  });

  it("draws nothing for an item that is not downloaded", () => {
    expect(heldImageSubtitleForOrdinal("nothing-here", 0)).toBeNull();
  });
});
