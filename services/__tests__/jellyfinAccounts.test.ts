import { activateAccount, getAccountsForServer, getSavedAccounts, removeAccount, removeSavedServerAndAccounts, saveAuthResult, upsertAccount, validateAccessToken } from "../jellyfinApi";
import { SavedAccount, SavedServer } from "@/types/jellyfin";

// Stateful SecureStore mock: accounts round-trip through real reads and writes.
const mockStore = new Map<string, string>();
jest.mock("expo-secure-store", () => ({
  getItemAsync: jest.fn((key: string) => Promise.resolve(mockStore.get(key) ?? null)),
  setItemAsync: jest.fn((key: string, value: string) => {
    mockStore.set(key, value);
    return Promise.resolve();
  }),
  deleteItemAsync: jest.fn((key: string) => {
    mockStore.delete(key);
    return Promise.resolve();
  }),
}));

// Mock managers to prevent cache clearing errors in tests
jest.mock("@/services/libraryManager", () => ({
  libraryManager: { clearCache: jest.fn() },
}));

// saveAuthResult and activateAccount arm warmBitrateMemory's delayed probe;
// unmocked, that timer fires mid-suite and leaks a fetch into a later test.
jest.mock("@/services/jellyfin/bitrateTest", () => ({
  warmBitrateMemory: jest.fn(),
}));

const mockFetch = jest.fn();
global.fetch = mockFetch;

const ACTIVE_SESSION = {
  jellyfin_server_url: "http://192.168.1.10:8096",
  jellyfin_api_key: "live-token",
  jellyfin_user_id: "user-1",
  jellyfin_user_name: "keiver",
  jellyfin_auth_method: "password",
  jellyfin_server_name: "Living Room",
  jellyfin_server_id: "srv-1",
  jellyfin_device_id: "install-device-id",
};

function seedActiveSession(overrides: Record<string, string> = {}) {
  for (const [key, value] of Object.entries({ ...ACTIVE_SESSION, ...overrides })) {
    mockStore.set(key, value);
  }
}

function makeAccount(overrides: Partial<SavedAccount> = {}): SavedAccount {
  return {
    serverId: "srv-1",
    serverUrl: "http://192.168.1.10:8096",
    serverName: "Living Room",
    userId: "user-1",
    userName: "keiver",
    authMethod: "password",
    deviceId: "device-a",
    lastUsedAt: 1,
    ...overrides,
  };
}

const savedServer: SavedServer = { id: "http://192.168.1.10:8096", name: "Living Room", url: "http://192.168.1.10:8096", lastConnectedAt: 1, serverId: "srv-1" };

/** Route fetches by URL: /System/Info/Public probe and /Users/Me validation. */
function mockServer({ reachable = true, tokenStatus = 200 }: { reachable?: boolean; tokenStatus?: number } = {}) {
  mockFetch.mockImplementation((url: string) => {
    if (!reachable) return Promise.reject(new Error("Network request failed"));
    if (url.endsWith("/System/Info/Public")) {
      return Promise.resolve({ ok: true, json: async () => ({ ServerName: "Living Room", Version: "10.10.0", Id: "srv-1" }) });
    }
    if (url.endsWith("/Users/Me")) {
      return Promise.resolve({ ok: tokenStatus === 200, status: tokenStatus, json: async () => ({ Id: "user-1" }) });
    }
    return Promise.reject(new Error(`Unexpected fetch: ${url}`));
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  mockFetch.mockReset();
  mockStore.clear();
});

describe("getSavedAccounts seeding", () => {
  it("seeds the active session as the first account when the index was never written", async () => {
    seedActiveSession();

    const accounts = await getSavedAccounts();

    expect(accounts).toHaveLength(1);
    expect(accounts[0]).toMatchObject({ serverId: "srv-1", userId: "user-1", userName: "keiver", authMethod: "password", deviceId: "install-device-id" });
    expect(mockStore.get("jellyfin_account_token_srv-1_user-1")).toBe("live-token");
  });

  it("seeds empty when the active session is the demo server", async () => {
    seedActiveSession({ jellyfin_is_demo_mode: "true" });

    expect(await getSavedAccounts()).toEqual([]);
  });

  it("seeds empty when the session predates the stored server Id", async () => {
    seedActiveSession();
    mockStore.delete("jellyfin_server_id");

    expect(await getSavedAccounts()).toEqual([]);
  });

  it("does not re-seed once the index exists", async () => {
    mockStore.set("jellyfin_accounts", "[]");
    seedActiveSession();

    expect(await getSavedAccounts()).toEqual([]);
  });
});

describe("upsertAccount", () => {
  it("stores the token at its own key and the metadata in the index", async () => {
    mockStore.set("jellyfin_accounts", "[]");

    await upsertAccount(makeAccount(), "tok-a");

    expect(mockStore.get("jellyfin_account_token_srv-1_user-1")).toBe("tok-a");
    const accounts = await getSavedAccounts();
    expect(accounts).toHaveLength(1);
    expect(accounts[0].userName).toBe("keiver");
  });

  it("dedupes by serverId + userId, replacing the token", async () => {
    mockStore.set("jellyfin_accounts", "[]");

    await upsertAccount(makeAccount(), "tok-old");
    await upsertAccount(makeAccount({ userName: "keiver-renamed" }), "tok-new");
    await upsertAccount(makeAccount({ userId: "user-2", userName: "guest", deviceId: "device-b" }), "tok-guest");

    const accounts = await getSavedAccounts();
    expect(accounts).toHaveLength(2);
    expect(mockStore.get("jellyfin_account_token_srv-1_user-1")).toBe("tok-new");
    expect(accounts.find((a) => a.userId === "user-1")?.userName).toBe("keiver-renamed");
  });
});

describe("saveAuthResult account persistence", () => {
  it("saves the sign-in as an account and adopts the device id", async () => {
    mockStore.set("jellyfin_accounts", "[]");

    await saveAuthResult("http://192.168.1.10:8096", "tok", "user-1", "keiver", "Living Room", "password", "srv-1", "fresh-device");

    expect(mockStore.get("jellyfin_device_id")).toBe("fresh-device");
    expect(mockStore.get("jellyfin_account_token_srv-1_user-1")).toBe("tok");
    const accounts = await getSavedAccounts();
    expect(accounts[0]).toMatchObject({ serverId: "srv-1", userId: "user-1", deviceId: "fresh-device", authMethod: "password" });
  });

  it("saves no account when the server Id is unknown", async () => {
    mockStore.set("jellyfin_accounts", "[]");

    await saveAuthResult("http://192.168.1.10:8096", "tok", "user-1", "keiver", "Living Room", "password");

    expect(await getSavedAccounts()).toEqual([]);
  });

  it("stamps the saved-server card with the server Id", async () => {
    mockStore.set("jellyfin_accounts", "[]");

    await saveAuthResult("http://192.168.1.10:8096", "tok", "user-1", "keiver", "Living Room", "password", "srv-1");

    const servers = JSON.parse(mockStore.get("jellyfin_saved_servers")!);
    expect(servers).toHaveLength(1);
    expect(servers[0].serverId).toBe("srv-1");
  });
});

describe("getAccountsForServer", () => {
  it("matches by server Id even when the stored url went stale", async () => {
    mockStore.set("jellyfin_accounts", "[]");
    await upsertAccount(makeAccount({ serverUrl: "http://10.0.0.5:8096" }), "tok");

    const matches = await getAccountsForServer(savedServer);
    expect(matches).toHaveLength(1);
  });

  it("falls back to url matching for cards without a server Id", async () => {
    mockStore.set("jellyfin_accounts", "[]");
    await upsertAccount(makeAccount(), "tok");

    const legacyCard: SavedServer = { ...savedServer, serverId: undefined };
    const matches = await getAccountsForServer(legacyCard);
    expect(matches).toHaveLength(1);
  });
});

describe("removal", () => {
  it("removeAccount deletes the token and the index entry", async () => {
    mockStore.set("jellyfin_accounts", "[]");
    await upsertAccount(makeAccount(), "tok");

    await removeAccount("srv-1", "user-1");

    expect(mockStore.has("jellyfin_account_token_srv-1_user-1")).toBe(false);
    expect(await getSavedAccounts()).toEqual([]);
  });

  it("removeSavedServerAndAccounts cascades to every account on the server", async () => {
    mockStore.set("jellyfin_accounts", "[]");
    mockStore.set("jellyfin_saved_servers", JSON.stringify([savedServer]));
    await upsertAccount(makeAccount(), "tok-a");
    await upsertAccount(makeAccount({ userId: "user-2", userName: "guest", deviceId: "device-b" }), "tok-b");

    await removeSavedServerAndAccounts(savedServer);

    expect(await getSavedAccounts()).toEqual([]);
    expect(mockStore.has("jellyfin_account_token_srv-1_user-1")).toBe(false);
    expect(mockStore.has("jellyfin_account_token_srv-1_user-2")).toBe(false);
    expect(JSON.parse(mockStore.get("jellyfin_saved_servers")!)).toEqual([]);
  });
});

describe("validateAccessToken", () => {
  it("reports invalid only on a definitive 401/403", async () => {
    mockServer({ tokenStatus: 401 });
    expect(await validateAccessToken("http://192.168.1.10:8096", "tok", "dev")).toBe("invalid");

    mockServer({ tokenStatus: 500 });
    expect(await validateAccessToken("http://192.168.1.10:8096", "tok", "dev")).toBe("unreachable");

    mockServer({ reachable: false });
    expect(await validateAccessToken("http://192.168.1.10:8096", "tok", "dev")).toBe("unreachable");
  });
});

describe("activateAccount", () => {
  it("returns needs_login when no token is stored", async () => {
    mockStore.set("jellyfin_accounts", JSON.stringify([makeAccount()]));

    expect(await activateAccount(makeAccount())).toBe("needs_login");
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("adopts a validated account as the active session", async () => {
    mockStore.set("jellyfin_accounts", "[]");
    await upsertAccount(makeAccount(), "tok-a");
    mockServer();

    const result = await activateAccount(makeAccount());

    expect(result).toBe("connected");
    expect(mockStore.get("jellyfin_server_url")).toBe("http://192.168.1.10:8096");
    expect(mockStore.get("jellyfin_api_key")).toBe("tok-a");
    expect(mockStore.get("jellyfin_user_id")).toBe("user-1");
    expect(mockStore.get("jellyfin_device_id")).toBe("device-a");
    expect(mockStore.get("jellyfin_server_id")).toBe("srv-1");
    // The /Users/Me validation carried the account's own device identity.
    const meCall = mockFetch.mock.calls.find(([url]) => (url as string).endsWith("/Users/Me"));
    expect(meCall?.[1].headers.Authorization).toContain('DeviceId="device-a"');
    expect(meCall?.[1].headers.Authorization).toContain('Token="tok-a"');
  });

  it("drops a rejected token but keeps the account metadata", async () => {
    mockStore.set("jellyfin_accounts", "[]");
    await upsertAccount(makeAccount(), "tok-dead");
    mockServer({ tokenStatus: 401 });

    const result = await activateAccount(makeAccount());

    expect(result).toBe("needs_login");
    expect(mockStore.has("jellyfin_account_token_srv-1_user-1")).toBe(false);
    expect(await getSavedAccounts()).toHaveLength(1);
  });

  it("deletes nothing when the server does not answer", async () => {
    mockStore.set("jellyfin_accounts", "[]");
    await upsertAccount(makeAccount(), "tok-a");
    mockServer({ reachable: false });

    const result = await activateAccount(makeAccount());

    expect(result).toBe("unreachable");
    expect(mockStore.get("jellyfin_account_token_srv-1_user-1")).toBe("tok-a");
    expect(mockStore.get("jellyfin_api_key")).toBeUndefined();
  });
});
