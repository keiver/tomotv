/**
 * Live TV client: the channel list, opening a channel as raw direct play on the address the
 * app signed into (never the server's own bind address), and releasing the tuner.
 */
import { closeLiveStream, fetchChannels, openChannel, refreshConfig } from "../jellyfinApi";
import { liveStreamUrlFor } from "../jellyfin/liveTv";

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

const SERVER = "http://192.168.1.100:8096";

describe("live TV client", () => {
  const mockSecureStore = require("expo-secure-store");

  beforeEach(async () => {
    global.fetch = jest.fn();
    mockSecureStore.getItemAsync.mockImplementation((key: string) => {
      const mockConfig: Record<string, string> = {
        jellyfin_server_url: SERVER,
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

  it("rebuilds the server's bind-address Path on the configured server", () => {
    expect(liveStreamUrlFor(SERVER, "k", "http://172.17.0.2:8096/LiveTv/LiveStreamFiles/abc/stream.ts")).toBe(`${SERVER}/LiveTv/LiveStreamFiles/abc/stream.ts?ApiKey=k`);
    expect(liveStreamUrlFor(SERVER, "k", "/LiveTv/LiveStreamFiles/abc/stream.ts")).toBe(`${SERVER}/LiveTv/LiveStreamFiles/abc/stream.ts?ApiKey=k`);
    expect(liveStreamUrlFor(SERVER, "k", "LiveTv/x/stream.ts?a=1")).toBe(`${SERVER}/LiveTv/x/stream.ts?a=1&ApiKey=k`);
  });

  it("lists channels with their current program", async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ Items: [{ Id: "c1", Name: "One", Type: "TvChannel", CurrentProgram: { Name: "News" } }], TotalRecordCount: 1 }),
    });
    const result = await fetchChannels();
    expect(result).toEqual({ items: [{ Id: "c1", Name: "One", Type: "TvChannel", CurrentProgram: { Name: "News" } }], total: 1 });
    const [url] = (global.fetch as jest.Mock).mock.calls[0];
    expect(url).toContain(`${SERVER}/LiveTv/Channels?`);
    expect(url).toContain("addCurrentProgram=true");
    expect(url).toContain("userId=test-user-id");
  });

  it("opens a channel as raw direct play and returns the ids the session needs", async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        PlaySessionId: "ps-1",
        MediaSources: [
          {
            Id: "ms-1",
            Container: "ts",
            Path: "http://172.17.0.2:8096/LiveTv/LiveStreamFiles/abc/stream.ts",
            IsInfiniteStream: true,
            SupportsDirectPlay: true,
            LiveStreamId: "ls-1",
            MediaStreams: [
              { Type: "Video", Codec: "mpeg2video" },
              { Type: "Audio", Codec: "mp2" },
            ],
          },
        ],
      }),
    });
    const channel = await openChannel("c1", { Id: "c1", Name: "One", Type: "TvChannel", Path: "" });
    expect(channel.liveStreamUrl).toBe(`${SERVER}/LiveTv/LiveStreamFiles/abc/stream.ts?ApiKey=test-api-key`);
    expect(channel.LiveStreamId).toBe("ls-1");
    expect(channel.PlaySessionId).toBe("ps-1");
    expect(channel.MediaStreams).toHaveLength(2);

    const [url, init] = (global.fetch as jest.Mock).mock.calls[0];
    expect(url).toBe(`${SERVER}/Items/c1/PlaybackInfo?UserId=test-user-id`);
    expect(init.method).toBe("POST");
    const body = JSON.parse(init.body);
    expect(body.AutoOpenLiveStream).toBe(true);
    expect(body.EnableDirectPlay).toBe(true);
    expect(body.EnableTranscoding).toBe(false);
    const video = body.DeviceProfile.DirectPlayProfiles.find((profile: { Type: string }) => profile.Type === "Video");
    expect(video.Container).toBe("ts,mpegts");
    // Everything the engine copies or decodes is declared, so the server hands the raw stream over.
    for (const codec of ["h264", "hevc", "mpeg2video", "av1"]) expect(video.VideoCodec.split(",")).toContain(codec);
    for (const codec of ["mp2", "ac3", "eac3", "aac"]) expect(video.AudioCodec.split(",")).toContain(codec);
    expect(body.DeviceProfile.TranscodingProfiles).toEqual([]);
  });

  it("refuses a channel the server will not hand over as direct play", async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ MediaSources: [{ Id: "ms-1", SupportsDirectPlay: false, TranscodingUrl: "/videos/x/master.m3u8" }] }),
    });
    await expect(openChannel("c1", { Id: "c1", Name: "One", Type: "TvChannel", Path: "" })).rejects.toThrow("did not open One for direct play");
  });

  it("closes a live stream by query parameter and swallows failures", async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce({ ok: true });
    await closeLiveStream("ls-1");
    const [url, init] = (global.fetch as jest.Mock).mock.calls[0];
    expect(url).toBe(`${SERVER}/LiveStreams/Close?liveStreamId=ls-1`);
    expect(init.method).toBe("POST");

    (global.fetch as jest.Mock).mockRejectedValueOnce(new Error("offline"));
    await expect(closeLiveStream("ls-2")).resolves.toBeUndefined();

    await closeLiveStream(null);
    expect((global.fetch as jest.Mock).mock.calls).toHaveLength(2);
  });
});
