/**
 * Tests for the Sessions playback-reporting surface: reportPlaybackStart/Progress/Stopped
 * request shapes and their fire-and-forget error handling (a failed report must never
 * throw into the player), plus the PlaySessionId threading on transcode URLs.
 *
 * Response bodies are not asserted — the Sessions endpoints return 204 No Content.
 */
import {
  reportPlaybackStart,
  reportPlaybackProgress,
  reportPlaybackStopped,
  updateUserItemData,
  generatePlaySessionId,
  getTranscodingStreamUrl,
  refreshConfig,
  PlaybackReportBody,
} from "../jellyfinApi";

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

describe("playback reporting (Sessions)", () => {
  const mockSecureStore = require("expo-secure-store");

  const body: PlaybackReportBody = {
    ItemId: "item-1",
    MediaSourceId: "source-1",
    PlaySessionId: "session-1",
    PositionTicks: 1230000000,
    IsPaused: false,
    PlayMethod: "Transcode",
    AudioStreamIndex: 2,
    CanSeek: true,
  };

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

  function lastRequest(): { url: string; init: RequestInit } {
    const calls = (global.fetch as jest.Mock).mock.calls;
    return { url: calls[calls.length - 1][0] as string, init: calls[calls.length - 1][1] as RequestInit };
  }

  describe.each([
    ["reportPlaybackStart", reportPlaybackStart, "/Sessions/Playing"],
    ["reportPlaybackProgress", reportPlaybackProgress, "/Sessions/Playing/Progress"],
    ["reportPlaybackStopped", reportPlaybackStopped, "/Sessions/Playing/Stopped"],
  ])("%s", (_name, report, path) => {
    it(`POSTs the report body to ${path} with auth header`, async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce({ ok: true, status: 204 });

      await report(body);

      const { url, init } = lastRequest();
      expect(url).toBe(`http://192.168.1.100:8096${path}`);
      expect(init.method).toBe("POST");
      expect((init.headers as Record<string, string>)["Content-Type"]).toBe("application/json");
      expect((init.headers as Record<string, string>).Authorization).toContain('Token="test-api-key"');
      expect(JSON.parse(init.body as string)).toEqual(body);
    });

    it("swallows a non-2xx response without throwing", async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce({ ok: false, status: 500 });

      await expect(report(body)).resolves.toBeUndefined();
    });

    it("swallows a network error without throwing", async () => {
      (global.fetch as jest.Mock).mockRejectedValueOnce(new Error("Network request failed"));

      await expect(report(body)).resolves.toBeUndefined();
    });
  });

  it("skips the request entirely when the server is not configured", async () => {
    mockSecureStore.getItemAsync.mockResolvedValue(null);
    await refreshConfig();

    await reportPlaybackProgress(body);

    expect(global.fetch).not.toHaveBeenCalled();
  });

  describe("updateUserItemData", () => {
    it("POSTs the fields verbatim to the item's UserData endpoint", async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce({ ok: true, status: 200 });

      await updateUserItemData("item-1", { PlaybackPositionTicks: 420000000, Played: false });

      const { url, init } = lastRequest();
      expect(url).toBe("http://192.168.1.100:8096/Users/test-user-id/Items/item-1/UserData");
      expect(init.method).toBe("POST");
      expect(JSON.parse(init.body as string)).toEqual({ PlaybackPositionTicks: 420000000, Played: false });
      expect((init.headers as Record<string, string>).Authorization).toContain('Token="test-api-key"');
    });

    it("resolves true on success so callers can confirm the write landed", async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce({ ok: true, status: 200 });

      await expect(updateUserItemData("item-1", { Played: false })).resolves.toBe(true);
    });

    it("swallows a non-2xx response without throwing, resolving false", async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce({ ok: false, status: 500 });

      await expect(updateUserItemData("item-1", { Played: false })).resolves.toBe(false);
    });

    it("swallows a network error without throwing, resolving false", async () => {
      (global.fetch as jest.Mock).mockRejectedValueOnce(new Error("Network request failed"));

      await expect(updateUserItemData("item-1", { Played: false })).resolves.toBe(false);
    });

    it("skips the request entirely when the server is not configured", async () => {
      mockSecureStore.getItemAsync.mockResolvedValue(null);
      await refreshConfig();

      await updateUserItemData("item-1", { Played: false });

      expect(global.fetch).not.toHaveBeenCalled();
    });
  });

  describe("generatePlaySessionId", () => {
    it("returns unique UUID-shaped ids", () => {
      const a = generatePlaySessionId();
      const b = generatePlaySessionId();
      expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
      expect(a).not.toBe(b);
    });
  });

  describe("getTranscodingStreamUrl PlaySessionId threading", () => {
    beforeEach(async () => {
      // getTranscodingStreamUrl reads the synchronous cachedConfig
      await refreshConfig();
    });

    it("appends PlaySessionId when provided", async () => {
      const url = await getTranscodingStreamUrl("item-1", null, undefined, undefined, undefined, "session-xyz");

      expect(url).toContain("PlaySessionId=session-xyz");
    });

    it("omits PlaySessionId when not provided", async () => {
      const url = await getTranscodingStreamUrl("item-1", null);

      expect(url).not.toContain("PlaySessionId");
    });
  });
});
