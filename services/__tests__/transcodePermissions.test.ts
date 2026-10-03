/** The account's transcoding permissions: read from the server's policy, dropped across a server switch, kept on a failed read. */
import { getTranscodePermissions, refreshTranscodePermissions, subscribeTranscodePermissions } from "@/services/jellyfin/transcodePermissions";
import { fetchWithTimeout } from "@/services/jellyfin/http";
import { getConfig } from "@/services/jellyfin/session";

jest.mock("@/utils/logger", () => ({ logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() } }));
jest.mock("@/services/jellyfin/http", () => ({ fetchWithTimeout: jest.fn() }));
jest.mock("@/services/jellyfin/session", () => ({
  getConfig: jest.fn(),
  getAuthHeader: () => 'MediaBrowser Token="k"',
}));

const mockFetch = fetchWithTimeout as jest.Mock;
const mockConfig = getConfig as jest.Mock;

const policy = (video: boolean, audio: boolean) => ({ ok: true, json: async () => ({ Policy: { EnableVideoPlaybackTranscoding: video, EnableAudioPlaybackTranscoding: audio } }) });

describe("transcodePermissions", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockConfig.mockResolvedValue({ server: "http://a:8096", apiKey: "k", deviceId: "d" });
  });

  it("reads both permissions off the account policy and tells subscribers", async () => {
    const listener = jest.fn();
    const unsubscribe = subscribeTranscodePermissions(listener);
    mockFetch.mockResolvedValue(policy(false, true));
    await refreshTranscodePermissions();
    expect(mockFetch.mock.calls[0][0]).toBe("http://a:8096/Users/Me");
    expect(getTranscodePermissions()).toEqual({ server: "http://a:8096", video: false, audio: true });
    expect(listener).toHaveBeenCalled();
    unsubscribe();
  });

  it("keeps the last answer when the server cannot be read", async () => {
    mockFetch.mockRejectedValue(new Error("offline"));
    await refreshTranscodePermissions();
    expect(getTranscodePermissions()).toEqual({ server: "http://a:8096", video: false, audio: true });
  });

  it("forgets the previous server's answer before asking the next", async () => {
    mockConfig.mockResolvedValue({ server: "http://b:8096", apiKey: "k", deviceId: "d" });
    const seen: unknown[] = [];
    const unsubscribe = subscribeTranscodePermissions(() => seen.push(getTranscodePermissions()));
    mockFetch.mockResolvedValue(policy(true, true));
    await refreshTranscodePermissions();
    expect(seen).toEqual([null, { server: "http://b:8096", video: true, audio: true }]);
    unsubscribe();
  });

  it("has no answer without a signed-in server", async () => {
    mockConfig.mockResolvedValue({ server: "", apiKey: "" });
    await refreshTranscodePermissions();
    expect(getTranscodePermissions()).toBeNull();
    expect(mockFetch).not.toHaveBeenCalled();
  });
});
