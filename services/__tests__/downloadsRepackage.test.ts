/**
 * The repackage gate: which finished downloads get rewrapped into MP4 and which are left
 * exactly as they arrived.
 *
 * Declining is the important half. A download that is not rewrapped has to come back holding
 * its original file, because the item keeps playing through the engine on that file and a
 * wrong answer here strands it with no media at all.
 */

jest.mock("expo-file-system", () => require("./fakeFileSystem"));

const mockRepackage = jest.fn();
const mockCancelRepackage = jest.fn(async (_itemId: string) => null);

jest.mock("react-native", () => ({
  Platform: { OS: "ios", isTV: false },
  NativeModules: {
    FileAttributes: { setExcludedFromBackup: jest.fn(async () => null) },
    LocalRemuxer: {
      repackageDownload: (config: unknown) => mockRepackage(config),
      cancelRepackage: (itemId: string) => mockCancelRepackage(itemId),
    },
  },
}));

jest.mock("@/utils/logger", () => ({ logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() } }));

import { File, Paths } from "expo-file-system";
import type { DownloadEntry } from "@/services/downloads/manifest";
import { ensureItemDirectory, mediaFile, repackagedFile } from "@/services/downloads/paths";
import { MAX_REPACKAGE_ATTEMPTS, needsRepackage, repackageDownload } from "@/services/downloads/repackage";

function entryFor(container: string, itemId = "item1"): DownloadEntry {
  return {
    itemId,
    fileUri: mediaFile(itemId, container).uri,
    artworkUri: null,
    bytesWritten: 10,
    totalBytes: 10,
    state: "repackaging",
    addedAt: 1,
    item: { Id: itemId, Name: "x", MediaSources: [{ Container: container }] } as unknown as DownloadEntry["item"],
  };
}

/** The source as it exists after a transfer: a real file with bytes in it. */
function sourceFor(entry: DownloadEntry, container: string): File {
  ensureItemDirectory(entry.itemId);
  const file = mediaFile(entry.itemId, container);
  file.write("0123456789");
  return file;
}

describe("repackageDownload", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (Paths as unknown as { availableDiskSpace: number }).availableDiskSpace = 50 * 1024 * 1024 * 1024;
  });

  it("rewraps an mkv and reports the file it wrote", async () => {
    const entry = entryFor("mkv", "rewrapped");
    const source = sourceFor(entry, "mkv");
    mockRepackage.mockImplementation(async ({ outputPath }: { outputPath: string }) => {
      repackagedFile(entry.itemId).write("rewrapped");
      expect(outputPath).not.toContain("file://");
      return { repackaged: true, subtitleStreamIndices: [2, 3], droppedAudioIndices: [], elapsedSeconds: 0.4 };
    });

    const outcome = await repackageDownload(entry, source);

    expect(outcome.repackaged).toBe(true);
    expect(outcome.file.uri).toBe(repackagedFile(entry.itemId).uri);
    // The source is gone: two copies of a film is the whole reason to delete it.
    expect(source.exists).toBe(false);
  });

  it("never calls the native side for a container AVFoundation already opens", async () => {
    const entry = entryFor("mov", "native");
    const source = sourceFor(entry, "mov");

    const outcome = await repackageDownload(entry, source);

    expect(mockRepackage).not.toHaveBeenCalled();
    expect(outcome.repackaged).toBe(false);
    expect(outcome.file.uri).toBe(source.uri);
    expect(source.exists).toBe(true);
  });

  it("keeps the original when the native side declines", async () => {
    const entry = entryFor("mkv", "declined");
    const source = sourceFor(entry, "mkv");
    mockRepackage.mockResolvedValue({ repackaged: false, reason: "image subtitles need the engine's overlay" });

    const outcome = await repackageDownload(entry, source);

    expect(outcome.repackaged).toBe(false);
    expect(outcome.file.uri).toBe(source.uri);
    expect(source.exists).toBe(true);
  });

  it("keeps the original when the native side throws", async () => {
    const entry = entryFor("mkv", "threw");
    const source = sourceFor(entry, "mkv");
    mockRepackage.mockRejectedValue(new Error("boom"));

    const outcome = await repackageDownload(entry, source);

    expect(outcome.repackaged).toBe(false);
    expect(outcome.file.uri).toBe(source.uri);
    expect(source.exists).toBe(true);
  });

  it("keeps the original when success is claimed but nothing was written", async () => {
    const entry = entryFor("mkv", "lied");
    const source = sourceFor(entry, "mkv");
    mockRepackage.mockResolvedValue({ repackaged: true, subtitleStreamIndices: [] });

    const outcome = await repackageDownload(entry, source);

    expect(outcome.repackaged).toBe(false);
    expect(outcome.file.uri).toBe(source.uri);
    expect(source.exists).toBe(true);
  });

  it("leaves the file alone rather than filling the disk to convert it", async () => {
    const entry = entryFor("mkv", "nospace");
    const source = sourceFor(entry, "mkv");
    (Paths as unknown as { availableDiskSpace: number }).availableDiskSpace = 1024;

    const outcome = await repackageDownload(entry, source);

    expect(mockRepackage).not.toHaveBeenCalled();
    expect(outcome.file.uri).toBe(source.uri);
    expect(outcome.skipped).toBe(true);
  });
});

describe("needsRepackage", () => {
  it("offers a ready mkv that nothing has decided about yet", () => {
    expect(needsRepackage(entryFor("mkv", "fresh"))).toBe(false);
    expect(needsRepackage({ ...entryFor("mkv", "fresh"), state: "ready" })).toBe(true);
  });

  it("leaves alone what is already done or already refused", () => {
    const ready = { ...entryFor("mkv", "done"), state: "ready" as const };
    expect(needsRepackage({ ...ready, repackaged: true })).toBe(false);
    expect(needsRepackage({ ...ready, repackageDeclined: true })).toBe(false);
  });

  it("stops offering a file that has failed its allowance", () => {
    const ready = { ...entryFor("mkv", "tired"), state: "ready" as const };
    expect(needsRepackage({ ...ready, repackageAttempts: MAX_REPACKAGE_ATTEMPTS - 1 })).toBe(true);
    expect(needsRepackage({ ...ready, repackageAttempts: MAX_REPACKAGE_ATTEMPTS })).toBe(false);
  });

  it("never offers a container AVFoundation already opens", () => {
    expect(needsRepackage({ ...entryFor("mp4", "native1"), state: "ready" })).toBe(false);
    expect(needsRepackage({ ...entryFor("mov,mp4,m4a", "native2"), state: "ready" })).toBe(false);
  });

  // An MP3 copied into MP4 loads as playable=false with no audio track, and the rewrap
  // deletes the source, so offering one leaves the item with nothing that opens.
  it("never offers an audio container that plays as it stands", () => {
    for (const container of ["mp3", "flac", "wav"]) {
      expect(needsRepackage({ ...entryFor(container, `audio-${container}`), state: "ready" })).toBe(false);
    }
  });

  it("treats a file already holding the rewrapped media as done", () => {
    // What a crash between writing the file and writing the flag leaves behind.
    const entry = { ...entryFor("mkv", "flagless"), state: "ready" as const };
    expect(needsRepackage({ ...entry, fileUri: repackagedFile("flagless").uri })).toBe(false);
  });

  it("keeps offering a file this build could not take but a later one can", () => {
    // A decline for a missing encoder never sets repackageDeclined, which is what
    // lets the sweep pick every one of them up after the encoder ships.
    const ready = { ...entryFor("mkv", "retryable"), state: "ready" as const, repackageAttempts: 1 };
    expect(needsRepackage(ready)).toBe(true);
  });
});
