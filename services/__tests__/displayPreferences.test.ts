/**
 * DisplayPreferences: the read, and the write that merges into what the server already holds.
 */
import { getDisplayPreferences, refreshConfig, removeDisplayPreference, updateDisplayPreferences } from "../jellyfinApi";

jest.mock("expo-secure-store", () => ({
  getItemAsync: jest.fn().mockResolvedValue(null),
  setItemAsync: jest.fn().mockResolvedValue(undefined),
  deleteItemAsync: jest.fn().mockResolvedValue(undefined),
}));
jest.mock("@/services/libraryManager", () => ({ libraryManager: { clearCache: jest.fn() } }));

const mockSecureStore = require("expo-secure-store");
const fetchMock = () => global.fetch as jest.Mock;
const request = (index: number) => ({ url: fetchMock().mock.calls[index][0] as string, init: fetchMock().mock.calls[index][1] as RequestInit });
const ok = (body: unknown) => ({ ok: true, status: 200, json: async () => body });

describe("displayPreferences", () => {
  beforeEach(async () => {
    global.fetch = jest.fn();
    mockSecureStore.getItemAsync.mockImplementation((key: string) => {
      const config: Record<string, string> = { jellyfin_server_url: "http://jf:8096", jellyfin_api_key: "token", jellyfin_user_id: "user-1", jellyfin_device_id: "device-1" };
      return Promise.resolve(config[key] || null);
    });
    await refreshConfig();
  });

  it("reads by id and client for the signed-in user, authorised", async () => {
    fetchMock().mockResolvedValueOnce(ok({ Id: "x", CustomPrefs: { a: "1" } }));
    const prefs = await getDisplayPreferences("tomotv-diagnostics", "Tomo TV");
    expect(prefs.CustomPrefs).toEqual({ a: "1" });
    const { url, init } = request(0);
    expect(url).toBe("http://jf:8096/DisplayPreferences/tomotv-diagnostics?userId=user-1&client=Tomo%20TV");
    expect((init.headers as Record<string, string>).Authorization).toContain('Token="token"');
  });

  it("writes the server's own object back with the custom keys merged, never replacing the others", async () => {
    fetchMock()
      .mockResolvedValueOnce(ok({ Id: "x", SortBy: "SortName", CustomPrefs: { a: "1", playbackSession: "old" } }))
      .mockResolvedValueOnce({ ok: true, status: 204 });
    await updateDisplayPreferences("tomotv-diagnostics", "Tomo TV", { playbackSession: "new" });
    const { url, init } = request(1);
    expect(url).toBe("http://jf:8096/DisplayPreferences/tomotv-diagnostics?userId=user-1&client=Tomo%20TV");
    expect(init.method).toBe("POST");
    expect(JSON.parse(String(init.body))).toEqual({ Id: "tomotv-diagnostics", Client: "Tomo TV", SortBy: "SortName", CustomPrefs: { a: "1", playbackSession: "new" } });
  });

  it("drops one custom key and writes the rest back untouched", async () => {
    fetchMock()
      .mockResolvedValueOnce(ok({ Id: "x", CustomPrefs: { "playbackSession:tv-1": "a", "playbackSession:tv-2": "b", other: "c" } }))
      .mockResolvedValueOnce({ ok: true, status: 204 });
    await removeDisplayPreference("tomotv-diagnostics", "Tomo TV", "playbackSession:tv-1");
    expect(JSON.parse(String(request(1).init.body)).CustomPrefs).toEqual({ "playbackSession:tv-2": "b", other: "c" });
  });

  it("refuses to write when the account changed between the read and the write", async () => {
    fetchMock().mockImplementationOnce(async () => {
      // A switch lands while the read is in flight, or while this write waits its turn.
      mockSecureStore.getItemAsync.mockImplementation((key: string) => {
        const config: Record<string, string> = { jellyfin_server_url: "http://other:8096", jellyfin_api_key: "token2", jellyfin_user_id: "user-2", jellyfin_device_id: "device-1" };
        return Promise.resolve(config[key] || null);
      });
      await refreshConfig();
      return ok({ Id: "x", CustomPrefs: { a: "1" } });
    });

    await expect(updateDisplayPreferences("tomotv-diagnostics", "Tomo TV", { b: "2" })).rejects.toThrow("account changed");
    expect(fetchMock()).toHaveBeenCalledTimes(1);
  });

  it("surfaces a failed read or write", async () => {
    fetchMock().mockResolvedValueOnce({ ok: false, status: 500 });
    await expect(getDisplayPreferences("tomotv-diagnostics", "Tomo TV")).rejects.toThrow("500");
    fetchMock()
      .mockResolvedValueOnce(ok({ CustomPrefs: null }))
      .mockResolvedValueOnce({ ok: false, status: 403 });
    await expect(updateDisplayPreferences("tomotv-diagnostics", "Tomo TV", { k: "v" })).rejects.toThrow("403");
  });

  it("refuses without a configured server", async () => {
    mockSecureStore.getItemAsync.mockResolvedValue(null);
    await refreshConfig();
    await expect(getDisplayPreferences("tomotv-diagnostics", "Tomo TV")).rejects.toThrow("not configured");
    expect(fetchMock()).not.toHaveBeenCalled();
  });
});
