/**
 * Tests for the Media Segments client (skip intro/credits + Up Next proposal
 * timing): request shape, Intro/Outro extraction, and the everything-degrades-
 * to-nulls contract (missing markers must never break playback, only the
 * skip/proposal affordances).
 */
import { fetchMediaSegments, refreshConfig, JELLYFIN_TIME } from "../jellyfinApi";

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

const TICKS = JELLYFIN_TIME.TICKS_PER_SECOND;

describe("fetchMediaSegments", () => {
  const mockSecureStore = require("expo-secure-store");

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

  it("requests Intro+Outro with auth and returns both windows in seconds", async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        Items: [
          { Id: "s1", ItemId: "item-1", Type: "Intro", StartTicks: 5 * TICKS, EndTicks: 95 * TICKS },
          { Id: "s2", ItemId: "item-1", Type: "Outro", StartTicks: 2500 * TICKS, EndTicks: 2600 * TICKS },
        ],
      }),
    });

    const segments = await fetchMediaSegments("item-1");

    expect(segments).toEqual({
      intro: { startSeconds: 5, endSeconds: 95 },
      outro: { startSeconds: 2500, endSeconds: 2600 },
    });
    const [url, init] = (global.fetch as jest.Mock).mock.calls[0];
    expect(url).toBe("http://192.168.1.100:8096/MediaSegments/item-1?includeSegmentTypes=Intro&includeSegmentTypes=Outro");
    expect((init.headers as Record<string, string>).Authorization).toContain("test-api-key");
  });

  it("returns null for a missing type and drops empty windows", async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        Items: [
          { Id: "s1", ItemId: "item-1", Type: "Intro", StartTicks: 10 * TICKS, EndTicks: 90 * TICKS },
          // Zero-length outro: invalid, must be dropped.
          { Id: "s2", ItemId: "item-1", Type: "Outro", StartTicks: 2500 * TICKS, EndTicks: 2500 * TICKS },
        ],
      }),
    });

    expect(await fetchMediaSegments("item-1")).toEqual({
      intro: { startSeconds: 10, endSeconds: 90 },
      outro: null,
    });
  });

  it("returns nulls on 404 (pre-10.10 server)", async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce({ ok: false, status: 404 });

    expect(await fetchMediaSegments("item-1")).toEqual({ intro: null, outro: null });
  });

  it("returns nulls on network failure without throwing", async () => {
    (global.fetch as jest.Mock).mockRejectedValueOnce(new Error("network down"));

    await expect(fetchMediaSegments("item-1")).resolves.toEqual({ intro: null, outro: null });
  });
});
