/** Admin delete: DELETE /Items/{id}, evictions only after the server accepts; the flag reads Policy.IsAdministrator. */

jest.mock("expo-file-system", () => require("./fakeFileSystem"));
jest.mock("react-native", () => ({
  Platform: { OS: "ios", isTV: false },
  NativeModules: { FileAttributes: { setExcludedFromBackup: jest.fn(async () => null) } },
}));
jest.mock("@/utils/logger", () => ({ logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() } }));

const mockConfig = { server: "https://jf", apiKey: "key", userId: "u", deviceId: "d" };
jest.mock("@/services/jellyfin/session", () => ({
  getConfig: jest.fn(async () => mockConfig),
  getAuthHeader: jest.fn(() => 'MediaBrowser Token="key"'),
  throwRequestError: jest.fn((_response: unknown, message: string) => {
    throw new Error(message);
  }),
}));

const mockFetch = jest.fn();
jest.mock("@/services/jellyfin/http", () => ({ fetchWithTimeout: (...args: unknown[]) => mockFetch(...args) }));
jest.mock("@/services/jellyfin/cacheKeys", () => ({ invalidateItemRemoved: jest.fn() }));

import { invalidateItemRemoved } from "@/services/jellyfin/cacheKeys";
import { deleteItem, fetchIsAdministrator } from "@/services/jellyfin/items";

beforeEach(() => {
  jest.clearAllMocks();
  mockConfig.server = "https://jf";
  mockConfig.apiKey = "key";
});

describe("deleteItem", () => {
  it("sends DELETE /Items/{id} and evicts the item's reads once the server accepts", async () => {
    mockFetch.mockResolvedValue({ ok: true });
    await deleteItem("abc");
    const [url, init] = mockFetch.mock.calls[0];
    expect(url).toBe("https://jf/Items/abc");
    expect(init.method).toBe("DELETE");
    expect(init.headers.Authorization).toBe('MediaBrowser Token="key"');
    expect(invalidateItemRemoved).toHaveBeenCalledWith("u", "abc");
  });

  it("throws on a refused delete and evicts nothing", async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 401 });
    await expect(deleteItem("abc")).rejects.toThrow("Failed to delete item: 401");
    expect(invalidateItemRemoved).not.toHaveBeenCalled();
  });
});

describe("fetchIsAdministrator", () => {
  it("answers true only when /Users/Me says IsAdministrator", async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => ({ Policy: { IsAdministrator: true } }) });
    await expect(fetchIsAdministrator()).resolves.toBe(true);
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => ({ Policy: { IsAdministrator: false } }) });
    await expect(fetchIsAdministrator()).resolves.toBe(false);
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => ({}) });
    await expect(fetchIsAdministrator()).resolves.toBe(false);
  });

  it("answers false without a configured server, asking nothing", async () => {
    mockConfig.server = "";
    await expect(fetchIsAdministrator()).resolves.toBe(false);
    expect(mockFetch).not.toHaveBeenCalled();
  });
});
