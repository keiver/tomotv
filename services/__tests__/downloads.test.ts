/**
 * The download stack against an in-memory filesystem: the manifest's round trip, and the
 * manager's queueing, completion, pause/resume, deletion and launch reconciliation.
 *
 * expo-file-system is faked rather than stubbed per call, what the manager does is defined
 * by what ends up on disk (a launch after termination reads the file, not a promise), so the
 * fake has to actually hold bytes.
 */

jest.mock("expo-file-system", () => require("./fakeFileSystem"));

jest.mock("react-native", () => ({
  Platform: { OS: "ios", isTV: false },
  NativeModules: { FileAttributes: { setExcludedFromBackup: jest.fn(async () => null), isExcludedFromBackup: jest.fn(async () => true) } },
}));

jest.mock("@/utils/logger", () => ({ logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() } }));

jest.mock("@/services/jellyfin/session", () => ({
  getConfig: jest.fn(async () => ({ server: "https://jf", apiKey: "key", userId: "u", deviceId: "d" })),
  getAuthHeader: jest.fn(() => 'MediaBrowser Token="key"'),
}));

jest.mock("@/services/jellyfin/constants", () => ({ API_TIMEOUTS: { QUICK: 10000 } }));
jest.mock("@/services/jellyfin/http", () => ({ fetchWithTimeout: jest.fn() }));

jest.mock("@/services/jellyfin/streamUrls", () => ({
  getRemoteVideoStreamUrl: jest.fn(() => "https://jf/Videos/a/stream?Static=true"),
  getConvertedDownloadUrl: jest.fn(
    (itemId: string, _item: unknown, rung: { width: number }, audioIndex: number) => `https://jf/Videos/${itemId}/stream.mp4?MaxWidth=${rung.width}&AudioStreamIndex=${audioIndex}`,
  ),
}));
const RUNG = { label: "1080p", bitrate: 8000000, width: 1920, height: 1080 };
jest.mock("@/services/downloads/convert", () => ({
  conversionRung: jest.fn(async () => RUNG),
  conversionAudioIndex: jest.fn(() => 1),
  convertedItem: jest.fn((item: { MediaSources: { Id: string }[] }) => ({ ...item, Container: "mp4", MediaSources: [{ Id: item.MediaSources[0].Id, Container: "mp4" }] })),
}));
jest.mock("@/services/jellyfin/images", () => ({ getPosterUrl: jest.fn(() => "https://jf/poster"), hasPoster: jest.fn(() => true) }));
jest.mock("@/services/itemArtwork", () => ({ wantsPosterFrame: jest.fn(() => false) }));
jest.mock("@/services/localRemux", () => ({ requestPosterFrame: jest.fn(async () => null), cancelPosterFrame: jest.fn() }));
const textSubtitles: { Index: number }[] = [];
jest.mock("@/services/jellyfin/subtitles", () => ({
  getRemoteSubtitleUrl: jest.fn((itemId: string, index: number) => `https://jf/Videos/${itemId}/${itemId}/Subtitles/${index}/Stream.vtt`),
  getTextSubtitleStreams: jest.fn(() => textSubtitles),
}));

import { downloadManager, resetDownloadPolicyCache } from "@/services/downloads/manager";
import { localArtworkUri, localSubtitleUri, playbackArtworkUri } from "@/services/downloads/localSource";
import { flushManifest, loadManifest, manifestEntry, patchEntry, readyFileUri, resetManifestCache } from "@/services/downloads/manifest";
import { downloadsExcludedFromBackup, manifestFile } from "@/services/downloads/paths";
import { hasPoster } from "@/services/jellyfin/images";
import { wantsPosterFrame } from "@/services/itemArtwork";
import { requestPosterFrame } from "@/services/localRemux";
import { fetchWithTimeout } from "@/services/jellyfin/http";
import { getConfig } from "@/services/jellyfin/session";
import { Directory, DownloadTask, fakeFs, FakeTask, File } from "./fakeFileSystem";
import { readFileSync } from "fs";
import { join } from "path";

const MEDIA_URI = "file:///doc/downloads/a/media.flac";

const ITEM = (id: string, size = 100) =>
  ({
    Id: id,
    Name: `Track ${id}`,
    Type: "Audio",
    RunTimeTicks: 0,
    Path: "",
    MediaSources: [{ Id: `src-${id}`, Container: "flac", Size: size }],
    ImageTags: { Primary: "tag" },
  }) as never;

const tasks: FakeTask[] = [];

beforeEach(async () => {
  textSubtitles.length = 0;
  await downloadManager.removeAll();
  fakeFs.clear();
  tasks.length = 0;
  jest.clearAllMocks();
  resetManifestCache();
  resetDownloadPolicyCache();

  (fetchWithTimeout as jest.Mock).mockResolvedValue({ ok: true, json: async () => ({ Policy: { EnableContentDownloading: true } }) });
  (hasPoster as jest.Mock).mockReturnValue(true);
  (wantsPosterFrame as jest.Mock).mockReturnValue(false);
  (requestPosterFrame as jest.Mock).mockResolvedValue(null);
  File.createDownloadTask.mockImplementation((_url: string, destination: File, options: never) => {
    const task = new FakeTask(destination, options);
    tasks.push(task);
    return task;
  });
  DownloadTask.fromSavable.mockImplementation((state: { fileUri: string }, options: never) => {
    const task = new FakeTask(new File(state.fileUri), options);
    tasks.push(task);
    return task;
  });
});

describe("downloads manifest", () => {
  it("survives a relaunch through the JSON file", async () => {
    await add(ITEM("a"));
    await flushManifest();

    resetManifestCache();
    await loadManifest();
    expect(manifestEntry("a")?.item.Name).toBe("Track a");
  });

  it("starts empty when the file is corrupt rather than throwing", async () => {
    new Directory("file:///doc", "downloads").create();
    manifestFile().write("{ not json");
    resetManifestCache();
    await expect(loadManifest()).resolves.toEqual({});
  });
});

describe("downloadManager", () => {
  it("writes the media under Documents/downloads and marks the root do-not-back-up", async () => {
    await add(ITEM("a"));
    expect(manifestEntry("a")?.fileUri).toBe(MEDIA_URI);
    await expect(downloadsExcludedFromBackup()).resolves.toBe(true);
  });

  it("ignores a second request for the same item", async () => {
    await add(ITEM("a"));
    await add(ITEM("a"));
    expect(tasks).toHaveLength(1);
  });

  it("runs two transfers at once and holds the rest queued", async () => {
    await add(ITEM("a"));
    await add(ITEM("b"));
    await add(ITEM("c"));

    expect(tasks).toHaveLength(2);
    expect(manifestEntry("c")?.state).toBe("queued");
  });

  it("starts the queued transfer once one finishes", async () => {
    await add(ITEM("a"));
    await add(ITEM("b"));
    await add(ITEM("c"));

    tasks[0].complete(100);
    await settle();

    expect(manifestEntry("a")?.state).toBe("ready");
    expect(tasks).toHaveLength(3);
  });

  it("reports progress as the bytes land", async () => {
    await add(ITEM("a"));
    tasks[0].options.onProgress?.({ bytesWritten: 40, totalBytes: 100 });
    expect(manifestEntry("a")?.bytesWritten).toBe(40);
  });

  it("keeps the byte feed off the list subscribers and on the row's own channel", async () => {
    await add(ITEM("a"));
    const list = jest.fn();
    const row = jest.fn();
    const stopList = downloadManager.subscribe(list);
    const stopRow = downloadManager.subscribeProgress("a", row);
    list.mockClear();
    row.mockClear();

    tasks[0].options.onProgress?.({ bytesWritten: 40, totalBytes: 100 });
    tasks[0].options.onProgress?.({ bytesWritten: 60, totalBytes: 100 });
    await new Promise((resolve) => setTimeout(resolve, 450));

    // Re-rendering the whole list on every byte accumulated a gigabyte of Reanimated worklets
    // over one 469 MB transfer.
    expect(list).not.toHaveBeenCalled();
    expect(row).toHaveBeenCalledTimes(1);
    expect(row).toHaveBeenCalledWith({ bytesWritten: 60, totalBytes: 100 });

    tasks[0].complete(100);
    await settle();
    expect(list).toHaveBeenCalled();

    stopList();
    stopRow();
  });

  it("resumes from the in-memory handle, and never writes it to disk", async () => {
    await add(ITEM("a"));
    await downloadManager.pause("a");
    await settle();

    expect(manifestEntry("a")?.state).toBe("paused");
    // The resume blob carries the access token; the manifest is plaintext in the container.
    expect(JSON.stringify(manifestEntry("a"))).not.toContain("resumeData");

    downloadManager.resume("a");
    await settle();
    expect(DownloadTask.fromSavable).toHaveBeenCalled();
  });

  it("restarts a transfer paused before any byte landed as a fresh request", async () => {
    await add(ITEM("a"));
    tasks[0].savable.mockReturnValueOnce({ url: "u", fileUri: MEDIA_URI, isDirectory: false, resumeData: undefined } as never);
    await downloadManager.pause("a");
    await settle();

    downloadManager.resume("a");
    await settle();

    expect(DownloadTask.fromSavable).not.toHaveBeenCalled();
    expect(File.createDownloadTask).toHaveBeenCalledTimes(2);
    expect(manifestEntry("a")?.state).toBe("downloading");
  });

  it("restarts a paused transfer after a relaunch, the resume handle being gone", async () => {
    await add(ITEM("a"));
    await downloadManager.pause("a");
    await settle();
    await flushManifest();

    await relaunch();
    downloadManager.resume("a");
    await settle();

    expect(DownloadTask.fromSavable).not.toHaveBeenCalled();
    expect(File.createDownloadTask).toHaveBeenCalled();
  });

  it("keeps the access token out of the manifest file", async () => {
    await add(ITEM("a"));
    await downloadManager.pause("a");
    await flushManifest();
    expect(await manifestFile().text()).not.toContain("key");
  });

  it("records a failed transfer with its reason instead of retrying forever", async () => {
    await add(ITEM("a"));
    tasks[0].reject(new Error("server returned HTTP 403"));
    await settle();

    expect(manifestEntry("a")?.state).toBe("failed");
    expect(manifestEntry("a")?.error).toContain("403");
  });

  it("rewinds a row an older build failed for want of a session", async () => {
    await add(ITEM("a"));
    patchEntry("a", { state: "failed", error: "Not connected to a server" });
    await flushManifest();

    await relaunch();

    expect(manifestEntry("a")?.state).toBe("paused");
    expect(manifestEntry("a")?.error).toBeUndefined();
  });

  it("parks a transfer rather than failing it while signed out", async () => {
    await add(ITEM("a"));
    await downloadManager.pause("a");
    await settle();

    (getConfig as jest.Mock).mockResolvedValueOnce({ server: "", apiKey: "", userId: "", deviceId: "d" });
    downloadManager.resume("a");
    await settle();

    expect(manifestEntry("a")?.state).toBe("paused");
    expect(manifestEntry("a")?.error).toBeUndefined();
    expect(DownloadTask.fromSavable).not.toHaveBeenCalled();
  });

  it("parks every queued transfer while signed out, not only the first two", async () => {
    const signedOut = { server: "", apiKey: "", userId: "", deviceId: "d" };
    (getConfig as jest.Mock).mockResolvedValueOnce(signedOut).mockResolvedValueOnce(signedOut).mockResolvedValueOnce(signedOut);

    // Queued together, so the third waits on a slot that only a park can free.
    await Promise.all([downloadManager.enqueue(ITEM("a")), downloadManager.enqueue(ITEM("b")), downloadManager.enqueue(ITEM("c"))]);
    await settle();

    expect(manifestEntry("a")?.state).toBe("paused");
    expect(manifestEntry("b")?.state).toBe("paused");
    expect(manifestEntry("c")?.state).toBe("paused");
    expect(tasks).toHaveLength(0);
  });

  it("deletes the item's whole directory on remove", async () => {
    await add(ITEM("a"));
    tasks[0].complete(100);
    await settle();

    await downloadManager.remove("a");
    expect(manifestEntry("a")).toBeUndefined();
    expect(new File(MEDIA_URI).exists).toBe(false);
  });

  // The screen renders nothing until `hydrated`, and nothing calls hydrate() again once it is
  // mounted, so clearing the flag here left the tab permanently blank.
  it("stays hydrated through Remove All, so the screen keeps rendering", async () => {
    await add(ITEM("a"));
    tasks[0].complete(100);
    await settle();
    await downloadManager.hydrate();

    await downloadManager.removeAll();

    expect(downloadManager.getState()).toMatchObject({ entries: [], hydrated: true });
  });

  it("adopts a transfer that finished while the app was dead", async () => {
    await add(ITEM("a"));
    // The background session moved the bytes; the JS task never heard about it.
    new File(MEDIA_URI).write("x".repeat(100));
    await flushManifest();

    await relaunch();
    expect(manifestEntry("a")?.state).toBe("ready");
  });

  it("leaves a half-finished transfer paused for the user to resume", async () => {
    await add(ITEM("a"));
    new File(MEDIA_URI).write("x".repeat(30));
    await flushManifest();

    await relaunch();
    expect(manifestEntry("a")?.state).toBe("paused");
  });

  it("falls back to the direct-play stream when the server refuses the Download endpoint", async () => {
    (fetchWithTimeout as jest.Mock).mockResolvedValue({ ok: true, json: async () => ({ Policy: { EnableContentDownloading: false } }) });
    await add(ITEM("a"));
    await settle();
    expect(File.createDownloadTask).toHaveBeenCalledWith("https://jf/Videos/a/stream?Static=true", expect.anything(), expect.anything());
  });

  // The server re-encodes on the way down: the transfer reads the progressive endpoint, lands
  // as an MP4 of unknown size, and the manifest describes that file rather than the source.
  it("fetches a conversion from the progressive endpoint and stores the converted item", async () => {
    await downloadManager.enqueue(ITEM("a"), { convert: true });
    await settle();
    expect(File.createDownloadTask).toHaveBeenCalledWith("https://jf/Videos/a/stream.mp4?MaxWidth=1920&AudioStreamIndex=1", expect.anything(), expect.anything());
    const entry = manifestEntry("a");
    expect(entry?.converted).toEqual(RUNG);
    expect(entry?.totalBytes).toBe(-1);
    expect(entry?.fileUri).toBe("file:///doc/downloads/a/media.mp4");
    expect(entry?.item.MediaSources?.[0]?.Container).toBe("mp4");
    tasks[0].complete(2048);
    await settle();
    expect(manifestEntry("a")?.state).toBe("ready");
    expect(manifestEntry("a")?.totalBytes).toBe(2048);
  });

  it("never asks the Download policy for a conversion", async () => {
    await downloadManager.enqueue(ITEM("a"), { convert: true });
    await settle();
    expect(fetchWithTimeout).not.toHaveBeenCalled();
  });
});

/**
 * iOS issues a new Data container UUID on reinstall. Every absolute path the manifest recorded
 * then addresses a directory that no longer exists, which stalls the player instead of falling
 * back to the server.
 */
describe("downloads across a container change", () => {
  const readyDownload = async () => {
    await add(ITEM("a"));
    tasks[0].complete(100);
    await settle();
  };

  it("plays a ready download whose recorded path belongs to a previous install", async () => {
    await readyDownload();
    patchEntry("a", { fileUri: "file:///old-container/downloads/a/media.flac" });

    expect(readyFileUri("a")).toBe(MEDIA_URI);
  });

  it("reports no local file when the media is gone, so playback falls back to the server", async () => {
    await readyDownload();
    new File(MEDIA_URI).delete();

    expect(readyFileUri("a")).toBeNull();
  });

  // Text renditions are the one part of a session the engine hands AVPlayer as a URL rather
  // than serving itself, so a held file without them plays with no subtitles at all.
  it("saves every text subtitle track with the download", async () => {
    textSubtitles.push({ Index: 3 });
    await readyDownload();

    expect(localSubtitleUri("a", 3)).toBe("file:///doc/downloads/a/sub.3.vtt");
  });

  it("backfills subtitles for a download taken before they were saved", async () => {
    await readyDownload();
    await flushManifest();
    expect(localSubtitleUri("a", 3)).toBeNull();

    textSubtitles.push({ Index: 3 });
    await relaunch();
    await settle();

    expect(localSubtitleUri("a", 3)).toBe("file:///doc/downloads/a/sub.3.vtt");
  });

  it("resolves the poster against the current container and drops it when absent", async () => {
    await readyDownload();
    const poster = "file:///doc/downloads/a/poster.jpg";
    expect(localArtworkUri("a")).toBe(poster);

    new File(poster).delete();
    expect(localArtworkUri("a")).toBeNull();
  });

  // The connected server need not be the one the item came from, so a held item's picture is
  // its cached poster or nothing; the server is asked only for items that stream.
  it("draws a held item's cached poster only, never the connected server's", async () => {
    await readyDownload();
    const poster = "file:///doc/downloads/a/poster.jpg";
    expect(playbackArtworkUri({ Id: "a", ImageTags: { Primary: "tag" } }, 600)).toBe(poster);

    new File(poster).delete();
    expect(playbackArtworkUri({ Id: "a", ImageTags: { Primary: "tag" } }, 600)).toBeNull();

    expect(playbackArtworkUri({ Id: "streams", ImageTags: { Primary: "tag" } }, 600)).toBe("https://jf/poster");
  });

  // The row must draw the same picture the grid does, and keep drawing it with no server and
  // after the frame pool has trimmed the original.
  it("copies the engine's keyframe beside the media when the server has no poster", async () => {
    (hasPoster as jest.Mock).mockReturnValue(false);
    (wantsPosterFrame as jest.Mock).mockReturnValue(true);
    const frame = "file:///cache/chapter-frames/a/poster.jpg";
    new File(frame).write("frame-bytes");
    (requestPosterFrame as jest.Mock).mockResolvedValue(frame);

    await readyDownload();

    expect(localArtworkUri("a")).toBe("file:///doc/downloads/a/poster.jpg");
    expect(await new File("file:///doc/downloads/a/poster.jpg").text()).toBe("frame-bytes");
    expect(File.downloadFileAsync).not.toHaveBeenCalled();
  });

  it("backfills the keyframe for a download taken before the engine made them", async () => {
    (hasPoster as jest.Mock).mockReturnValue(false);
    (wantsPosterFrame as jest.Mock).mockReturnValue(true);
    await readyDownload();
    await flushManifest();
    expect(localArtworkUri("a")).toBeNull();

    const frame = "file:///cache/chapter-frames/a/poster.jpg";
    new File(frame).write("frame-bytes");
    (requestPosterFrame as jest.Mock).mockResolvedValue(frame);
    await relaunch();
    await settle();

    expect(localArtworkUri("a")).toBe("file:///doc/downloads/a/poster.jpg");
  });

  it("demotes a ready row whose media vanished so the screen offers it again", async () => {
    await readyDownload();
    await flushManifest();
    new File(MEDIA_URI).delete();

    await relaunch();
    expect(manifestEntry("a")?.state).toBe("failed");
  });

  it("leaves a ready row alone when the media is still there", async () => {
    await readyDownload();
    await flushManifest();

    await relaunch();
    expect(manifestEntry("a")?.state).toBe("ready");
  });
});

/** Let the manager's promise chain run out. */
async function settle() {
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
}

/** enqueue() resolves before start() has built the task; tests need the task. */
async function add(item: never) {
  await downloadManager.enqueue(item);
  await settle();
}

/** A cold start: the manager re-reads whatever is on disk. */
async function relaunch() {
  resetManifestCache();

  const internals = downloadManager as any;
  internals.hydrated = false;
  internals.hydrating = null;
  internals.tasks.clear();
  internals.resumeStates.clear();
  await downloadManager.hydrate();
}

describe("downloads outlive the session", () => {
  // One client, several servers, signed in and out all day: the files stay. Checked against the
  // source because signOut reaches other modules through `await import`, which jest cannot
  // execute (ERR_VM_DYNAMIC_IMPORT_CALLBACK_MISSING_FLAG) and whose failure the surrounding
  // catch swallows, so a mocked-manager assertion would pass either way.
  it("sign-out holds no route to the downloads layer", () => {
    const source = readFileSync(join(__dirname, "..", "jellyfin", "session.ts"), "utf8");

    expect(source).not.toMatch(/downloads\/manager/);
    expect(source).not.toMatch(/removeAll/);
  });
});
