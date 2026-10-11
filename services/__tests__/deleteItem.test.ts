/** Admin delete: DELETE /Items/{id}, evictions only after the server accepts; the flag reads Policy.IsAdministrator. */

jest.mock("expo-file-system", () => require("./fakeFileSystem"));
jest.mock("react-native", () => ({
  Platform: { OS: "ios", isTV: false },
  NativeModules: { FileAttributes: { setExcludedFromBackup: jest.fn(async () => null) } },
  AppState: { addEventListener: jest.fn(() => ({ remove: jest.fn() })) },
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
import { throwRequestError } from "@/services/jellyfin/session";
import { deleteItem, fetchIsAdministrator } from "@/services/jellyfin/items";
import { subscribeItemRemoving } from "@/services/jellyfin/events";

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

  it("throws on a refused delete (401) without treating it as an expired session", async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 401 });
    await expect(deleteItem("abc")).rejects.toThrow("Failed to delete item: 401");
    expect(throwRequestError).not.toHaveBeenCalled();
    expect(invalidateItemRemoved).not.toHaveBeenCalled();
  });

  it("announces the delete as it is sent and again once it settles, landed or refused", async () => {
    const seen: string[] = [];
    const unsubscribe = subscribeItemRemoving((itemId, settled) => seen.push(`${itemId}:${settled}`));
    mockFetch.mockImplementationOnce(async () => {
      seen.push("sent");
      return { ok: true };
    });
    await deleteItem("abc");
    mockFetch.mockResolvedValueOnce({ ok: false, status: 401 });
    await expect(deleteItem("def")).rejects.toThrow();
    unsubscribe();
    expect(seen).toEqual(["abc:false", "sent", "abc:true", "def:false", "def:true"]);
  });

  it("routes other failures through the shared request error", async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 500 });
    await expect(deleteItem("abc")).rejects.toThrow("Failed to delete item: 500");
    expect(throwRequestError).toHaveBeenCalled();
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
