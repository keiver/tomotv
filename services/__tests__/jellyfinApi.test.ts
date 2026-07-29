import {
  isCodecSupported,
  needsTranscoding,
  isAudioOnly,
  formatDuration,
  hasPoster,
  searchVideos,
  fetchFolderContents,
  fetchLibraryVideos,
  fetchLibraryYears,
  fetchPlaylistContents,
  fetchRecursiveVideos,
  fetchUserViews,
  setVideoFavorite,
  isFolder,
  isPhoto,
  connectToDemoServer,
  isDemoMode,
  disconnectFromDemo,
  getVideoStreamUrl,
  getTranscodingStreamUrl,
  getPosterUrl,
  getFolderThumbnailUrl,
  getSubtitleUrl,
  getSubtitleTracks,
  isImageBasedSubtitleCodec,
  getBurnInSubtitleStream,
  getBurnInSubtitlesSetting,
  refreshConfig,
  getConfig,
  buildServerUrlCandidates,
  checkServerInfo,
  evaluateSavedConnection,
  getAuthHeader,
  resolveServerConnection,
} from "../jellyfinApi";
import { EMPTY_FILTERS, JellyfinVideoItem } from "@/types/jellyfin";

// Mock expo-secure-store
jest.mock("expo-secure-store", () => ({
  getItemAsync: jest.fn().mockResolvedValue(null),
  setItemAsync: jest.fn().mockResolvedValue(undefined),
  deleteItemAsync: jest.fn().mockResolvedValue(undefined),
}));

// Mock managers to prevent cache clearing errors in tests
jest.mock("@/services/libraryManager", () => ({
  libraryManager: {
    clearCache: jest.fn(),
  },
}));

describe("jellyfinApi", () => {
  describe("isCodecSupported", () => {
    it("should support H.264/AVC codec", () => {
      expect(isCodecSupported("h264")).toBe(true);
      expect(isCodecSupported("avc")).toBe(true);
      expect(isCodecSupported("H264")).toBe(true);
    });

    it("should support HEVC/H.265 codec", () => {
      expect(isCodecSupported("hevc")).toBe(true);
      expect(isCodecSupported("h265")).toBe(true);
      expect(isCodecSupported("HEVC")).toBe(true);
    });

    it("should not support MPEG-4", () => {
      expect(isCodecSupported("mpeg4")).toBe(false);
      expect(isCodecSupported("mpeg-4")).toBe(false);
    });

    it("should not support VP8/VP9", () => {
      expect(isCodecSupported("vp8")).toBe(false);
      expect(isCodecSupported("vp9")).toBe(false);
    });

    it("should not support AV1", () => {
      expect(isCodecSupported("av1")).toBe(false);
    });

    it("should not support VC1/WMV", () => {
      expect(isCodecSupported("vc1")).toBe(false);
      expect(isCodecSupported("wmv")).toBe(false);
    });

    it("should not support MPEG-2", () => {
      expect(isCodecSupported("mpeg2")).toBe(false);
    });

    it("should not support DivX/Xvid", () => {
      expect(isCodecSupported("divx")).toBe(false);
      expect(isCodecSupported("xvid")).toBe(false);
    });

    it("should default to not supported for unknown codecs", () => {
      expect(isCodecSupported("unknown_codec")).toBe(false);
    });
  });

  describe("needsTranscoding", () => {
    it("should return false for supported codec", () => {
      const videoItem: JellyfinVideoItem = {
        Id: "123",
        Name: "Test Video",
        MediaStreams: [{ Type: "Video", Codec: "h264", Index: 0 }],
      } as any;

      expect(needsTranscoding(videoItem)).toBe(false);
    });

    it("should return true for unsupported codec", () => {
      const videoItem: JellyfinVideoItem = {
        Id: "123",
        Name: "Test Video",
        MediaStreams: [{ Type: "Video", Codec: "mpeg4", Index: 0 }],
      } as any;

      expect(needsTranscoding(videoItem)).toBe(true);
    });

    it("should return false when no video stream exists", () => {
      const videoItem: JellyfinVideoItem = {
        Id: "123",
        Name: "Test Video",
        MediaStreams: [{ Type: "Audio", Codec: "aac", Index: 0 }],
      } as any;

      expect(needsTranscoding(videoItem)).toBe(false);
    });

    it("should return false when video item is null", () => {
      expect(needsTranscoding(null)).toBe(false);
    });

    it("should return true for supported codec in MKV container", () => {
      const videoItem: JellyfinVideoItem = {
        Id: "123",
        Name: "Test Video",
        MediaStreams: [{ Type: "Video", Codec: "h264", Index: 0 }],
        MediaSources: [{ Id: "123", Container: "mkv" }],
      } as any;

      expect(needsTranscoding(videoItem)).toBe(true);
    });

    it("should return false for supported codec in MP4 container", () => {
      const videoItem: JellyfinVideoItem = {
        Id: "123",
        Name: "Test Video",
        MediaStreams: [{ Type: "Video", Codec: "h264", Index: 0 }],
        MediaSources: [{ Id: "123", Container: "mp4" }],
      } as any;

      expect(needsTranscoding(videoItem)).toBe(false);
    });

    it("should return true for unsupported containers like avi and webm", () => {
      for (const container of ["avi", "wmv", "flv", "webm"]) {
        const videoItem: JellyfinVideoItem = {
          Id: "123",
          Name: "Test Video",
          MediaStreams: [{ Type: "Video", Codec: "hevc", Index: 0 }],
          MediaSources: [{ Id: "123", Container: container }],
        } as any;

        expect(needsTranscoding(videoItem)).toBe(true);
      }
    });

    it("should return false for comma-separated container with a supported token", () => {
      const videoItem: JellyfinVideoItem = {
        Id: "123",
        Name: "Test Video",
        MediaStreams: [{ Type: "Video", Codec: "h264", Index: 0 }],
        MediaSources: [{ Id: "123", Container: "mov,mp4,m4a,3gp,3g2,mj2" }],
      } as any;

      expect(needsTranscoding(videoItem)).toBe(false);
    });

    it("should return true for comma-separated container with no supported token", () => {
      const videoItem: JellyfinVideoItem = {
        Id: "123",
        Name: "Test Video",
        MediaStreams: [{ Type: "Video", Codec: "hevc", Index: 0 }],
        MediaSources: [{ Id: "123", Container: "mkv,webm" }],
      } as any;

      expect(needsTranscoding(videoItem)).toBe(true);
    });

    it("should return false for supported codec with no container info", () => {
      const videoItem: JellyfinVideoItem = {
        Id: "123",
        Name: "Test Video",
        MediaStreams: [{ Type: "Video", Codec: "h264", Index: 0 }],
      } as any;

      expect(needsTranscoding(videoItem)).toBe(false);
    });
  });

  describe("isAudioOnly", () => {
    it("should return true for audio-only files", () => {
      const audioItem: JellyfinVideoItem = {
        Id: "123",
        Name: "Audio File",
        MediaStreams: [{ Type: "Audio", Codec: "aac", Index: 0 }],
      } as any;

      expect(isAudioOnly(audioItem)).toBe(true);
    });

    it("should return false for video files", () => {
      const videoItem: JellyfinVideoItem = {
        Id: "123",
        Name: "Video File",
        MediaStreams: [
          { Type: "Video", Codec: "h264", Index: 0 },
          { Type: "Audio", Codec: "aac", Index: 1 },
        ],
      } as any;

      expect(isAudioOnly(videoItem)).toBe(false);
    });

    it("should return false for null item", () => {
      expect(isAudioOnly(null)).toBe(false);
    });
  });

  describe("formatDuration", () => {
    it("should format hours and minutes", () => {
      const ticks = 54000000000; // 90 minutes = 1h 30m
      expect(formatDuration(ticks)).toBe("1h 30m");
    });

    it("should format minutes only", () => {
      const ticks = 27000000000; // 45 minutes
      expect(formatDuration(ticks)).toBe("45m");
    });

    it("should handle zero minutes", () => {
      const ticks = 36000000000; // 60 minutes = 1h 0m
      expect(formatDuration(ticks)).toBe("1h 0m");
    });

    it("should handle less than a minute", () => {
      const ticks = 300000000; // 30 seconds
      expect(formatDuration(ticks)).toBe("0m");
    });
  });

  describe("hasPoster", () => {
    it("should return true when poster exists", () => {
      const item: JellyfinVideoItem = {
        Id: "123",
        Name: "Test",
        ImageTags: { Primary: "abc123" },
      } as any;

      expect(hasPoster(item)).toBe(true);
    });

    it("should return false when no poster exists", () => {
      const item: JellyfinVideoItem = {
        Id: "123",
        Name: "Test",
        ImageTags: {},
      } as any;

      expect(hasPoster(item)).toBe(false);
    });

    it("should return false when ImageTags is undefined", () => {
      const item: JellyfinVideoItem = {
        Id: "123",
        Name: "Test",
      } as any;

      expect(hasPoster(item)).toBe(false);
    });
  });

  describe("searchVideos pagination", () => {
    const mockSecureStore = require("expo-secure-store");

    beforeEach(() => {
      // Mock fetch globally
      global.fetch = jest.fn();

      // Mock SecureStore to return valid config (new format with SERVER_URL)
      mockSecureStore.getItemAsync.mockImplementation((key: string) => {
        const mockConfig: Record<string, string> = {
          jellyfin_server_url: "http://192.168.1.100:8096",
          jellyfin_api_key: "test-api-key",
          jellyfin_user_id: "test-user-id",
          jellyfin_device_id: "test-device-id",
        };
        return Promise.resolve(mockConfig[key] || null);
      });
    });

    afterEach(() => {
      jest.restoreAllMocks();
    });

    it("should return empty array for empty search term", async () => {
      const result = await searchVideos("");
      expect(result).toEqual({ items: [], total: 0 });
    });

    it("should return empty array for whitespace-only search term", async () => {
      const result = await searchVideos("   ");
      expect(result).toEqual({ items: [], total: 0 });
    });

    it("should call API with correct pagination parameters", async () => {
      const mockResponse = {
        Items: [
          { Id: "1", Name: "Video 1", Type: "Movie" },
          { Id: "2", Name: "Video 2", Type: "Movie" },
        ],
        TotalRecordCount: 100,
        StartIndex: 0,
      };

      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      });

      const result = await searchVideos("test", { limit: 20, startIndex: 0 });

      expect(global.fetch).toHaveBeenCalledWith(expect.stringContaining("SearchTerm=test"), expect.any(Object));
      expect(global.fetch).toHaveBeenCalledWith(expect.stringContaining("Limit=20"), expect.any(Object));
      expect(global.fetch).toHaveBeenCalledWith(expect.stringContaining("StartIndex=0"), expect.any(Object));
      expect(result.items).toHaveLength(2);
      // Total preserves server's TotalRecordCount for proper pagination
      expect(result.total).toBe(100);
    });

    it("should handle pagination with custom startIndex", async () => {
      const mockResponse = {
        Items: [
          { Id: "21", Name: "Video 21", Type: "Movie" },
          { Id: "22", Name: "Video 22", Type: "Movie" },
        ],
        TotalRecordCount: 100,
        StartIndex: 20,
      };

      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      });

      const result = await searchVideos("test", { limit: 20, startIndex: 20 });

      expect(global.fetch).toHaveBeenCalledWith(expect.stringContaining("StartIndex=20"), expect.any(Object));
      expect(result.items).toHaveLength(2);
      // Total preserves server's TotalRecordCount for proper pagination
      expect(result.total).toBe(100);
    });

    it("should use default pagination values when not specified", async () => {
      const mockResponse = {
        Items: [],
        TotalRecordCount: 0,
        StartIndex: 0,
      };

      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      });

      await searchVideos("test");

      expect(global.fetch).toHaveBeenCalledWith(expect.stringContaining("Limit=60"), expect.any(Object));
      expect(global.fetch).toHaveBeenCalledWith(expect.stringContaining("StartIndex=0"), expect.any(Object));
    });

    it("should return correct structure with items and total", async () => {
      const mockResponse = {
        Items: [
          { Id: "1", Name: "Video 1", Type: "Movie" },
          { Id: "2", Name: "Video 2", Type: "Movie" },
          { Id: "3", Name: "Video 3", Type: "Movie" },
        ],
        TotalRecordCount: 150,
      };

      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      });

      const result = await searchVideos("action", { limit: 3, startIndex: 0 });

      // Total preserves server's TotalRecordCount for proper pagination
      expect(result).toEqual({
        items: mockResponse.Items,
        total: 150,
      });
    });

    it("should handle response without TotalRecordCount", async () => {
      const mockResponse = {
        Items: [{ Id: "1", Name: "Video 1", Type: "Movie" }],
        // TotalRecordCount is optional in the API
      };

      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      });

      const result = await searchVideos("test");

      expect(result.items).toHaveLength(1);
      // Total now reflects actual items returned
      expect(result.total).toBe(1);
    });

    it("should trim search term before sending to API", async () => {
      const mockResponse = {
        Items: [],
        TotalRecordCount: 0,
      };

      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      });

      await searchVideos("  test query  ");

      // URLSearchParams encodes spaces as '+' which is valid
      const callUrl = (global.fetch as jest.Mock).mock.calls[0][0] as string;
      expect(callUrl).toMatch(/SearchTerm=test(\+|%20)query/);
    });

    it("should handle empty results correctly", async () => {
      const mockResponse = {
        Items: [],
        TotalRecordCount: 0,
      };

      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      });

      const result = await searchVideos("nonexistent");

      expect(result.items).toEqual([]);
      expect(result.total).toBe(0);
    });

    it("should handle last page of results correctly", async () => {
      const mockResponse = {
        Items: [
          { Id: "96", Name: "Video 96", Type: "Movie" },
          { Id: "97", Name: "Video 97", Type: "Movie" },
        ],
        TotalRecordCount: 97,
        StartIndex: 95,
      };

      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      });

      const result = await searchVideos("test", { limit: 60, startIndex: 95 });

      expect(result.items).toHaveLength(2);
      // Total preserves server's TotalRecordCount for proper pagination
      expect(result.total).toBe(97);
    });
  });

  describe("fetchPlaylistContents", () => {
    const mockSecureStore = require("expo-secure-store");

    beforeEach(() => {
      // Mock fetch globally
      global.fetch = jest.fn();

      // Mock SecureStore to return valid config
      mockSecureStore.getItemAsync.mockImplementation((key: string) => {
        const mockConfig: Record<string, string> = {
          jellyfin_server_url: "http://192.168.1.100:8096",
          jellyfin_api_key: "test-api-key",
          jellyfin_user_id: "test-user-id",
          jellyfin_device_id: "test-device-id",
        };
        return Promise.resolve(mockConfig[key] || null);
      });
    });

    afterEach(() => {
      jest.restoreAllMocks();
    });

    it("should fetch playlist contents successfully", async () => {
      const mockResponse = {
        Items: [
          { Id: "1", Name: "Video 1", Type: "Movie" },
          { Id: "2", Name: "Video 2", Type: "Episode" },
        ],
        TotalRecordCount: 2,
        StartIndex: 0,
      };

      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      });

      const result = await fetchPlaylistContents("playlist-123");

      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining("/Playlists/playlist-123/Items"),
        expect.objectContaining({
          method: "GET",
          headers: expect.objectContaining({
            Accept: "application/json",
            Authorization: 'MediaBrowser Client="TomoTV", Device="iOS", DeviceId="test-device-id", Version="9.9.9", Token="test-api-key"',
          }),
        }),
      );
      expect(result.items).toHaveLength(2);
      expect(result.total).toBe(2);
    });

    it("should call API with correct pagination parameters", async () => {
      const mockResponse = {
        Items: [{ Id: "1", Name: "Video 1", Type: "Movie" }],
        TotalRecordCount: 100,
        StartIndex: 20,
      };

      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      });

      const result = await fetchPlaylistContents("playlist-456", { limit: 30, startIndex: 20 });

      expect(global.fetch).toHaveBeenCalledWith(expect.stringContaining("Limit=30"), expect.any(Object));
      expect(global.fetch).toHaveBeenCalledWith(expect.stringContaining("StartIndex=20"), expect.any(Object));
      expect(result.items).toHaveLength(1);
      expect(result.total).toBe(100);
    });

    it("should use default pagination values when not specified", async () => {
      const mockResponse = {
        Items: [],
        TotalRecordCount: 0,
        StartIndex: 0,
      };

      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      });

      await fetchPlaylistContents("playlist-789");

      expect(global.fetch).toHaveBeenCalledWith(expect.stringContaining("Limit=60"), expect.any(Object));
      expect(global.fetch).toHaveBeenCalledWith(expect.stringContaining("StartIndex=0"), expect.any(Object));
    });

    it("should handle response without TotalRecordCount", async () => {
      const mockResponse = {
        Items: [{ Id: "1", Name: "Video 1", Type: "Movie" }],
        StartIndex: 0,
        // TotalRecordCount is optional in the API
      };

      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      });

      const result = await fetchPlaylistContents("playlist-abc");

      expect(result.items).toHaveLength(1);
      expect(result.total).toBeUndefined();
    });

    it("should handle empty playlist", async () => {
      const mockResponse = {
        Items: [],
        TotalRecordCount: 0,
        StartIndex: 0,
      };

      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      });

      const result = await fetchPlaylistContents("empty-playlist");

      expect(result.items).toEqual([]);
      expect(result.total).toBe(0);
    });

    it("should throw error when server is not configured", async () => {
      mockSecureStore.getItemAsync.mockResolvedValue(null);

      await expect(fetchPlaylistContents("playlist-123")).rejects.toThrow("Jellyfin server not configured.");
    });

    it("should throw error on HTTP error response", async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: false,
        status: 404,
      });

      await expect(fetchPlaylistContents("nonexistent-playlist")).rejects.toThrow("Failed to fetch playlist contents: 404");
    });

    it("should throw error on network failure", async () => {
      (global.fetch as jest.Mock).mockRejectedValueOnce(new Error("Network error"));

      await expect(fetchPlaylistContents("playlist-123")).rejects.toThrow();
    });

    it("should retry on network failure", async () => {
      // First attempt fails with network error (retryable), second succeeds
      (global.fetch as jest.Mock).mockRejectedValueOnce(new Error("Network request failed")).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          Items: [{ Id: "1", Name: "Video 1", Type: "Movie" }],
          TotalRecordCount: 1,
          StartIndex: 0,
        }),
      });

      const result = await fetchPlaylistContents("playlist-retry");

      expect(global.fetch).toHaveBeenCalledTimes(2);
      expect(result.items).toHaveLength(1);
    });

    it("should fail after max retry attempts", async () => {
      // All attempts fail with network error (retryable)
      (global.fetch as jest.Mock).mockRejectedValueOnce(new Error("Network error")).mockRejectedValueOnce(new Error("Network error")).mockRejectedValueOnce(new Error("Network error"));

      await expect(fetchPlaylistContents("playlist-fail")).rejects.toThrow("Network error");
      expect(global.fetch).toHaveBeenCalledTimes(3);
    });

    it("should include correct query parameters", async () => {
      const mockResponse = {
        Items: [],
        TotalRecordCount: 0,
        StartIndex: 0,
      };

      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      });

      await fetchPlaylistContents("playlist-xyz", { limit: 10, startIndex: 5 });

      const callUrl = (global.fetch as jest.Mock).mock.calls[0][0] as string;
      expect(callUrl).toContain("userId=test-user-id");
      expect(callUrl).toContain("StartIndex=5");
      expect(callUrl).toContain("Limit=10");
      // Fields parameter is URL-encoded
      expect(decodeURIComponent(callUrl)).toContain("Fields=Path,MediaStreams,Genres,ChildCount,RecursiveItemCount,ParentId,ImageTags,PrimaryImageAspectRatio");
    });

    it("should not retry on HTTP error responses", async () => {
      // HTTP errors are not retryable, so fetch should only be called once
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: false,
        status: 404,
      });

      await expect(fetchPlaylistContents("playlist-404")).rejects.toThrow("Failed to fetch playlist contents: 404");
      expect(global.fetch).toHaveBeenCalledTimes(1);
    });
  });

  describe("request caching", () => {
    const mockSecureStore = require("expo-secure-store");

    beforeEach(() => {
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
    });

    afterEach(() => {
      jest.restoreAllMocks();
    });

    it("serves a repeated identical read from cache without a second request", async () => {
      // Only one fetch is queued: a second network call would resolve to undefined and throw,
      // so the read succeeding twice proves the second came from cache.
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => ({ Items: [{ Id: "1", Name: "V", Type: "Movie" }], TotalRecordCount: 1 }),
      });

      const first = await fetchPlaylistContents("pl-cache");
      const second = await fetchPlaylistContents("pl-cache");

      expect(first.items).toHaveLength(1);
      expect(second.items).toHaveLength(1);
      expect(global.fetch).toHaveBeenCalledTimes(1);
    });

    it("refetches a folder listing after a favorite toggle invalidates the cache", async () => {
      const folderPage = () => ({
        ok: true,
        json: async () => ({ Items: [{ Id: "a", Name: "A", Type: "Movie" }], TotalRecordCount: 1 }),
      });
      (global.fetch as jest.Mock)
        .mockResolvedValueOnce(folderPage()) // initial folder fetch
        .mockResolvedValueOnce({ ok: true, json: async () => ({}) }) // favorite POST
        .mockResolvedValueOnce(folderPage()); // folder refetch after invalidation

      await fetchFolderContents("folder-1");
      await fetchFolderContents("folder-1"); // served from cache — no new request
      await setVideoFavorite("a", true); // invalidates cached folder reads
      await fetchFolderContents("folder-1"); // cache dropped — refetches

      const folderCalls = (global.fetch as jest.Mock).mock.calls.filter((call) => String(call[0]).includes("ParentId=folder-1"));
      expect(folderCalls).toHaveLength(2);
    });
  });

  describe("Demo Server Functions", () => {
    const mockSecureStore = require("expo-secure-store");

    beforeEach(() => {
      jest.clearAllMocks();
      global.fetch = jest.fn();
    });

    afterEach(() => {
      jest.restoreAllMocks();
    });

    describe("connectToDemoServer", () => {
      it("should connect successfully with valid credentials", async () => {
        // Mock successful authentication
        (global.fetch as jest.Mock)
          .mockResolvedValueOnce({
            ok: true,
            headers: new Headers({ "content-type": "application/json" }),
            json: async () => ({
              AccessToken: "demo-api-key-123",
              User: { Id: "demo-user-id-456" },
            }),
          })
          // Mock successful validation call
          .mockResolvedValueOnce({
            ok: true,
            json: async () => ({ Items: [] }),
          });

        // Mock SecureStore operations
        mockSecureStore.setItemAsync.mockResolvedValue(undefined);
        mockSecureStore.getItemAsync.mockImplementation((key: string) => {
          if (key === "jellyfin_server_url") return Promise.resolve("https://demo.jellyfin.org/stable");
          if (key === "jellyfin_api_key") return Promise.resolve("demo-api-key-123");
          if (key === "jellyfin_user_id") return Promise.resolve("demo-user-id-456");
          return Promise.resolve(null);
        });

        await connectToDemoServer();

        // Verify authentication call
        expect(global.fetch).toHaveBeenCalledWith(
          "https://demo.jellyfin.org/stable/Users/AuthenticateByName",
          expect.objectContaining({
            method: "POST",
            headers: expect.objectContaining({
              "Content-Type": "application/json",
            }),
            body: expect.stringContaining('"Username":"demo"'),
          }),
        );

        // Verify credentials were saved (3 credentials + demo flag)
        expect(mockSecureStore.setItemAsync).toHaveBeenCalledWith("jellyfin_server_url", "https://demo.jellyfin.org/stable");
        expect(mockSecureStore.setItemAsync).toHaveBeenCalledWith("jellyfin_api_key", "demo-api-key-123");
        expect(mockSecureStore.setItemAsync).toHaveBeenCalledWith("jellyfin_user_id", "demo-user-id-456");
        expect(mockSecureStore.setItemAsync).toHaveBeenCalledWith("jellyfin_is_demo_mode", "true");

        // Note: Cache clearing is wrapped in try-catch and uses dynamic imports,
        // so we don't assert on it in unit tests
      });

      it("should handle network timeout during authentication", async () => {
        // Mock timeout error
        (global.fetch as jest.Mock).mockImplementation(() => {
          return new Promise((_, reject) => {
            const error = new Error("Aborted");
            error.name = "AbortError";
            reject(error);
          });
        });

        await expect(connectToDemoServer()).rejects.toThrow("Demo server connection timed out");
      });

      it("should handle demo server unavailable (503)", async () => {
        // Mock 503 for stable server (2 retry attempts)
        (global.fetch as jest.Mock).mockResolvedValueOnce({ ok: false, status: 503 }).mockResolvedValueOnce({ ok: false, status: 503 });

        await expect(connectToDemoServer()).rejects.toThrow("Demo server is temporarily unavailable");
      });

      it("should handle demo server error (502)", async () => {
        // Mock 502 for stable server (2 retry attempts)
        (global.fetch as jest.Mock).mockResolvedValueOnce({ ok: false, status: 502 }).mockResolvedValueOnce({ ok: false, status: 502 });

        await expect(connectToDemoServer()).rejects.toThrow("Demo server is temporarily unavailable");
      });

      it("should handle invalid credentials (401)", async () => {
        // Mock 401 for stable server (no retry on 401)
        (global.fetch as jest.Mock).mockResolvedValueOnce({ ok: false, status: 401 });

        await expect(connectToDemoServer()).rejects.toThrow("Demo credentials are invalid");
      });

      it("should handle invalid response format (non-JSON)", async () => {
        // Mock invalid response for stable server (no retry on invalid response)
        (global.fetch as jest.Mock).mockResolvedValueOnce({
          ok: true,
          headers: new Headers({ "content-type": "text/html" }),
          json: async () => {
            throw new Error("Invalid JSON");
          },
        });

        await expect(connectToDemoServer()).rejects.toThrow("Demo server returned invalid response format");
      });

      it("should handle missing credentials in response", async () => {
        // Mock missing credentials for stable server (no retry)
        (global.fetch as jest.Mock).mockResolvedValueOnce({
          ok: true,
          headers: new Headers({ "content-type": "application/json" }),
          json: async () => ({
            // Missing AccessToken and User.Id
          }),
        });

        await expect(connectToDemoServer()).rejects.toThrow("Invalid demo server response: missing credentials");
      });

      it("should rollback credentials on save failure", async () => {
        (global.fetch as jest.Mock).mockResolvedValueOnce({
          ok: true,
          headers: new Headers({ "content-type": "application/json" }),
          json: async () => ({
            AccessToken: "demo-api-key-123",
            User: { Id: "demo-user-id-456" },
          }),
        });

        // Mock save success but verification failure
        mockSecureStore.setItemAsync.mockResolvedValue(undefined);
        mockSecureStore.getItemAsync.mockResolvedValue(null); // Verification fails

        await expect(connectToDemoServer()).rejects.toThrow("Failed to save demo credentials");

        // Verify rollback was attempted
        expect(mockSecureStore.deleteItemAsync).toHaveBeenCalledWith("jellyfin_server_url");
        expect(mockSecureStore.deleteItemAsync).toHaveBeenCalledWith("jellyfin_api_key");
        expect(mockSecureStore.deleteItemAsync).toHaveBeenCalledWith("jellyfin_user_id");
      });

      it("should rollback credentials on validation failure", async () => {
        (global.fetch as jest.Mock)
          .mockResolvedValueOnce({
            ok: true,
            headers: new Headers({ "content-type": "application/json" }),
            json: async () => ({
              AccessToken: "demo-api-key-123",
              User: { Id: "demo-user-id-456" },
            }),
          })
          // Mock validation failure
          .mockResolvedValueOnce({
            ok: false,
            status: 401,
          });

        mockSecureStore.setItemAsync.mockResolvedValue(undefined);
        mockSecureStore.getItemAsync.mockImplementation((key: string) => {
          if (key === "jellyfin_server_url") return Promise.resolve("https://demo.jellyfin.org/stable");
          if (key === "jellyfin_api_key") return Promise.resolve("demo-api-key-123");
          if (key === "jellyfin_user_id") return Promise.resolve("demo-user-id-456");
          return Promise.resolve(null);
        });

        await expect(connectToDemoServer()).rejects.toThrow("Demo credentials are invalid");

        // Verify rollback
        expect(mockSecureStore.deleteItemAsync).toHaveBeenCalledWith("jellyfin_server_url");
        expect(mockSecureStore.deleteItemAsync).toHaveBeenCalledWith("jellyfin_api_key");
        expect(mockSecureStore.deleteItemAsync).toHaveBeenCalledWith("jellyfin_user_id");
      });

      it("should retry on network failure", async () => {
        // First attempt fails, second succeeds
        (global.fetch as jest.Mock)
          .mockRejectedValueOnce(new Error("Network error"))
          .mockResolvedValueOnce({
            ok: true,
            headers: new Headers({ "content-type": "application/json" }),
            json: async () => ({
              AccessToken: "demo-api-key-123",
              User: { Id: "demo-user-id-456" },
            }),
          })
          .mockResolvedValueOnce({
            ok: true,
            json: async () => ({ Items: [] }),
          })
          .mockResolvedValueOnce({
            ok: true,
            json: async () => ({ ServerName: "Demo Server" }),
          });

        mockSecureStore.setItemAsync.mockResolvedValue(undefined);
        mockSecureStore.getItemAsync.mockImplementation((key: string) => {
          if (key === "jellyfin_server_url") return Promise.resolve("https://demo.jellyfin.org/stable");
          if (key === "jellyfin_api_key") return Promise.resolve("demo-api-key-123");
          if (key === "jellyfin_user_id") return Promise.resolve("demo-user-id-456");
          return Promise.resolve(null);
        });

        await connectToDemoServer();

        // Verify retry occurred (2 auth calls + 1 validation + 1 server info = 4)
        expect(global.fetch).toHaveBeenCalledTimes(4);
      });

      it("should fail after max retry attempts", async () => {
        // All attempts fail for stable server (2 retry attempts)
        (global.fetch as jest.Mock).mockRejectedValueOnce(new Error("Network error")).mockRejectedValueOnce(new Error("Network error"));

        await expect(connectToDemoServer()).rejects.toThrow();

        // Verify max retries (2 attempts for stable server)
        expect(global.fetch).toHaveBeenCalledTimes(2);
      });

      it("should not mark demo mode active before validation succeeds", async () => {
        (global.fetch as jest.Mock)
          .mockResolvedValueOnce({
            ok: true,
            headers: new Headers({ "content-type": "application/json" }),
            json: async () => ({
              AccessToken: "demo-api-key-123",
              User: { Id: "demo-user-id-456" },
            }),
          })
          .mockResolvedValueOnce({
            ok: false,
            status: 401,
          });

        mockSecureStore.setItemAsync.mockResolvedValue(undefined);
        mockSecureStore.getItemAsync.mockImplementation((key: string) => {
          if (key === "jellyfin_server_url") return Promise.resolve("https://demo.jellyfin.org/stable");
          if (key === "jellyfin_api_key") return Promise.resolve("demo-api-key-123");
          if (key === "jellyfin_user_id") return Promise.resolve("demo-user-id-456");
          return Promise.resolve(null);
        });

        await expect(connectToDemoServer()).rejects.toThrow();

        // Verify demo mode flag was never set
        const demoModeCalls = (mockSecureStore.setItemAsync as jest.Mock).mock.calls.filter((call) => call[0] === "jellyfin_is_demo_mode");
        expect(demoModeCalls).toHaveLength(0);
      });
    });

    describe("isDemoMode", () => {
      it("should return true when demo mode is active", async () => {
        mockSecureStore.getItemAsync.mockResolvedValue("true");

        const result = await isDemoMode();

        expect(result).toBe(true);
        expect(mockSecureStore.getItemAsync).toHaveBeenCalledWith("jellyfin_is_demo_mode");
      });

      it("should return false when demo mode is inactive", async () => {
        mockSecureStore.getItemAsync.mockResolvedValue(null);

        const result = await isDemoMode();

        expect(result).toBe(false);
      });

      it("should return false when demo mode flag is not 'true'", async () => {
        mockSecureStore.getItemAsync.mockResolvedValue("false");

        const result = await isDemoMode();

        expect(result).toBe(false);
      });

      it("should return false on error", async () => {
        mockSecureStore.getItemAsync.mockRejectedValue(new Error("Storage error"));

        const result = await isDemoMode();

        expect(result).toBe(false);
      });
    });

    describe("disconnectFromDemo", () => {
      beforeEach(() => {
        // Mock getItemAsync for refreshConfig/getConfig calls
        mockSecureStore.getItemAsync.mockImplementation(async () => {
          // Return null for all keys to simulate cleared state
          return null;
        });
      });

      it("should clear all credentials and demo flag", async () => {
        mockSecureStore.deleteItemAsync.mockResolvedValue(undefined);

        await disconnectFromDemo();

        expect(mockSecureStore.deleteItemAsync).toHaveBeenCalledWith("jellyfin_server_url");
        expect(mockSecureStore.deleteItemAsync).toHaveBeenCalledWith("jellyfin_api_key");
        expect(mockSecureStore.deleteItemAsync).toHaveBeenCalledWith("jellyfin_user_id");
        expect(mockSecureStore.deleteItemAsync).toHaveBeenCalledWith("jellyfin_is_demo_mode");
      });

      it("should complete successfully", async () => {
        mockSecureStore.deleteItemAsync.mockResolvedValue(undefined);

        // Should complete without throwing
        await expect(disconnectFromDemo()).resolves.toBeUndefined();
      });

      it("should throw error on SecureStore failure", async () => {
        mockSecureStore.deleteItemAsync.mockRejectedValue(new Error("Delete failed"));

        await expect(disconnectFromDemo()).rejects.toThrow("Failed to disconnect from demo server");
      });
    });
  });

  describe("URL generation", () => {
    const mockSecureStore = require("expo-secure-store");
    const mockConfig = {
      jellyfin_server_url: "http://192.168.1.100:8096",
      jellyfin_api_key: "test-api-key",
      jellyfin_user_id: "test-user-id",
    };

    beforeEach(async () => {
      jest.clearAllMocks();
      mockSecureStore.getItemAsync.mockImplementation((key: string) => Promise.resolve(mockConfig[key as keyof typeof mockConfig] || null));
      // Need to call refreshConfig to populate cachedConfig
      await refreshConfig();
    });

    describe("getVideoStreamUrl", () => {
      it("should generate direct play URL with Static=true and MediaSourceId", () => {
        const url = getVideoStreamUrl("video123");

        expect(url).toBe("http://192.168.1.100:8096/Videos/video123/stream?Static=true&MediaSourceId=video123&api_key=test-api-key");
        expect(url).toContain("/Videos/video123/stream");
        expect(url).toContain("Static=true");
        expect(url).toContain("api_key=test-api-key");
      });

      it("should use MediaSourceId from videoItem when provided", () => {
        const videoItem = {
          Id: "video123",
          Name: "Test",
          MediaSources: [{ Id: "media-source-456" }],
        } as any;
        const url = getVideoStreamUrl("video123", videoItem);

        expect(url).toContain("MediaSourceId=media-source-456");
      });

      it("should handle HTTPS server URLs", async () => {
        mockSecureStore.getItemAsync.mockImplementation((key: string) => {
          if (key === "jellyfin_server_url") return Promise.resolve("https://jellyfin.example.com");
          return Promise.resolve(mockConfig[key as keyof typeof mockConfig] || null);
        });

        await refreshConfig();
        const url = getVideoStreamUrl("video123");

        expect(url).toContain("https://jellyfin.example.com");
        expect(url).toContain("/Videos/video123/stream");
      });
    });

    describe("getTranscodingStreamUrl", () => {
      it("should generate HLS master.m3u8 URL with quality settings", async () => {
        // Mock quality settings - use index 3 for 1080p
        mockSecureStore.getItemAsync.mockImplementation((key: string) => {
          if (key === "app_video_quality") return Promise.resolve("3"); // 1080p index
          return Promise.resolve(mockConfig[key as keyof typeof mockConfig] || null);
        });

        await refreshConfig();
        const url = await getTranscodingStreamUrl("video123");

        expect(url).toContain("/Videos/video123/master.m3u8");
        expect(url).toContain("VideoCodec=h264");
        expect(url).toContain("AudioCodec=aac");
        expect(url).toContain("MaxWidth=1920");
        expect(url).toContain("MaxHeight=1080");
        expect(url).toContain("VideoBitrate=8000000");
        expect(url).toContain("VideoLevel=41");
        expect(url).toContain("api_key=test-api-key");
      });

      it("should generate 4K transcoding URL with level 5.1", async () => {
        // Mock quality settings - use index 4 for 4K
        mockSecureStore.getItemAsync.mockImplementation((key: string) => {
          if (key === "app_video_quality") return Promise.resolve("4"); // 4K index
          return Promise.resolve(mockConfig[key as keyof typeof mockConfig] || null);
        });

        await refreshConfig();
        const url = await getTranscodingStreamUrl("video123");

        expect(url).toContain("MaxWidth=3840");
        expect(url).toContain("MaxHeight=2160");
        expect(url).toContain("VideoBitrate=20000000");
        expect(url).toContain("VideoLevel=51");
      });

      it("should fallback to 480p defaults for out-of-bounds quality index", async () => {
        mockSecureStore.getItemAsync.mockImplementation((key: string) => {
          if (key === "app_video_quality") return Promise.resolve("99"); // Out of bounds
          return Promise.resolve(mockConfig[key as keyof typeof mockConfig] || null);
        });

        await refreshConfig();
        const url = await getTranscodingStreamUrl("video123");

        expect(url).toContain("MaxWidth=854");
        expect(url).toContain("MaxHeight=480");
        expect(url).toContain("VideoBitrate=1500000");
        expect(url).toContain("VideoLevel=41");
      });

      it("should fallback to 480p defaults for corrupted quality value", async () => {
        mockSecureStore.getItemAsync.mockImplementation((key: string) => {
          if (key === "app_video_quality") return Promise.resolve("abc"); // NaN after parseInt
          return Promise.resolve(mockConfig[key as keyof typeof mockConfig] || null);
        });

        await refreshConfig();
        const url = await getTranscodingStreamUrl("video123");

        expect(url).toContain("MaxWidth=854");
        expect(url).toContain("MaxHeight=480");
        expect(url).toContain("VideoBitrate=1500000");
        expect(url).toContain("VideoLevel=41");
      });

      it("should use MediaSourceId from videoItem when available", async () => {
        const videoItem: any = {
          Id: "video123",
          MediaSources: [{ Id: "source-456" }],
        };

        const url = await getTranscodingStreamUrl("video123", videoItem);

        expect(url).toContain("MediaSourceId=source-456");
      });

      it("should use SubtitleMethod=Hls for external subtitles", async () => {
        const videoItem: any = {
          Id: "video123",
          MediaStreams: [
            { Type: "Video", Codec: "h264", Index: 0 },
            { Type: "Subtitle", IsExternal: true, Index: 2, Language: "eng" },
            { Type: "Subtitle", IsExternal: true, Index: 3, Language: "spa" },
          ],
        };

        const url = await getTranscodingStreamUrl("video123", videoItem);

        expect(url).toContain("SubtitleMethod=Hls");
        expect(url).not.toContain("SubtitleStreamIndex=");
      });

      it("should not add subtitle params when no external subtitles", async () => {
        const videoItem: any = {
          Id: "video123",
          MediaStreams: [
            { Type: "Video", Codec: "h264", Index: 0 },
            { Type: "Audio", Codec: "aac", Index: 1 },
          ],
        };

        const url = await getTranscodingStreamUrl("video123", videoItem);

        expect(url).not.toContain("SubtitleStreamIndex");
        expect(url).not.toContain("SubtitleMethod");
      });

      it("should append StartTimeTicks when provided", async () => {
        const url = await getTranscodingStreamUrl("video123", null, undefined, 3000000000);

        expect(url).toContain("StartTimeTicks=3000000000");
      });

      it("should omit StartTimeTicks when not provided", async () => {
        const url = await getTranscodingStreamUrl("video123");

        expect(url).not.toContain("StartTimeTicks");
      });

      it("should omit StartTimeTicks when 0", async () => {
        const url = await getTranscodingStreamUrl("video123", null, undefined, 0);

        expect(url).not.toContain("StartTimeTicks");
      });

      it("should use SubtitleMethod=Encode with SubtitleStreamIndex when burn-in index provided", async () => {
        const videoItem: any = {
          Id: "video123",
          MediaStreams: [
            { Type: "Video", Codec: "h264", Index: 0 },
            { Type: "Subtitle", Codec: "pgssub", IsExternal: false, Index: 2, Language: "eng" },
          ],
        };

        const url = await getTranscodingStreamUrl("video123", videoItem, undefined, undefined, 2);

        expect(url).toContain("SubtitleStreamIndex=2");
        expect(url).toContain("SubtitleMethod=Encode");
        expect(url).not.toContain("SubtitleMethod=Hls");
      });

      it("should keep SubtitleMethod=Hls when no burn-in index provided", async () => {
        const videoItem: any = {
          Id: "video123",
          MediaStreams: [
            { Type: "Video", Codec: "h264", Index: 0 },
            { Type: "Subtitle", Codec: "subrip", IsExternal: true, Index: 2, Language: "eng" },
          ],
        };

        const url = await getTranscodingStreamUrl("video123", videoItem);

        expect(url).toContain("SubtitleMethod=Hls");
        expect(url).not.toContain("SubtitleMethod=Encode");
        expect(url).not.toContain("SubtitleStreamIndex=");
      });

      it("should combine burn-in with AudioStreamIndex and StartTimeTicks", async () => {
        const videoItem: any = {
          Id: "video123",
          MediaStreams: [
            { Type: "Video", Codec: "h264", Index: 0 },
            { Type: "Subtitle", Codec: "pgssub", IsExternal: false, Index: 3, Language: "eng" },
          ],
        };

        const url = await getTranscodingStreamUrl("video123", videoItem, 1, 3000000000, 3);

        expect(url).toContain("SubtitleStreamIndex=3");
        expect(url).toContain("SubtitleMethod=Encode");
        expect(url).toContain("AudioStreamIndex=1");
        expect(url).toContain("StartTimeTicks=3000000000");
      });
    });

    describe("getBurnInSubtitlesSetting", () => {
      it("should default to true when nothing is stored", async () => {
        mockSecureStore.getItemAsync.mockResolvedValue(null);

        await expect(getBurnInSubtitlesSetting()).resolves.toBe(true);
      });

      it("should return false when disabled", async () => {
        mockSecureStore.getItemAsync.mockImplementation((key: string) => {
          if (key === "app_burn_in_image_subtitles") return Promise.resolve("false");
          return Promise.resolve(mockConfig[key as keyof typeof mockConfig] || null);
        });

        await expect(getBurnInSubtitlesSetting()).resolves.toBe(false);
      });

      it("should return true when enabled", async () => {
        mockSecureStore.getItemAsync.mockImplementation((key: string) => {
          if (key === "app_burn_in_image_subtitles") return Promise.resolve("true");
          return Promise.resolve(mockConfig[key as keyof typeof mockConfig] || null);
        });

        await expect(getBurnInSubtitlesSetting()).resolves.toBe(true);
      });
    });

    describe("getSubtitleTracks", () => {
      it("should return empty array when no MediaStreams", () => {
        const videoItem = { MediaStreams: undefined } as any;
        expect(getSubtitleTracks(videoItem)).toEqual([]);
      });

      it("should return empty array when videoItem is null", () => {
        expect(getSubtitleTracks(null)).toEqual([]);
      });

      it("should extract external subtitle tracks from MediaStreams", () => {
        const videoItem = {
          Id: "video123",
          MediaStreams: [
            { Type: "Video", Codec: "h264" },
            { Type: "Subtitle", IsExternal: true, Index: 0, Language: "eng", DisplayTitle: "English" },
            { Type: "Subtitle", IsExternal: true, Index: 1, Language: "spa", DisplayTitle: "Spanish" },
            { Type: "Subtitle", IsExternal: false, Index: 2, Language: "fra" }, // Embedded subtitle
          ],
        } as any;

        const tracks = getSubtitleTracks(videoItem);
        expect(tracks).toHaveLength(2);
        expect(tracks[0]).toMatchObject({
          language: "eng",
          label: "English",
          type: "text/vtt",
        });
        expect(tracks[1]).toMatchObject({
          language: "spa",
          label: "Spanish",
          type: "text/vtt",
        });
      });
    });

    describe("isImageBasedSubtitleCodec", () => {
      it("should detect image-based subtitle codecs", () => {
        expect(isImageBasedSubtitleCodec("pgssub")).toBe(true);
        expect(isImageBasedSubtitleCodec("PGSSUB")).toBe(true);
        expect(isImageBasedSubtitleCodec("hdmv_pgs_subtitle")).toBe(true);
        expect(isImageBasedSubtitleCodec("dvdsub")).toBe(true);
        expect(isImageBasedSubtitleCodec("dvd_subtitle")).toBe(true);
        expect(isImageBasedSubtitleCodec("vobsub")).toBe(true);
        expect(isImageBasedSubtitleCodec("dvbsub")).toBe(true);
        expect(isImageBasedSubtitleCodec("dvb_subtitle")).toBe(true);
        expect(isImageBasedSubtitleCodec("xsub")).toBe(true);
        expect(isImageBasedSubtitleCodec("sup")).toBe(true);
        expect(isImageBasedSubtitleCodec("sub")).toBe(true);
      });

      it("should not flag text-based subtitle codecs", () => {
        expect(isImageBasedSubtitleCodec("srt")).toBe(false);
        expect(isImageBasedSubtitleCodec("subrip")).toBe(false);
        expect(isImageBasedSubtitleCodec("ass")).toBe(false);
        expect(isImageBasedSubtitleCodec("ssa")).toBe(false);
        expect(isImageBasedSubtitleCodec("webvtt")).toBe(false);
        expect(isImageBasedSubtitleCodec("vtt")).toBe(false);
        expect(isImageBasedSubtitleCodec("mov_text")).toBe(false);
        expect(isImageBasedSubtitleCodec("microdvd")).toBe(false);
      });

      it("should return false for missing codec", () => {
        expect(isImageBasedSubtitleCodec(undefined)).toBe(false);
        expect(isImageBasedSubtitleCodec("")).toBe(false);
      });
    });

    describe("getBurnInSubtitleStream", () => {
      it("should return null when videoItem is null or has no MediaStreams", () => {
        expect(getBurnInSubtitleStream(null)).toBeNull();
        expect(getBurnInSubtitleStream({ MediaStreams: undefined } as any)).toBeNull();
      });

      it("should return null when there are no subtitle streams", () => {
        const videoItem = {
          Id: "video123",
          MediaStreams: [
            { Type: "Video", Codec: "h264", Index: 0 },
            { Type: "Audio", Codec: "aac", Index: 1 },
          ],
        } as any;

        expect(getBurnInSubtitleStream(videoItem)).toBeNull();
      });

      it("should return null when any subtitle stream is text-based", () => {
        const videoItem = {
          Id: "video123",
          MediaStreams: [
            { Type: "Video", Codec: "h264", Index: 0 },
            { Type: "Subtitle", Codec: "pgssub", Index: 2, Language: "eng" },
            { Type: "Subtitle", Codec: "subrip", Index: 3, Language: "eng" },
          ],
        } as any;

        expect(getBurnInSubtitleStream(videoItem)).toBeNull();
      });

      it("should return the only image-based subtitle stream", () => {
        const videoItem = {
          Id: "video123",
          MediaStreams: [
            { Type: "Video", Codec: "h264", Index: 0 },
            { Type: "Subtitle", Codec: "pgssub", Index: 2, Language: "eng" },
          ],
        } as any;

        expect(getBurnInSubtitleStream(videoItem)).toMatchObject({ Index: 2, Codec: "pgssub" });
      });

      it("should prefer the default track over forced and first", () => {
        const videoItem = {
          Id: "video123",
          MediaStreams: [
            { Type: "Video", Codec: "h264", Index: 0 },
            { Type: "Subtitle", Codec: "pgssub", Index: 2, IsForced: true },
            { Type: "Subtitle", Codec: "pgssub", Index: 3, IsDefault: true },
            { Type: "Subtitle", Codec: "pgssub", Index: 4 },
          ],
        } as any;

        expect(getBurnInSubtitleStream(videoItem)).toMatchObject({ Index: 3 });
      });

      it("should prefer a forced track when no default exists", () => {
        const videoItem = {
          Id: "video123",
          MediaStreams: [
            { Type: "Video", Codec: "h264", Index: 0 },
            { Type: "Subtitle", Codec: "dvdsub", Index: 2 },
            { Type: "Subtitle", Codec: "dvdsub", Index: 3, IsForced: true },
          ],
        } as any;

        expect(getBurnInSubtitleStream(videoItem)).toMatchObject({ Index: 3 });
      });

      it("should fall back to the first stream when no flags are set", () => {
        const videoItem = {
          Id: "video123",
          MediaStreams: [
            { Type: "Video", Codec: "h264", Index: 0 },
            { Type: "Subtitle", Codec: "pgssub", Index: 2 },
            { Type: "Subtitle", Codec: "pgssub", Index: 3 },
          ],
        } as any;

        expect(getBurnInSubtitleStream(videoItem)).toMatchObject({ Index: 2 });
      });

      it("should ignore subtitle streams without an Index", () => {
        const videoItem = {
          Id: "video123",
          MediaStreams: [
            { Type: "Video", Codec: "h264", Index: 0 },
            { Type: "Subtitle", Codec: "pgssub" },
          ],
        } as any;

        expect(getBurnInSubtitleStream(videoItem)).toBeNull();
      });
    });

    describe("getBurnInSubtitleStream — text subtitles (AVPlayer tvOS can't select them)", () => {
      it("burns in a forced text subtitle (the without.mkv case)", () => {
        const videoItem = {
          MediaStreams: [
            { Type: "Video", Codec: "h264", Index: 0 },
            { Type: "Subtitle", Codec: "subrip", Index: 2, Language: "eng", IsForced: true },
          ],
        } as any;

        expect(getBurnInSubtitleStream(videoItem)).toMatchObject({ Index: 2, Codec: "subrip" });
      });

      it("does NOT burn in a default (non-forced) text subtitle — that would force subs on, e.g. multi-audio files", () => {
        const videoItem = {
          MediaStreams: [
            { Type: "Subtitle", Codec: "ass", Index: 2, Language: "eng" },
            { Type: "Subtitle", Codec: "subrip", Index: 3, Language: "spa", IsDefault: true },
          ],
        } as any;

        expect(getBurnInSubtitleStream(videoItem)).toBeNull();
      });

      it("burns in the forced text track when both default and forced exist", () => {
        const videoItem = {
          MediaStreams: [
            { Type: "Subtitle", Codec: "subrip", Index: 2, Language: "eng", IsDefault: true },
            { Type: "Subtitle", Codec: "subrip", Index: 3, Language: "eng", IsForced: true },
          ],
        } as any;

        expect(getBurnInSubtitleStream(videoItem)).toMatchObject({ Index: 3 });
      });

      it("returns null for a text-only file with no forced track (left unsupported)", () => {
        const videoItem = {
          MediaStreams: [
            { Type: "Subtitle", Codec: "subrip", Index: 2, Language: "eng" },
            { Type: "Subtitle", Codec: "subrip", Index: 3, Language: "spa", IsDefault: true },
          ],
        } as any;

        expect(getBurnInSubtitleStream(videoItem)).toBeNull();
      });

      it("burns in a forced image sub even when a text track is also present (mixed file)", () => {
        const videoItem = {
          MediaStreams: [
            { Type: "Subtitle", Codec: "pgssub", Index: 2, Language: "eng", IsForced: true },
            { Type: "Subtitle", Codec: "subrip", Index: 3, Language: "eng" },
          ],
        } as any;

        expect(getBurnInSubtitleStream(videoItem)).toMatchObject({ Index: 2, Codec: "pgssub" });
      });
    });

    describe("getPosterUrl", () => {
      it("should generate poster URL with default maxHeight", async () => {
        const url = getPosterUrl("item123");

        expect(url).toBe("http://192.168.1.100:8096/Items/item123/Images/Primary?api_key=test-api-key&maxHeight=450&quality=90");
      });

      it("should generate poster URL with custom maxHeight", async () => {
        const url = getPosterUrl("item123", 600);

        expect(url).toContain("maxHeight=600");
      });
    });

    describe("getFolderThumbnailUrl", () => {
      it("should generate folder thumbnail URL with default maxHeight", async () => {
        const url = getFolderThumbnailUrl("folder123");

        expect(url).toBe("http://192.168.1.100:8096/Items/folder123/Images/Primary?api_key=test-api-key&maxHeight=300&quality=90");
      });

      it("should generate folder thumbnail URL with custom maxHeight", async () => {
        const url = getFolderThumbnailUrl("folder123", 400);

        expect(url).toContain("maxHeight=400");
      });
    });

    describe("getSubtitleUrl", () => {
      it("should generate subtitle URL with default VTT format", async () => {
        const url = getSubtitleUrl("video123", 2);

        expect(url).toBe("http://192.168.1.100:8096/Videos/video123/video123/Subtitles/2/Stream.vtt?api_key=test-api-key");
      });

      it("should generate subtitle URL with custom format", async () => {
        const url = getSubtitleUrl("video123", 3, "srt");

        expect(url).toContain("/Subtitles/3/Stream.srt");
        expect(url).toContain("api_key=test-api-key");
      });
    });
  });

  describe("config migration", () => {
    const mockSecureStore = require("expo-secure-store");

    beforeEach(() => {
      jest.clearAllMocks();
    });

    it("should migrate old IP/port format to URL format", async () => {
      // Setup old format keys
      mockSecureStore.getItemAsync.mockImplementation((key: string) => {
        const oldConfig: Record<string, string> = {
          jellyfin_server_url: "", // New format doesn't exist yet
          jellyfin_server_ip: "192.168.1.100",
          jellyfin_server_port: "8096",
          jellyfin_server_protocol: "http",
          jellyfin_api_key: "old-api-key",
          jellyfin_user_id: "old-user-id",
        };
        return Promise.resolve(oldConfig[key] || null);
      });

      await getConfig();

      // Should have migrated to new URL format
      expect(mockSecureStore.setItemAsync).toHaveBeenCalledWith("jellyfin_server_url", "http://192.168.1.100:8096");

      // Should have deleted old keys
      expect(mockSecureStore.deleteItemAsync).toHaveBeenCalledWith("jellyfin_server_ip");
      expect(mockSecureStore.deleteItemAsync).toHaveBeenCalledWith("jellyfin_server_port");
      expect(mockSecureStore.deleteItemAsync).toHaveBeenCalledWith("jellyfin_server_protocol");
    });

    it("should skip migration if new format already exists", async () => {
      mockSecureStore.getItemAsync.mockImplementation((key: string) => {
        if (key === "jellyfin_server_url") return Promise.resolve("http://192.168.1.100:8096");
        return Promise.resolve(null);
      });

      await getConfig();

      // Should not have called setItemAsync for migration
      expect(mockSecureStore.setItemAsync).not.toHaveBeenCalledWith("jellyfin_server_url", expect.any(String));
    });

    it("should skip migration if old format doesn't exist", async () => {
      mockSecureStore.getItemAsync.mockResolvedValue(null);

      await getConfig();

      // Should not have called setItemAsync for migration
      expect(mockSecureStore.setItemAsync).not.toHaveBeenCalledWith("jellyfin_server_url", expect.any(String));
    });

    it("should handle HTTPS protocol in migration", async () => {
      mockSecureStore.getItemAsync.mockImplementation((key: string) => {
        const oldConfig: Record<string, string> = {
          jellyfin_server_url: "",
          jellyfin_server_ip: "jellyfin.example.com",
          jellyfin_server_port: "443",
          jellyfin_server_protocol: "https",
        };
        return Promise.resolve(oldConfig[key] || null);
      });

      await getConfig();

      expect(mockSecureStore.setItemAsync).toHaveBeenCalledWith("jellyfin_server_url", "https://jellyfin.example.com:443");
    });

    it("should use default values when old protocol/port missing", async () => {
      mockSecureStore.getItemAsync.mockImplementation((key: string) => {
        const oldConfig: Record<string, string> = {
          jellyfin_server_url: "",
          jellyfin_server_ip: "192.168.1.50",
          // No port or protocol specified
        };
        return Promise.resolve(oldConfig[key] || null);
      });

      await getConfig();

      // Should default to http://ip:8096
      expect(mockSecureStore.setItemAsync).toHaveBeenCalledWith("jellyfin_server_url", "http://192.168.1.50:8096");
    });
  });

  describe("buildServerUrlCandidates", () => {
    it("uses a full http/https URL exactly as entered", () => {
      expect(buildServerUrlCandidates("http://192.168.1.100:8096")).toEqual(["http://192.168.1.100:8096"]);
      expect(buildServerUrlCandidates("https://jellyfin.example.com")).toEqual(["https://jellyfin.example.com"]);
    });

    it("strips trailing slashes from a full URL", () => {
      expect(buildServerUrlCandidates("https://jellyfin.example.com/")).toEqual(["https://jellyfin.example.com"]);
    });

    it("treats the scheme case-insensitively", () => {
      expect(buildServerUrlCandidates("HTTPS://host")).toEqual(["HTTPS://host"]);
    });

    it("probes both protocols when a bare host includes a port", () => {
      expect(buildServerUrlCandidates("192.168.1.100:8096")).toEqual(["https://192.168.1.100:8096", "http://192.168.1.100:8096"]);
    });

    it("probes default and standard ports (https first) for a bare IP", () => {
      expect(buildServerUrlCandidates("192.168.1.100")).toEqual(["https://192.168.1.100:8920", "https://192.168.1.100", "http://192.168.1.100:8096", "http://192.168.1.100"]);
    });

    it("probes default and standard ports for a bare hostname", () => {
      expect(buildServerUrlCandidates("jellyfin.example.com")).toEqual([
        "https://jellyfin.example.com:8920",
        "https://jellyfin.example.com",
        "http://jellyfin.example.com:8096",
        "http://jellyfin.example.com",
      ]);
    });

    it("returns no candidates for empty input", () => {
      expect(buildServerUrlCandidates("")).toEqual([]);
      expect(buildServerUrlCandidates("   ")).toEqual([]);
    });

    describe("checkServerInfo abort signal", () => {
      it("gives up when the caller's signal fires, without waiting out the timeout", async () => {
        // The network scan passes its own signal so pressing Stop drops the
        // requests already in flight instead of leaving sockets to time out.
        global.fetch = jest.fn(
          (_url: string, init: { signal: AbortSignal }) =>
            new Promise((_resolve, reject) => {
              init.signal.addEventListener("abort", () => {
                const error = new Error("Aborted");
                error.name = "AbortError";
                reject(error);
              });
            }),
        ) as unknown as typeof fetch;

        const controller = new AbortController();
        setTimeout(() => controller.abort(), 20);

        // A 60s timeout that never gets to matter: the external signal is what ends it.
        await expect(checkServerInfo("http://10.0.0.5:8096", 60000, controller.signal)).rejects.toThrow(/timed out/i);
      });

      it("does not leave a listener on a signal it was given", async () => {
        global.fetch = jest.fn().mockResolvedValue({
          ok: true,
          json: async () => ({ ServerName: "Home", Version: "10.9.0", Id: "server-a" }),
        }) as unknown as typeof fetch;

        const controller = new AbortController();
        const add = jest.spyOn(controller.signal, "addEventListener");
        const remove = jest.spyOn(controller.signal, "removeEventListener");

        await checkServerInfo("http://10.0.0.5:8096", 5000, controller.signal);

        // A subnet sweep makes thousands of these against one signal.
        expect(add).toHaveBeenCalledTimes(1);
        expect(remove).toHaveBeenCalledTimes(1);
      });
    });

    it("keeps a subpath after the host instead of appending the port to the path", () => {
      // Regression: this used to build "https://10.0.0.5/jellyfin:8920", which is
      // malformed, so every candidate failed for reverse-proxy addresses.
      expect(buildServerUrlCandidates("10.0.0.5/jellyfin")).toEqual(["https://10.0.0.5/jellyfin", "http://10.0.0.5/jellyfin", "https://10.0.0.5:8920/jellyfin", "http://10.0.0.5:8096/jellyfin"]);
    });

    it("keeps a subpath alongside an explicit port", () => {
      expect(buildServerUrlCandidates("10.0.0.5:8096/jellyfin")).toEqual(["https://10.0.0.5:8096/jellyfin", "http://10.0.0.5:8096/jellyfin"]);
    });

    it("prefers the proxy ports when a subpath is present", () => {
      // A subpath implies a reverse proxy, which listens on 443/80 far more often
      // than on Jellyfin's own ports.
      const [first, second] = buildServerUrlCandidates("jellyfin.example.com/media");
      expect(first).toBe("https://jellyfin.example.com/media");
      expect(second).toBe("http://jellyfin.example.com/media");
    });

    it("strips a trailing slash from a subpath", () => {
      expect(buildServerUrlCandidates("10.0.0.5/jellyfin/")[0]).toBe("https://10.0.0.5/jellyfin");
    });
  });

  describe("resolveServerConnection", () => {
    const originalFetch = global.fetch;
    const mockFetch = jest.fn();

    beforeEach(() => {
      mockFetch.mockReset();
      global.fetch = mockFetch as unknown as typeof fetch;
    });

    afterAll(() => {
      global.fetch = originalFetch;
    });

    /** Answer as Jellyfin for the given base URLs, and refuse everything else. */
    const serveJellyfinAt = (...bases: string[]) => {
      mockFetch.mockImplementation(async (url: string) => {
        if (bases.some((base) => url === `${base}/System/Info/Public`)) {
          return { ok: true, json: async () => ({ ServerName: "Home", Version: "10.9.0", Id: "abc" }) };
        }
        throw new Error("connection refused");
      });
    };

    it("resolves a bare IP to the candidate that answers", async () => {
      serveJellyfinAt("http://192.168.1.100:8096");

      const { url, info } = await resolveServerConnection("192.168.1.100");

      expect(url).toBe("http://192.168.1.100:8096");
      expect(info.ServerName).toBe("Home");
    });

    it("resolves a reverse-proxy subpath, which used to build malformed URLs", async () => {
      serveJellyfinAt("http://192.168.1.100/jellyfin");

      const { url } = await resolveServerConnection("192.168.1.100/jellyfin");

      expect(url).toBe("http://192.168.1.100/jellyfin");
    });

    it("lists every candidate and its failure when nothing answers", async () => {
      serveJellyfinAt();

      const error = await resolveServerConnection("192.168.1.100").catch((e: Error) => e);
      const message = (error as Error).message;

      expect(message).toContain("Couldn't reach a Jellyfin server at 192.168.1.100.");
      for (const candidate of buildServerUrlCandidates("192.168.1.100")) {
        expect(message).toContain(candidate);
      }
      expect(message).toContain("unreachable");
      expect(message).toContain("Local Network access");
    });

    it("names the failure reason per candidate", async () => {
      mockFetch.mockImplementation(async (url: string) => {
        if (url.startsWith("http://192.168.1.100:8096")) return { ok: false, status: 502 };
        if (url.startsWith("http://192.168.1.100/")) return { ok: true, json: async () => ({ hello: "router" }) };
        throw Object.assign(new Error("AbortError"), { name: "AbortError" });
      });

      const error = await resolveServerConnection("192.168.1.100").catch((e: Error) => e);
      const message = (error as Error).message;

      expect(message).toContain("http://192.168.1.100:8096  HTTP 502");
      expect(message).toContain("http://192.168.1.100  not a Jellyfin server");
      expect(message).toContain("https://192.168.1.100:8920  no response");
    });

    it("surfaces the specific error for a full URL, which has a single candidate", async () => {
      serveJellyfinAt();

      await expect(resolveServerConnection("http://192.168.1.100:8096")).rejects.toThrow("Unable to reach Jellyfin server");
    });

    it("rejects an empty address", async () => {
      await expect(resolveServerConnection("   ")).rejects.toThrow("Please enter a server address.");
    });
  });

  describe("evaluateSavedConnection", () => {
    const mockSecureStore = require("expo-secure-store");

    beforeEach(() => {
      global.fetch = jest.fn();
    });

    afterEach(() => {
      jest.restoreAllMocks();
    });

    const withCreds = () =>
      mockSecureStore.getItemAsync.mockImplementation((key: string) =>
        Promise.resolve(
          (
            {
              jellyfin_server_url: "http://192.168.1.100:8096",
              jellyfin_api_key: "tok",
              jellyfin_user_id: "uid",
            } as Record<string, string>
          )[key] || null,
        ),
      );

    it("returns 'none' when there is no saved connection", async () => {
      mockSecureStore.getItemAsync.mockResolvedValue(null);
      expect(await evaluateSavedConnection(true)).toBe("none");
    });

    it("returns 'connected' when the saved server is reachable", async () => {
      withCreds();
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ ServerName: "Living Room", Version: "10.9.0" }),
      });
      expect(await evaluateSavedConnection(true)).toBe("connected");
    });

    it("returns 'needs_restore' when the saved server is unreachable", async () => {
      withCreds();
      (global.fetch as jest.Mock).mockRejectedValueOnce(new Error("network down"));
      expect(await evaluateSavedConnection(true)).toBe("needs_restore");
    });

    it("caches the result until forced to re-evaluate", async () => {
      withCreds();
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ ServerName: "Living Room", Version: "10.9.0" }),
      });
      expect(await evaluateSavedConnection(true)).toBe("connected");

      // Without force it must not probe again (fetch not called a second time).
      (global.fetch as jest.Mock).mockClear();
      expect(await evaluateSavedConnection()).toBe("connected");
      expect(global.fetch).not.toHaveBeenCalled();
    });
  });

  describe("MusicVideo library support", () => {
    const mockSecureStore = require("expo-secure-store");

    beforeEach(() => {
      jest.clearAllMocks();
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
    });

    afterEach(() => {
      jest.restoreAllMocks();
    });

    it("includes MusicVideo when fetching folder contents", async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => ({ Items: [], TotalRecordCount: 0 }),
      });

      await fetchFolderContents("music-videos-library");

      const requestUrl = new URL((global.fetch as jest.Mock).mock.calls[0][0] as string);
      expect(requestUrl.searchParams.get("IncludeItemTypes")).toContain("MusicVideo");
    });

    it("includes MusicVideo when searching library items", async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => ({ Items: [], TotalRecordCount: 0 }),
      });

      await searchVideos("test");

      const requestUrl = new URL((global.fetch as jest.Mock).mock.calls[0][0] as string);
      expect(requestUrl.searchParams.get("IncludeItemTypes")).toContain("MusicVideo");
    });

    it("includes MusicVideo when fetching recursive videos", async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => ({ Items: [{ Id: "mv-1", Name: "Song", Type: "MusicVideo" }], TotalRecordCount: 1 }),
      });

      await fetchRecursiveVideos("music-videos-library");

      const requestUrl = new URL((global.fetch as jest.Mock).mock.calls[0][0] as string);
      expect(requestUrl.searchParams.get("IncludeItemTypes")).toContain("MusicVideo");
    });
  });

  describe("media type allowlists", () => {
    const mockSecureStore = require("expo-secure-store");

    beforeEach(() => {
      jest.clearAllMocks();
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
    });

    afterEach(() => {
      jest.restoreAllMocks();
    });

    const mockEmptyResponse = () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => ({ Items: [], TotalRecordCount: 0 }),
      });
    };

    // Split the param so "Photo" never substring-matches "PhotoAlbum"
    const requestedTypes = () => {
      const requestUrl = new URL((global.fetch as jest.Mock).mock.calls[0][0] as string);
      return requestUrl.searchParams.get("IncludeItemTypes")?.split(",") ?? [];
    };

    it("includes Photo, Trailer and AudioBook when fetching folder contents", async () => {
      mockEmptyResponse();

      await fetchFolderContents("photos-library");

      expect(requestedTypes()).toEqual(expect.arrayContaining(["Photo", "Trailer", "AudioBook"]));
    });

    it("keeps Photo out of the recursive play queue while including the new playable kinds", async () => {
      mockEmptyResponse();

      await fetchRecursiveVideos("mixed-folder");

      const types = requestedTypes();
      expect(types).toEqual(expect.arrayContaining(["MusicVideo", "Trailer", "AudioBook"]));
      expect(types).not.toContain("Photo");
    });

    it("keeps the flat library list to standalone videos", async () => {
      mockEmptyResponse();

      await fetchLibraryVideos();

      const types = requestedTypes();
      expect(types).toEqual(expect.arrayContaining(["Movie", "Video", "MusicVideo", "Trailer"]));
      expect(types).not.toContain("Photo");
      expect(types).not.toContain("Episode");
    });

    it("classifies Photo as viewable, not a folder", () => {
      const photo = { Id: "p1", Name: "Pic", Type: "Photo" } as any;

      expect(isPhoto(photo)).toBe(true);
      expect(isFolder(photo)).toBe(false);
    });

    it("still classifies every container kind as a folder and playable kinds as not", () => {
      const containers = ["Folder", "CollectionFolder", "UserView", "Series", "Season", "BoxSet", "MusicAlbum", "MusicArtist", "PhotoAlbum", "Playlist"];
      for (const type of containers) {
        expect(isFolder({ Id: "id", Name: "n", Type: type } as any)).toBe(true);
      }
      for (const type of ["Movie", "MusicVideo", "Trailer", "AudioBook", "Photo"]) {
        expect(isFolder({ Id: "id", Name: "n", Type: type } as any)).toBe(false);
      }
    });
  });

  describe("library filters", () => {
    const mockSecureStore = require("expo-secure-store");

    beforeEach(() => {
      jest.clearAllMocks();
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
    });

    afterEach(() => {
      jest.restoreAllMocks();
    });

    const mockEmpty = () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce({ ok: true, json: async () => ({ Items: [], TotalRecordCount: 0 }) });
    };
    const requestUrl = () => new URL((global.fetch as jest.Mock).mock.calls[0][0] as string);

    it("sends Years comma-delimited in the flattened filter query", async () => {
      mockEmpty();

      await fetchFolderContents("lib", { filters: { ...EMPTY_FILTERS, years: [1994, 1995] } });

      const url = requestUrl();
      expect(url.searchParams.get("Recursive")).toBe("true");
      expect(url.searchParams.get("Years")).toBe("1994,1995");
    });

    it("shuffle alone does NOT flatten — keeps the non-recursive browse with SortBy=Random", async () => {
      mockEmpty();

      await fetchFolderContents("lib", { filters: { ...EMPTY_FILTERS, shuffle: true } });

      const url = requestUrl();
      expect(url.searchParams.get("Recursive")).toBeNull();
      expect(url.searchParams.get("IncludeItemTypes")).toContain("MusicVideo"); // BROWSE_ITEM_TYPES
      expect(url.searchParams.get("SortBy")).toBe("Random");
    });

    it("a content filter flattens recursively, and shuffle still drives SortBy", async () => {
      mockEmpty();

      await fetchFolderContents("lib", { filters: { ...EMPTY_FILTERS, favorite: true, shuffle: true } });

      const url = requestUrl();
      expect(url.searchParams.get("Recursive")).toBe("true");
      expect(url.searchParams.get("Filters")).toBe("IsFavorite");
      expect(url.searchParams.get("SortBy")).toBe("Random");
    });

    it("fetchLibraryYears maps /Years names to numbers, drops non-numeric, sorts descending", async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          Items: [
            { Id: "y1", Name: "1994" },
            { Id: "y2", Name: "2011" },
            { Id: "bad", Name: "Unknown" },
            { Id: "y3", Name: "2003" },
          ],
        }),
      });

      const years = await fetchLibraryYears("lib");

      expect(requestUrl().pathname).toBe("/Years");
      expect(years).toEqual([2011, 2003, 1994]);
    });
  });

  describe("item count accuracy", () => {
    const mockSecureStore = require("expo-secure-store");

    beforeEach(() => {
      jest.clearAllMocks();
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
    });

    afterEach(() => {
      jest.restoreAllMocks();
    });

    it("replaces the server's random ChildCount on views with a real recursive count", async () => {
      (global.fetch as jest.Mock)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            Items: [
              { Id: "lib-1", Name: "Music2", Type: "CollectionFolder", ChildCount: 5 },
              { Id: "lib-2", Name: "Movies", Type: "CollectionFolder", ChildCount: 3 },
            ],
          }),
        })
        .mockResolvedValueOnce({ ok: true, json: async () => ({ Items: [], TotalRecordCount: 1234 }) })
        .mockResolvedValueOnce({ ok: true, json: async () => ({ Items: [], TotalRecordCount: 87 }) });

      const { items } = await fetchUserViews();

      expect(items[0].ChildCount).toBeUndefined();
      expect(items[0].RecursiveItemCount).toBe(1234);
      expect(items[1].ChildCount).toBeUndefined();
      expect(items[1].RecursiveItemCount).toBe(87);

      // The count query mirrors the server's GetRecursiveChildCount semantics
      const countUrl = new URL((global.fetch as jest.Mock).mock.calls[1][0] as string);
      expect(countUrl.searchParams.get("ParentId")).toBe("lib-1");
      expect(countUrl.searchParams.get("Recursive")).toBe("true");
      expect(countUrl.searchParams.get("Limit")).toBe("1");
      // MediaTypes is the only filter Jellyfin 10.11 applies correctly on recursive
      // view-root queries: IsFolder=false is ignored (folders get counted) and
      // IncludeItemTypes/Filters=IsNotFolder return 0 for most typed libraries.
      expect(countUrl.searchParams.get("MediaTypes")).toBe("Video,Audio,Photo");
      expect(countUrl.searchParams.has("IncludeItemTypes")).toBe(false);
      expect(countUrl.searchParams.has("IsFolder")).toBe(false);
    });

    it("leaves RecursiveItemCount undefined when a view count query fails", async () => {
      (global.fetch as jest.Mock)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ Items: [{ Id: "lib-1", Name: "Music2", Type: "CollectionFolder", ChildCount: 7 }] }),
        })
        .mockRejectedValueOnce(new Error("network down"));

      const { items } = await fetchUserViews();

      expect(items).toHaveLength(1);
      expect(items[0].ChildCount).toBeUndefined();
      expect(items[0].RecursiveItemCount).toBeUndefined();
    });

    it("requests RecursiveItemCount in Fields when fetching folder contents", async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => ({ Items: [], TotalRecordCount: 0 }),
      });

      await fetchFolderContents("some-folder");

      const requestUrl = new URL((global.fetch as jest.Mock).mock.calls[0][0] as string);
      expect(requestUrl.searchParams.get("Fields")).toContain("RecursiveItemCount");
    });
  });

  describe("getAuthHeader", () => {
    it("builds the client header without a Token for unauthenticated requests", () => {
      expect(getAuthHeader("device-123")).toBe('MediaBrowser Client="TomoTV", Device="iOS", DeviceId="device-123", Version="9.9.9"');
    });

    it("appends the Token for authenticated requests", () => {
      expect(getAuthHeader("device-123", "secret-token")).toBe('MediaBrowser Client="TomoTV", Device="iOS", DeviceId="device-123", Version="9.9.9", Token="secret-token"');
    });

    it("sources the version from app config so it never drifts", () => {
      // Version comes from Constants.expoConfig.version (mocked to 9.9.9),
      // not a hardcoded literal.
      expect(getAuthHeader("d")).toContain('Version="9.9.9"');
    });
  });
});
