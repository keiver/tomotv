/**
 * EnableNextEpisodeAutoPlay reader: the server's answer, its default, and the last read standing in offline.
 */
import { fetchNextEpisodeAutoPlay, refreshConfig } from "../jellyfinApi";

jest.mock("expo-secure-store", () => ({
  getItemAsync: jest.fn().mockResolvedValue(null),
  setItemAsync: jest.fn().mockResolvedValue(undefined),
  deleteItemAsync: jest.fn().mockResolvedValue(undefined),
}));

jest.mock("@/services/libraryManager", () => ({
  libraryManager: { clearCache: jest.fn() },
}));

const SERVER = "http://192.168.1.100:8096";
const STORE_KEY = "app_next_episode_autoplay";

describe("fetchNextEpisodeAutoPlay", () => {
  const mockSecureStore = require("expo-secure-store");
  let store: Record<string, string>;

  beforeEach(async () => {
    global.fetch = jest.fn();
    store = {
      jellyfin_server_url: SERVER,
      jellyfin_api_key: "test-api-key",
      jellyfin_user_id: "user-a",
      jellyfin_device_id: "test-device-id",
    };
    mockSecureStore.getItemAsync.mockImplementation((key: string) => Promise.resolve(store[key] ?? null));
    mockSecureStore.setItemAsync.mockImplementation((key: string, value: string) => {
      store[key] = value;
      return Promise.resolve();
    });
    await refreshConfig();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("reads the setting from /Users/Me with the auth header and never writes to the server", async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce({ ok: true, json: async () => ({ Configuration: { EnableNextEpisodeAutoPlay: false } }) });
    expect(await fetchNextEpisodeAutoPlay()).toBe(false);
    const [url, init] = (global.fetch as jest.Mock).mock.calls[0];
    expect(url).toBe(`${SERVER}/Users/Me`);
    expect(init.method).toBeUndefined();
    expect(init.headers.Authorization).toContain('Token="test-api-key"');
  });

  it("treats a missing field as on, the server default", async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce({ ok: true, json: async () => ({ Configuration: {} }) });
    expect(await fetchNextEpisodeAutoPlay()).toBe(true);
  });

  it("answers with the last read for the same account when the server is unreachable", async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce({ ok: true, json: async () => ({ Configuration: { EnableNextEpisodeAutoPlay: false } }) });
    await fetchNextEpisodeAutoPlay();
    (global.fetch as jest.Mock).mockRejectedValueOnce(new Error("Network request failed"));
    expect(await fetchNextEpisodeAutoPlay()).toBe(false);
  });

  it("ignores a last read that belongs to another account", async () => {
    store[STORE_KEY] = JSON.stringify({ account: `${SERVER}|user-b`, enabled: false });
    (global.fetch as jest.Mock).mockResolvedValueOnce({ ok: false, status: 500 });
    expect(await fetchNextEpisodeAutoPlay()).toBe(true);
  });

  it("is on with no server configured, without a request", async () => {
    store = {};
    await refreshConfig();
    expect(await fetchNextEpisodeAutoPlay()).toBe(true);
    expect(global.fetch).not.toHaveBeenCalled();
  });
});
