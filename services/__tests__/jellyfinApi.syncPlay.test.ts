/**
 * SyncPlay REST client: request shapes, auth header, the GetUtcTime round trip, and the
 * per-server access cache.
 */
import { createSyncPlayGroup, fetchSyncPlayAccess, measureServerClock, refreshConfig, resetSyncPlayAccessCache, syncPlaySeek } from "../jellyfinApi";

jest.mock("expo-secure-store", () => ({
  getItemAsync: jest.fn().mockResolvedValue(null),
  setItemAsync: jest.fn().mockResolvedValue(undefined),
  deleteItemAsync: jest.fn().mockResolvedValue(undefined),
}));

jest.mock("@/services/libraryManager", () => ({
  libraryManager: { clearCache: jest.fn() },
}));

describe("syncPlay REST", () => {
  const mockSecureStore = require("expo-secure-store");

  beforeEach(async () => {
    global.fetch = jest.fn();
    resetSyncPlayAccessCache();
    mockSecureStore.getItemAsync.mockImplementation((key: string) => {
      const config: Record<string, string> = {
        jellyfin_server_url: "http://192.168.1.100:8096",
        jellyfin_api_key: "test-api-key",
        jellyfin_user_id: "test-user-id",
        jellyfin_device_id: "test-device-id",
      };
      return Promise.resolve(config[key] || null);
    });
    await refreshConfig();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("creates a group with the auth header and returns the info", async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce({ ok: true, json: async () => ({ GroupId: "g1", GroupName: "Movie night", State: "Idle", Participants: [], LastUpdatedAt: "x" }) });
    const info = await createSyncPlayGroup("Movie night");
    const [url, init] = (global.fetch as jest.Mock).mock.calls[0];
    expect(url).toBe("http://192.168.1.100:8096/SyncPlay/New");
    expect(init.method).toBe("POST");
    expect(init.headers.Authorization).toContain('Token="test-api-key"');
    expect(JSON.parse(init.body)).toEqual({ GroupName: "Movie night" });
    expect(info.GroupId).toBe("g1");
  });

  it("rounds the seek position to whole ticks and never throws on a bad status", async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce({ ok: false, status: 500 });
    await expect(syncPlaySeek(123.7)).resolves.toBeUndefined();
    const [, init] = (global.fetch as jest.Mock).mock.calls[0];
    expect(JSON.parse(init.body)).toEqual({ PositionTicks: 124 });
  });

  it("computes a clock offset from GetUtcTime", async () => {
    const serverIso = new Date(Date.now() + 10_000).toISOString();
    (global.fetch as jest.Mock).mockResolvedValueOnce({ ok: true, json: async () => ({ RequestReceptionTime: serverIso, ResponseTransmissionTime: serverIso }) });
    const sample = await measureServerClock();
    expect(sample).not.toBeNull();
    expect(Math.abs((sample?.offsetMs ?? 0) - 10_000)).toBeLessThan(1000);
  });

  it("reads SyncPlayAccess once per server, then serves from cache", async () => {
    (global.fetch as jest.Mock).mockResolvedValue({ ok: true, json: async () => ({ Policy: { SyncPlayAccess: "CreateAndJoinGroups" } }) });
    expect(await fetchSyncPlayAccess()).toBe("CreateAndJoinGroups");
    expect(await fetchSyncPlayAccess()).toBe("CreateAndJoinGroups");
    expect((global.fetch as jest.Mock).mock.calls.length).toBe(1);
  });
});
