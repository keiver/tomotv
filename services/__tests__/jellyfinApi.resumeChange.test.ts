/**
 * Tests for the resume-change signal backing the Continue Watching row's refetch:
 * subscribeResumeChange must fire after every server write that rewrites resume
 * state (UserData persist, playback Stopped), because a Resume query answered by
 * the server DURING Sessions/Stopped processing transiently omits the item — the
 * row refetches on this signal, which always trails the completed write.
 */
import { clearResumePosition, refreshConfig, reportPlaybackStopped, subscribeResumeChange, updateUserItemData } from "../jellyfinApi";
import { clearResumeCache, getResumeOverrides } from "../resumeCache";

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

describe("resume-change signal", () => {
  const mockSecureStore = require("expo-secure-store");

  beforeEach(async () => {
    global.fetch = jest.fn();
    clearResumeCache();

    mockSecureStore.getItemAsync.mockImplementation((key: string) => {
      const mockConfig: Record<string, string> = {
        jellyfin_server_url: "http://192.168.1.100:8096",
        jellyfin_api_key: "test-api-key",
        jellyfin_user_id: "test-user-id",
        jellyfin_device_id: "test-device-id",
      };
      return Promise.resolve(mockConfig[key] || null);
    });

    // getConfig serves its in-memory cache; force it to re-read this suite's credentials
    await refreshConfig();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("fires after a successful UserData persist", async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce({ ok: true, status: 200 });
    const listener = jest.fn();
    const unsubscribe = subscribeResumeChange(listener);

    await updateUserItemData("item-1", { PlaybackPositionTicks: 100, Played: true });

    expect(listener).toHaveBeenCalledTimes(1);
    expect(getResumeOverrides().get("item-1")).toBe(100);
    unsubscribe();
  });

  it("does not fire when the persist failed (no server state change to refetch)", async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce({ ok: false, status: 500 });
    const listener = jest.fn();
    const unsubscribe = subscribeResumeChange(listener);

    await updateUserItemData("item-1", { PlaybackPositionTicks: 100 });

    expect(listener).not.toHaveBeenCalled();
    expect(getResumeOverrides().has("item-1")).toBe(false);
    unsubscribe();
  });

  it("fires after a playback Stopped report", async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce({ ok: true, status: 204 });
    const listener = jest.fn();
    const unsubscribe = subscribeResumeChange(listener);

    await reportPlaybackStopped({
      ItemId: "item-1",
      MediaSourceId: "item-1",
      PlaySessionId: "session-1",
      PositionTicks: 100,
      IsPaused: false,
      PlayMethod: "DirectStream",
      CanSeek: true,
    });

    expect(listener).toHaveBeenCalledTimes(1);
    unsubscribe();
  });

  it("records a cleared resume point as 0 before firing", async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce({ ok: true, status: 204 });
    const seen: (number | undefined)[] = [];
    const unsubscribe = subscribeResumeChange(() => seen.push(getResumeOverrides().get("item-1")));

    await clearResumePosition("item-1");

    expect((global.fetch as jest.Mock).mock.calls[0][1].method).toBe("DELETE");
    expect(seen).toEqual([0]);
    unsubscribe();
  });

  it("stops firing after unsubscribe", async () => {
    (global.fetch as jest.Mock).mockResolvedValue({ ok: true, status: 200 });
    const listener = jest.fn();
    const unsubscribe = subscribeResumeChange(listener);
    unsubscribe();

    await updateUserItemData("item-1", { PlaybackPositionTicks: 100 });

    expect(listener).not.toHaveBeenCalled();
  });
});
