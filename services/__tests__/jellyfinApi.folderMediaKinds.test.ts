/**
 * Tests for fetchFolderMediaKinds, what a container holds, which decides the play CTAs the
 * info panel offers. Each case uses a distinct item id so the shared request cache can't serve
 * one test's answer to another.
 */
import { fetchFolderMediaKinds, refreshConfig } from "../jellyfinApi";
import { JellyfinItem } from "@/types/jellyfin";

jest.mock("expo-secure-store", () => ({
  getItemAsync: jest.fn().mockResolvedValue(null),
  setItemAsync: jest.fn().mockResolvedValue(undefined),
  deleteItemAsync: jest.fn().mockResolvedValue(undefined),
}));

jest.mock("@/services/libraryManager", () => ({
  libraryManager: {
    clearCache: jest.fn(),
  },
}));

/** Counts the server answers with, keyed by MediaTypes, for the recursive and direct queries. */
interface CountShape {
  recursive: { Video: number; Audio: number; Photo: number };
  direct: { Video: number; Audio: number; Photo: number };
}

describe("fetchFolderMediaKinds", () => {
  const mockSecureStore = require("expo-secure-store");

  const folder = (id: string, type = "CollectionFolder"): JellyfinItem => ({ Id: id, Name: id, Type: type }) as JellyfinItem;

  beforeEach(async () => {
    global.fetch = jest.fn();

    mockSecureStore.getItemAsync.mockImplementation((key: string) => {
      const mockConfig: Record<string, string> = {
        jellyfin_server_url: "http://192.168.1.100:8096",
        jellyfin_api_key: "test-api-key",
        jellyfin_user_id: "test-user-id",
        jellyfin_device_id: "test-device-id",
      };
      return Promise.resolve(mockConfig[key] || null);
    });

    await refreshConfig();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  /** Answers each count query from the shape, so no test depends on request ORDER. */
  function serveCounts(shape: CountShape) {
    (global.fetch as jest.Mock).mockImplementation(async (input: string) => {
      const url = new URL(input);
      const mediaType = url.searchParams.get("MediaTypes") as "Video" | "Audio" | "Photo";
      const bucket = url.searchParams.get("Recursive") === "true" ? shape.recursive : shape.direct;
      return { ok: true, json: async () => ({ TotalRecordCount: bucket[mediaType] }) };
    });
  }

  it("reads one kind per media type, recursively and directly", async () => {
    serveCounts({ recursive: { Video: 0, Audio: 62, Photo: 0 }, direct: { Video: 0, Audio: 62, Photo: 0 } });

    await expect(fetchFolderMediaKinds(folder("music-lib"))).resolves.toEqual({ video: false, audio: true, photo: false });
    expect((global.fetch as jest.Mock).mock.calls).toHaveLength(6);
  });

  it("takes the union of the two counts, because view roots under-report both ways", async () => {
    // Measured on 10.11.11 for a `homevideos` root: no video recursively, 21 directly, and
    // more photos recursively (albums) than directly.
    serveCounts({ recursive: { Video: 0, Audio: 0, Photo: 85 }, direct: { Video: 21, Audio: 0, Photo: 33 } });

    await expect(fetchFolderMediaKinds(folder("home-videos"))).resolves.toEqual({ video: true, audio: false, photo: true });
  });

  it("offers both play CTAs for a folder holding video and audio", async () => {
    serveCounts({ recursive: { Video: 189, Audio: 5, Photo: 0 }, direct: { Video: 7, Audio: 0, Photo: 0 } });

    await expect(fetchFolderMediaKinds(folder("mixed-lib"))).resolves.toEqual({ video: true, audio: true, photo: false });
  });

  it("reports nothing playable for an empty container", async () => {
    serveCounts({ recursive: { Video: 0, Audio: 0, Photo: 0 }, direct: { Video: 0, Audio: 0, Photo: 0 } });

    await expect(fetchFolderMediaKinds(folder("empty-lib"))).resolves.toEqual({ video: false, audio: false, photo: false });
  });

  it("classifies a playlist from its own items, not from a ParentId query", async () => {
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: async () => ({
        Items: [
          { Id: "song", Name: "Song", Type: "Audio" },
          { Id: "clip", Name: "Clip", Type: "Movie" },
        ],
      }),
    });

    await expect(fetchFolderMediaKinds(folder("playlist-1", "Playlist"))).resolves.toEqual({ video: true, audio: true, photo: false });

    const requested = new URL((global.fetch as jest.Mock).mock.calls[0][0] as string);
    expect(requested.pathname).toBe("/Playlists/playlist-1/Items");
  });

  // A playlist longer than one page used to be classified from its first 500 entries, so a
  // kind that appeared only later cost the panel its CTA.
  it("classifies a playlist from every page, not just the first", async () => {
    const PAGE = 500;
    const audioPage = Array.from({ length: PAGE }, (_, i) => ({ Id: `song-${i}`, Name: "Song", Type: "Audio" }));
    (global.fetch as jest.Mock).mockImplementation(async (input: string) => {
      const startIndex = Number(new URL(input).searchParams.get("StartIndex"));
      const items = startIndex === 0 ? audioPage : [{ Id: "late-clip", Name: "Clip", Type: "Movie" }];
      return { ok: true, json: async () => ({ Items: items, TotalRecordCount: PAGE + 1 }) };
    });

    await expect(fetchFolderMediaKinds(folder("long-playlist", "Playlist"))).resolves.toEqual({ video: true, audio: true, photo: false });

    const pages = (global.fetch as jest.Mock).mock.calls.map((c) => new URL(c[0] as string).searchParams.get("StartIndex"));
    expect(pages).toEqual(["0", "500"]);
  });

  it("reports nothing playable when the server fails, leaving the panel on its browse action", async () => {
    (global.fetch as jest.Mock).mockResolvedValue({ ok: false, status: 500 });

    await expect(fetchFolderMediaKinds(folder("broken-lib"))).resolves.toEqual({ video: false, audio: false, photo: false });
  });
});
