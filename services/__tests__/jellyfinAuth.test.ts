import {
  checkServerInfo,
  checkQuickConnectEnabled,
  initiateQuickConnect,
  pollQuickConnect,
  authenticateByName,
  authenticateWithQuickConnect,
  saveAuthResult,
  signOut,
  getStoredUserName,
  getStoredAuthMethod,
  getStoredServerName,
} from "../jellyfinApi";
import * as SecureStore from "expo-secure-store";

// Mock expo-secure-store
jest.mock("expo-secure-store", () => ({
  getItemAsync: jest.fn().mockResolvedValue(null),
  setItemAsync: jest.fn().mockResolvedValue(undefined),
  deleteItemAsync: jest.fn().mockResolvedValue(undefined),
}));

// Mock managers to prevent cache clearing errors in tests
jest.mock("@/services/libraryManager", () => ({
  libraryManager: { clearCache: jest.fn() },
}));

// saveAuthResult arms warmBitrateMemory's delayed probe; unmocked, that timer
// fires mid-suite and leaks a fetch into whatever test is running by then.
jest.mock("@/services/jellyfin/bitrateTest", () => ({
  warmBitrateMemory: jest.fn(),
}));

// Mock global fetch
const mockFetch = jest.fn();
global.fetch = mockFetch;

beforeEach(() => {
  jest.clearAllMocks();
  mockFetch.mockReset();
});

describe("jellyfinAuth", () => {
  describe("checkServerInfo", () => {
    it("should return server info for a valid Jellyfin server", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          ServerName: "My Jellyfin",
          Version: "10.9.0",
          Id: "abc123",
        }),
      });

      const result = await checkServerInfo("http://192.168.1.100:8096");
      expect(result.ServerName).toBe("My Jellyfin");
      expect(result.Version).toBe("10.9.0");
      expect(result.Id).toBe("abc123");
    });

    it("should throw on non-OK response", async () => {
      mockFetch.mockResolvedValueOnce({ ok: false, status: 404 });

      await expect(checkServerInfo("http://bad-server:8096")).rejects.toThrow("Unable to reach Jellyfin server");
    });

    it("should throw on missing ServerName", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ Id: "abc" }),
      });

      await expect(checkServerInfo("http://192.168.1.100:8096")).rejects.toThrow("not a valid Jellyfin server");
    });

    it("should throw on timeout", async () => {
      mockFetch.mockRejectedValueOnce(Object.assign(new Error("AbortError"), { name: "AbortError" }));

      await expect(checkServerInfo("http://192.168.1.100:8096")).rejects.toThrow("Connection timed out");
    });

    it("should strip trailing slashes from server URL", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          ServerName: "Test",
          Version: "10.9.0",
          Id: "abc",
        }),
      });

      await checkServerInfo("http://192.168.1.100:8096///");
      expect(mockFetch).toHaveBeenCalledWith("http://192.168.1.100:8096/System/Info/Public", expect.any(Object));
    });
  });

  describe("checkQuickConnectEnabled", () => {
    it("should return true when Quick Connect is enabled", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        text: async () => "true",
      });

      const result = await checkQuickConnectEnabled("http://192.168.1.100:8096");
      expect(result).toBe(true);
    });

    it("should return false when Quick Connect is disabled", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        text: async () => "false",
      });

      const result = await checkQuickConnectEnabled("http://192.168.1.100:8096");
      expect(result).toBe(false);
    });

    it("should return false on error", async () => {
      mockFetch.mockResolvedValueOnce({ ok: false, status: 500 });

      const result = await checkQuickConnectEnabled("http://192.168.1.100:8096");
      expect(result).toBe(false);
    });

    it("should return false on network failure", async () => {
      mockFetch.mockRejectedValueOnce(new Error("Network error"));

      const result = await checkQuickConnectEnabled("http://192.168.1.100:8096");
      expect(result).toBe(false);
    });
  });

  describe("authenticateByName", () => {
    it("should return auth result on success", async () => {
      // First call: getOrCreateDeviceId may call SecureStore
      (SecureStore.getItemAsync as jest.Mock).mockResolvedValueOnce("test-device-id");

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          AccessToken: "token123",
          User: { Id: "user-id-1", Name: "testuser" },
        }),
      });

      const result = await authenticateByName("http://192.168.1.100:8096", "testuser", "password123");

      expect(result.AccessToken).toBe("token123");
      expect(result.User.Id).toBe("user-id-1");
      expect(result.User.Name).toBe("testuser");
    });

    it("should throw on 401 (invalid credentials)", async () => {
      (SecureStore.getItemAsync as jest.Mock).mockResolvedValueOnce("test-device-id");

      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 401,
      });

      await expect(authenticateByName("http://192.168.1.100:8096", "testuser", "wrongpassword")).rejects.toThrow("Invalid username or password");
    });

    it("should throw on non-OK response", async () => {
      (SecureStore.getItemAsync as jest.Mock).mockResolvedValueOnce("test-device-id");

      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
      });

      await expect(authenticateByName("http://192.168.1.100:8096", "testuser", "pass")).rejects.toThrow("Authentication failed: 500");
    });

    it("should throw on missing AccessToken in response", async () => {
      (SecureStore.getItemAsync as jest.Mock).mockResolvedValueOnce("test-device-id");

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ User: { Id: "user-id", Name: "user" } }),
      });

      await expect(authenticateByName("http://192.168.1.100:8096", "testuser", "pass")).rejects.toThrow("missing AccessToken or User");
    });

    it("should include Authorization header with device info", async () => {
      (SecureStore.getItemAsync as jest.Mock).mockResolvedValueOnce("my-device-id");

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          AccessToken: "tok",
          User: { Id: "uid", Name: "u" },
        }),
      });

      await authenticateByName("http://server:8096", "user", "pass");

      const fetchCall = mockFetch.mock.calls[0];
      expect(fetchCall[0]).toBe("http://server:8096/Users/AuthenticateByName");
      expect(fetchCall[1].headers.Authorization).toContain('DeviceId="my-device-id"');
      expect(fetchCall[1].headers.Authorization).toContain('Client="TomoTV"');
    });
  });

  describe("authenticateWithQuickConnect", () => {
    it("should return auth result on success", async () => {
      (SecureStore.getItemAsync as jest.Mock).mockResolvedValueOnce("test-device-id");

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          AccessToken: "qc-token",
          User: { Id: "qc-user-id", Name: "qcuser" },
        }),
      });

      const result = await authenticateWithQuickConnect("http://192.168.1.100:8096", "secret-123");

      expect(result.AccessToken).toBe("qc-token");
      expect(result.User.Name).toBe("qcuser");
    });

    it("should send secret in request body", async () => {
      (SecureStore.getItemAsync as jest.Mock).mockResolvedValueOnce("test-device-id");

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          AccessToken: "tok",
          User: { Id: "uid", Name: "u" },
        }),
      });

      await authenticateWithQuickConnect("http://server:8096", "my-secret");

      const fetchCall = mockFetch.mock.calls[0];
      expect(fetchCall[0]).toBe("http://server:8096/Users/AuthenticateWithQuickConnect");
      expect(JSON.parse(fetchCall[1].body)).toEqual({
        Secret: "my-secret",
      });
    });
  });

  describe("saveAuthResult", () => {
    it("should save all credential keys to SecureStore", async () => {
      await saveAuthResult("http://192.168.1.100:8096", "access-token", "user-id", "TestUser", "My Server", "password");

      expect(SecureStore.setItemAsync).toHaveBeenCalledWith("jellyfin_server_url", "http://192.168.1.100:8096");
      expect(SecureStore.setItemAsync).toHaveBeenCalledWith("jellyfin_api_key", "access-token");
      expect(SecureStore.setItemAsync).toHaveBeenCalledWith("jellyfin_user_id", "user-id");
      expect(SecureStore.setItemAsync).toHaveBeenCalledWith("jellyfin_user_name", "TestUser");
      expect(SecureStore.setItemAsync).toHaveBeenCalledWith("jellyfin_auth_method", "password");
      expect(SecureStore.setItemAsync).toHaveBeenCalledWith("jellyfin_server_name", "My Server");
    });

    it("should strip trailing slashes from server URL", async () => {
      await saveAuthResult("http://192.168.1.100:8096///", "token", "uid", "User", "Server", "quickconnect");

      expect(SecureStore.setItemAsync).toHaveBeenCalledWith("jellyfin_server_url", "http://192.168.1.100:8096");
    });

    it("should clear demo mode flag", async () => {
      await saveAuthResult("http://server:8096", "token", "uid", "User", "Server", "password");

      expect(SecureStore.deleteItemAsync).toHaveBeenCalledWith("jellyfin_is_demo_mode");
    });

    it("should persist the server system Id when provided", async () => {
      await saveAuthResult("http://server:8096", "token", "uid", "User", "Server", "password", "server-system-id");

      expect(SecureStore.setItemAsync).toHaveBeenCalledWith("jellyfin_server_id", "server-system-id");
    });

    it("should clear any stale server system Id when none is provided", async () => {
      await saveAuthResult("http://server:8096", "token", "uid", "User", "Server", "password");

      expect(SecureStore.setItemAsync).not.toHaveBeenCalledWith("jellyfin_server_id", expect.anything());
      expect(SecureStore.deleteItemAsync).toHaveBeenCalledWith("jellyfin_server_id");
    });
  });

  describe("signOut", () => {
    it("should delete all credential keys from SecureStore", async () => {
      await signOut();

      expect(SecureStore.deleteItemAsync).toHaveBeenCalledWith("jellyfin_server_url");
      expect(SecureStore.deleteItemAsync).toHaveBeenCalledWith("jellyfin_api_key");
      expect(SecureStore.deleteItemAsync).toHaveBeenCalledWith("jellyfin_user_id");
      expect(SecureStore.deleteItemAsync).toHaveBeenCalledWith("jellyfin_user_name");
      expect(SecureStore.deleteItemAsync).toHaveBeenCalledWith("jellyfin_auth_method");
      expect(SecureStore.deleteItemAsync).toHaveBeenCalledWith("jellyfin_server_name");
      expect(SecureStore.deleteItemAsync).toHaveBeenCalledWith("jellyfin_server_id");
      expect(SecureStore.deleteItemAsync).toHaveBeenCalledWith("jellyfin_is_demo_mode");
    });
  });

  describe("getStoredUserName", () => {
    it("should read from SecureStore", async () => {
      (SecureStore.getItemAsync as jest.Mock).mockResolvedValueOnce("TestUser");

      const result = await getStoredUserName();
      expect(result).toBe("TestUser");
      expect(SecureStore.getItemAsync).toHaveBeenCalledWith("jellyfin_user_name");
    });
  });

  describe("getStoredAuthMethod", () => {
    it("should read from SecureStore", async () => {
      (SecureStore.getItemAsync as jest.Mock).mockResolvedValueOnce("quickconnect");

      const result = await getStoredAuthMethod();
      expect(result).toBe("quickconnect");
      expect(SecureStore.getItemAsync).toHaveBeenCalledWith("jellyfin_auth_method");
    });
  });

  describe("getStoredServerName", () => {
    it("should read from SecureStore", async () => {
      (SecureStore.getItemAsync as jest.Mock).mockResolvedValueOnce("My Jellyfin Server");

      const result = await getStoredServerName();
      expect(result).toBe("My Jellyfin Server");
      expect(SecureStore.getItemAsync).toHaveBeenCalledWith("jellyfin_server_name");
    });
  });

  describe("initiateQuickConnect", () => {
    it("should throw on timeout (AbortError)", async () => {
      (SecureStore.getItemAsync as jest.Mock).mockResolvedValueOnce("test-device-id");

      mockFetch.mockRejectedValueOnce(Object.assign(new Error("AbortError"), { name: "AbortError" }));

      await expect(initiateQuickConnect("http://192.168.1.100:8096")).rejects.toThrow("Quick Connect request timed out.");
    });

    it("should throw on non-OK response", async () => {
      (SecureStore.getItemAsync as jest.Mock).mockResolvedValueOnce("test-device-id");

      mockFetch.mockResolvedValueOnce({ ok: false, status: 500 });

      await expect(initiateQuickConnect("http://192.168.1.100:8096")).rejects.toThrow("Quick Connect initiation failed: 500");
    });

    it("should throw on missing Code in response", async () => {
      (SecureStore.getItemAsync as jest.Mock).mockResolvedValueOnce("test-device-id");

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ Secret: "secret-123" }),
      });

      await expect(initiateQuickConnect("http://192.168.1.100:8096")).rejects.toThrow("missing Code or Secret");
    });

    it("should throw on missing Secret in response", async () => {
      (SecureStore.getItemAsync as jest.Mock).mockResolvedValueOnce("test-device-id");

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ Code: "123456" }),
      });

      await expect(initiateQuickConnect("http://192.168.1.100:8096")).rejects.toThrow("missing Code or Secret");
    });

    it("should include Authorization header with device ID", async () => {
      (SecureStore.getItemAsync as jest.Mock).mockResolvedValueOnce("my-device-id");

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ Code: "123456", Secret: "secret-abc" }),
      });

      await initiateQuickConnect("http://server:8096");

      const fetchCall = mockFetch.mock.calls[0];
      expect(fetchCall[0]).toBe("http://server:8096/QuickConnect/Initiate");
      expect(fetchCall[1].method).toBe("POST");
      expect(fetchCall[1].headers.Authorization).toContain('DeviceId="my-device-id"');
      expect(fetchCall[1].headers.Authorization).toContain('Client="TomoTV"');
    });
  });

  describe("pollQuickConnect", () => {
    it("should throw on timeout (AbortError)", async () => {
      mockFetch.mockRejectedValueOnce(Object.assign(new Error("AbortError"), { name: "AbortError" }));

      await expect(pollQuickConnect("http://192.168.1.100:8096", "secret-123")).rejects.toThrow("Quick Connect poll timed out.");
    });

    it("should throw on non-OK response", async () => {
      mockFetch.mockResolvedValueOnce({ ok: false, status: 404 });

      await expect(pollQuickConnect("http://192.168.1.100:8096", "secret-123")).rejects.toThrow("Quick Connect poll failed: 404");
    });

    it("should encode secret in query string", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          Code: "123456",
          Secret: "secret&special=chars",
          Authenticated: false,
        }),
      });

      await pollQuickConnect("http://server:8096", "secret&special=chars");

      const fetchCall = mockFetch.mock.calls[0];
      expect(fetchCall[0]).toBe("http://server:8096/QuickConnect/Connect?secret=secret%26special%3Dchars");
      expect(fetchCall[1].method).toBe("GET");
    });

    it("should return result with Authenticated flag", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          Code: "123456",
          Secret: "secret-abc",
          Authenticated: true,
        }),
      });

      const result = await pollQuickConnect("http://server:8096", "secret-abc");

      expect(result.Authenticated).toBe(true);
      expect(result.Secret).toBe("secret-abc");
    });
  });
});
