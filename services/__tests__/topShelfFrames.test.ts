/**
 * Top Shelf keyframes: the row's items without a server poster get their settled keyframe
 * copied into the App Group container by content, stale copies go, and tvOS is told to
 * reload the shelf only when the directory changed.
 */
const GROUP = "file:///group";
const SHELF = `${GROUP}/Library/Caches/topshelf-frames`;

const mockReload = jest.fn(async () => undefined);
const mockSettled = new Map<string, string | null>();
let mockGeneration = 0;
let mockFrameListener: ((itemId: string) => void) | null = null;
let mockPrefsListener: (() => void) | null = null;
const mockPrefs = { devicePosters: true };
const mockNativeModules: Record<string, unknown> = { TopShelfReload: { reload: () => mockReload() } };
const mockPlatform = { OS: "ios", isTV: true };

jest.mock("expo-file-system", () => {
  const fake = require("./fakeFileSystem");
  return { ...fake, Paths: { ...fake.Paths, appleSharedContainers: { "group.dev.keiver.tomotv": { uri: "file:///group" } } } };
});
jest.mock("react-native", () => ({ Platform: mockPlatform, NativeModules: mockNativeModules }));
jest.mock("@/utils/logger", () => ({ logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() } }));
jest.mock("@/services/localRemux", () => ({
  posterFrameIfCached: (id: string) => mockSettled.get(id),
  posterFrameGeneration: () => mockGeneration,
  subscribePosterFrames: (listener: (itemId: string) => void) => {
    mockFrameListener = listener;
    return () => {};
  },
}));
jest.mock("@/services/uiPreferences", () => ({
  getUiPreferences: () => mockPrefs,
  subscribeUiPreferences: (listener: () => void) => {
    mockPrefsListener = listener;
    return () => {};
  },
}));
jest.mock("@/services/itemArtwork", () => ({
  wantsPosterFrame: (item: { ImageTags?: { Primary?: string } }) => mockPrefs.devicePosters && !item.ImageTags?.Primary,
}));

type Fake = typeof import("./fakeFileSystem");
let shelf: typeof import("@/services/topShelfFrames");
let fakeFs: Fake["fakeFs"];
let File: Fake["File"];

const item = (Id: string, poster = false) => ({ Id, Type: "Episode", ImageTags: poster ? { Primary: "tag" } : {}, MediaStreams: [] }) as never;
const pool = (id: string, content: string) => {
  const uri = `file:///cache/chapter-frames/${id}/poster.jpg`;
  fakeFs.set(uri, { isDirectory: false, content, size: content.length, mtime: 0 });
  mockSettled.set(id, uri);
};
const shelfFiles = () =>
  [...fakeFs.keys()]
    .filter((key) => key.startsWith(`${SHELF}/`))
    .map((key) => key.slice(SHELF.length + 1))
    .sort();

beforeEach(() => {
  jest.clearAllMocks();
  mockSettled.clear();
  mockGeneration = 0;
  mockFrameListener = null;
  mockPrefsListener = null;
  mockPrefs.devicePosters = true;
  mockPlatform.isTV = true;
  mockNativeModules.TopShelfReload = { reload: () => mockReload() };
  // A fresh publisher per test; the file system it sees is the one required here.
  jest.isolateModules(() => {
    ({ fakeFs, File } = require("./fakeFileSystem"));
    shelf = require("@/services/topShelfFrames");
  });
  // The fake has no md5: the content stands in for it.
  Object.defineProperty(File.prototype, "md5", {
    configurable: true,
    get(this: { uri: string }) {
      const node = fakeFs.get(this.uri);
      return node && !node.isDirectory ? `md5-${node.content}` : null;
    },
  });
});

describe("shelfFrameCandidates", () => {
  it("keeps only items without a server poster", () => {
    expect(shelf.shelfFrameCandidates([item("a"), item("b", true)]).map((entry: { Id: string }) => entry.Id)).toEqual(["a"]);
  });
});

describe("syncShelfFrames", () => {
  it("copies each settled keyframe under its item id and content, then reloads the shelf", async () => {
    pool("a", "pic-a");
    await shelf.syncShelfFrames([item("a"), item("b", true)]);
    expect(shelfFiles()).toEqual(["a.md5-pic-a.jpg"]);
    expect(fakeFs.get(`${SHELF}/a.md5-pic-a.jpg`)?.content).toBe("pic-a");
    expect(mockReload).toHaveBeenCalledTimes(1);
  });

  it("does not reload when nothing on the shelf changed", async () => {
    pool("a", "pic-a");
    await shelf.syncShelfFrames([item("a")]);
    await shelf.syncShelfFrames([item("a")]);
    expect(mockReload).toHaveBeenCalledTimes(1);
  });

  it("replaces the item's copy when its keyframe changed", async () => {
    pool("a", "pic-a");
    await shelf.syncShelfFrames([item("a")]);
    pool("a", "pic-a2");
    await shelf.syncShelfFrames([item("a")]);
    expect(shelfFiles()).toEqual(["a.md5-pic-a2.jpg"]);
    expect(mockReload).toHaveBeenCalledTimes(2);
  });

  it("keeps the item's copy when the pool has trimmed its keyframe", async () => {
    pool("a", "pic-a");
    await shelf.syncShelfFrames([item("a")]);
    fakeFs.delete("file:///cache/chapter-frames/a/poster.jpg");
    await shelf.syncShelfFrames([item("a")]);
    expect(shelfFiles()).toEqual(["a.md5-pic-a.jpg"]);
  });

  it("deletes the copies of items that left the row", async () => {
    pool("a", "pic-a");
    pool("b", "pic-b");
    await shelf.syncShelfFrames([item("a"), item("b")]);
    await shelf.syncShelfFrames([item("b")]);
    expect(shelfFiles()).toEqual(["b.md5-pic-b.jpg"]);
    expect(mockReload).toHaveBeenCalledTimes(2);
  });

  it("copies nothing for an item whose keyframe has not settled or failed", async () => {
    mockSettled.set("a", null);
    await shelf.syncShelfFrames([item("a"), item("b")]);
    expect(shelfFiles()).toEqual([]);
    expect(mockReload).not.toHaveBeenCalled();
  });

  it("stops when the server changed while a copy ran", async () => {
    pool("a", "pic-a");
    pool("b", "pic-b");
    const copy = File.prototype.copy;
    jest.spyOn(File.prototype, "copy").mockImplementationOnce(async function (this: InstanceType<typeof File>, destination: InstanceType<typeof File>) {
      await copy.call(this, destination);
      mockGeneration += 1;
    });
    await shelf.syncShelfFrames([item("a"), item("b")]);
    expect(shelfFiles()).toEqual(["a.md5-pic-a.jpg"]);
    expect(mockReload).not.toHaveBeenCalled();
  });

  it("copies a keyframe that settles after the row loaded, for the row's items only", async () => {
    await shelf.syncShelfFrames([item("a")]);
    pool("a", "pic-a");
    pool("z", "pic-z");
    mockFrameListener?.("z");
    await new Promise((resolve) => setImmediate(resolve));
    expect(shelfFiles()).toEqual([]);
    mockFrameListener?.("a");
    await new Promise((resolve) => setImmediate(resolve));
    expect(shelfFiles()).toEqual(["a.md5-pic-a.jpg"]);
    expect(mockReload).toHaveBeenCalledTimes(1);
  });

  it("empties the shelf when Settings turns device posters off, and only on that change", async () => {
    pool("a", "pic-a");
    await shelf.syncShelfFrames([item("a")]);
    mockPrefsListener?.();
    await new Promise((resolve) => setImmediate(resolve));
    expect(mockReload).toHaveBeenCalledTimes(1);
    mockPrefs.devicePosters = false;
    mockPrefsListener?.();
    await new Promise((resolve) => setImmediate(resolve));
    expect(shelfFiles()).toEqual([]);
    expect(mockReload).toHaveBeenCalledTimes(2);
  });

  it("does nothing off tvOS or on a binary without the reload module", async () => {
    pool("a", "pic-a");
    mockPlatform.isTV = false;
    await shelf.syncShelfFrames([item("a")]);
    mockPlatform.isTV = true;
    delete mockNativeModules.TopShelfReload;
    await shelf.syncShelfFrames([item("a")]);
    await shelf.clearShelfFrames();
    expect(shelfFiles()).toEqual([]);
    expect(mockReload).not.toHaveBeenCalled();
  });
});

describe("clearShelfFrames", () => {
  it("deletes every copy and reloads the shelf", async () => {
    pool("a", "pic-a");
    await shelf.syncShelfFrames([item("a")]);
    await shelf.clearShelfFrames();
    expect(shelfFiles()).toEqual([]);
    expect(fakeFs.has(SHELF)).toBe(false);
    expect(mockReload).toHaveBeenCalledTimes(2);
  });

  it("forgets the row, so a keyframe settling afterwards copies nothing", async () => {
    await shelf.syncShelfFrames([item("a")]);
    await shelf.clearShelfFrames();
    pool("a", "pic-a");
    mockFrameListener?.("a");
    await new Promise((resolve) => setImmediate(resolve));
    expect(shelfFiles()).toEqual([]);
  });
});
