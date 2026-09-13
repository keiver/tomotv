/**
 * Live TV client: the channel list, opening a channel as raw direct play on the address the
 * app signed into (never the server's own bind address), and releasing the tuner.
 */
import { closeLiveStream, fetchChannels, openChannel, refreshConfig, warmChannel } from "../jellyfinApi";
import { liveStreamUrlFor, topVariantUrl } from "../jellyfin/liveTv";

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
    expect(url).not.toContain("startIndex=");
  });

  it("asks for one page of channels when a page is named", async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce({ ok: true, json: async () => ({ Items: [], TotalRecordCount: 130 }) });
    const result = await fetchChannels({ startIndex: 60, limit: 60 });
    expect(result).toEqual({ items: [], total: 130 });
    const [url] = (global.fetch as jest.Mock).mock.calls[0];
    expect(url).toContain("startIndex=60");
    expect(url).toContain("limit=60");
    expect(url).toContain("enableTotalRecordCount=true");
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
    expect(body.EnableTranscoding).toBe(true);
    const video = body.DeviceProfile.DirectPlayProfiles.find((profile: { Type: string }) => profile.Type === "Video");
    expect(video.Container).toBe("ts,mpegts");
    // Everything the engine copies or decodes is declared, so the server hands the raw stream over.
    for (const codec of ["h264", "hevc", "mpeg2video", "av1"]) expect(video.VideoCodec.split(",")).toContain(codec);
    for (const codec of ["mp2", "ac3", "eac3", "aac"]) expect(video.AudioCodec.split(",")).toContain(codec);
    // The one profile the server answers with a TranscodingUrl: live HLS is TS-only on Jellyfin.
    expect(body.DeviceProfile.TranscodingProfiles).toEqual([{ Type: "Video", Container: "ts", Protocol: "hls", VideoCodec: "h264,hevc", AudioCodec: "aac,ac3,eac3", Context: "Streaming" }]);
    expect(channel.liveTranscodeUrl).toBeUndefined();
  });

  it("carries the server's transcode URL beside the engine's input", async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        PlaySessionId: "ps-3",
        MediaSources: [
          {
            Id: "ms-3",
            Container: "ts",
            Path: "/LiveTv/LiveStreamFiles/abc/stream.ts",
            IsInfiniteStream: true,
            SupportsDirectPlay: true,
            SupportsTranscoding: true,
            TranscodingUrl: "/videos/c3/master.m3u8?PlaySessionId=ps-3&ApiKey=test-api-key&LiveStreamId=ls-3",
            LiveStreamId: "ls-3",
            MediaStreams: [],
          },
        ],
      }),
    });
    const channel = await openChannel("c3", { Id: "c3", Name: "Three", Type: "TvChannel", Path: "" });
    expect(channel.liveStreamUrl).toBe(`${SERVER}/LiveTv/LiveStreamFiles/abc/stream.ts?ApiKey=test-api-key`);
    expect(channel.liveTranscodeUrl).toBe(`${SERVER}/videos/c3/master.m3u8?PlaySessionId=ps-3&ApiKey=test-api-key&LiveStreamId=ls-3`);
  });

  it("reads an HLS channel from its origin with the tuner's headers, direct play or not", async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        PlaySessionId: "ps-2",
        MediaSources: [
          {
            Id: "ms-2",
            Container: "hls",
            Protocol: "Http",
            Path: "https://origin.example/live/playlist.m3u8",
            IsInfiniteStream: true,
            SupportsDirectPlay: false,
            SupportsDirectStream: false,
            LiveStreamId: "ls-2",
            RequiredHttpHeaders: { "User-Agent": "Mozilla/5.0" },
            MediaStreams: [{ Type: "Video", Codec: "h264" }],
          },
        ],
      }),
    });
    // The master, read with the tuner's headers: the engine opens its top variant alone.
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      text: async () => "#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=800000,RESOLUTION=640x360\nlow/index.m3u8\n#EXT-X-STREAM-INF:BANDWIDTH=3200000,RESOLUTION=1920x1080\nhigh/index.m3u8\n",
    });
    const channel = await openChannel("c2", { Id: "c2", Name: "Two", Type: "TvChannel", Path: "" });
    expect(channel.liveStreamUrl).toBe("https://origin.example/live/high/index.m3u8");
    expect(channel.liveHttpHeaders).toEqual({ "User-Agent": "Mozilla/5.0" });
    expect(channel.LiveStreamId).toBe("ls-2");
    const [masterUrl, masterInit] = (global.fetch as jest.Mock).mock.calls[1];
    expect(masterUrl).toBe("https://origin.example/live/playlist.m3u8");
    expect(masterInit.headers).toEqual({ "User-Agent": "Mozilla/5.0" });
  });

  it("opens the whole master when its top variant cannot be read or hangs audio off a group", async () => {
    const source = {
      Id: "ms-2",
      Container: "hls",
      Protocol: "Http",
      Path: "https://origin.example/live/playlist.m3u8",
      IsInfiniteStream: true,
      SupportsDirectPlay: false,
      LiveStreamId: "ls-2",
      MediaStreams: [],
    };
    (global.fetch as jest.Mock).mockResolvedValueOnce({ ok: true, json: async () => ({ MediaSources: [source] }) });
    (global.fetch as jest.Mock).mockRejectedValueOnce(new Error("timed out"));
    expect((await openChannel("c2", { Id: "c2", Name: "Two", Type: "TvChannel", Path: "" })).liveStreamUrl).toBe("https://origin.example/live/playlist.m3u8");

    expect(topVariantUrl('#EXTM3U\n#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="a"\n#EXT-X-STREAM-INF:BANDWIDTH=1,AUDIO="a"\nv.m3u8\n', "https://o/x/m.m3u8")).toBeNull();
    expect(topVariantUrl("#EXTM3U\n#EXT-X-TARGETDURATION:6\n#EXTINF:6,\nseg0.ts\n", "https://o/x/m.m3u8")).toBeNull();
    expect(topVariantUrl("#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=5\nhttps://cdn/abs.m3u8\n#EXT-X-STREAM-INF:BANDWIDTH=9\n../hi.m3u8\n", "https://o/x/m.m3u8")).toBe("https://o/hi.m3u8");
  });

  it("warms a channel once, and not again inside the window", async () => {
    (global.fetch as jest.Mock).mockResolvedValue({ ok: true, json: async () => ({}) });
    await warmChannel("c9");
    await warmChannel("c9");
    const opens = (global.fetch as jest.Mock).mock.calls.filter(([url]) => String(url).includes("/Items/c9/PlaybackInfo"));
    expect(opens).toHaveLength(1);
    expect(JSON.parse(opens[0][1].body).EnableTranscoding).toBe(true);
  });

  it("opens a channel on the server's transcode alone when the engine gets nothing to read", async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ MediaSources: [{ Id: "ms-1", SupportsDirectPlay: false, SupportsTranscoding: true, TranscodingUrl: "/videos/x/master.m3u8", LiveStreamId: "ls-x" }] }),
    });
    const channel = await openChannel("c1", { Id: "c1", Name: "One", Type: "TvChannel", Path: "" });
    expect(channel.liveStreamUrl).toBeUndefined();
    expect(channel.liveTranscodeUrl).toBe(`${SERVER}/videos/x/master.m3u8`);
    expect(channel.LiveStreamId).toBe("ls-x");
  });

  it("refuses a channel the server neither hands over nor transcodes", async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ ErrorCode: "NoCompatibleStream", MediaSources: [{ Id: "ms-1", SupportsDirectPlay: false, SupportsTranscoding: false }] }),
    });
    await expect(openChannel("c1", { Id: "c1", Name: "One", Type: "TvChannel", Path: "" })).rejects.toThrow("did not open One (NoCompatibleStream)");
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

describe("guide and DVR calls", () => {
  const mockSecureStore = require("expo-secure-store");
  const {
    cancelSeriesTimer,
    cancelTimer,
    createSeriesTimer,
    createTimer,
    fetchGuidePrograms,
    fetchProgram,
    fetchRecordings,
    fetchSeriesTimers,
    fetchTimerDefaults,
    fetchTimers,
  } = require("../jellyfinApi");

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

  const ok = (payload: unknown) => (global.fetch as jest.Mock).mockResolvedValueOnce({ ok: true, json: async () => payload });

  it("asks for the window's programs by start time, images and user data off", async () => {
    ok({ Items: [{ Id: "p1", Name: "News", ChannelId: "c1" }] });
    const programs = await fetchGuidePrograms({ channelIds: ["c1", "c2"], startMs: Date.UTC(2026, 8, 12, 4), endMs: Date.UTC(2026, 8, 12, 10) });
    expect(programs).toEqual([{ Id: "p1", Name: "News", ChannelId: "c1" }]);
    const [url, init] = (global.fetch as jest.Mock).mock.calls[0];
    expect(url).toBe(`${SERVER}/LiveTv/Programs`);
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body)).toEqual({
      UserId: "test-user-id",
      ChannelIds: ["c1", "c2"],
      MinEndDate: "2026-09-12T04:00:00.000Z",
      MaxStartDate: "2026-09-12T10:00:00.000Z",
      SortBy: ["StartDate"],
      EnableImages: false,
      EnableUserData: false,
      EnableTotalRecordCount: false,
      Fields: ["ChannelInfo"],
    });
  });

  it("leaves the channel filter out when every channel is wanted", async () => {
    ok({ Items: [] });
    await fetchGuidePrograms({ channelIds: [], startMs: 0, endMs: 1 });
    expect(JSON.parse((global.fetch as jest.Mock).mock.calls[0][1].body)).not.toHaveProperty("ChannelIds");
  });

  it("reads one program and the finished recordings", async () => {
    ok({ Id: "p3", Name: "Movie" });
    expect(await fetchProgram("p3")).toEqual({ Id: "p3", Name: "Movie" });
    expect((global.fetch as jest.Mock).mock.calls[0][0]).toBe(`${SERVER}/LiveTv/Programs/p3?userId=test-user-id&fields=PrimaryImageAspectRatio`);

    ok({ Items: [{ Id: "r1" }], TotalRecordCount: 1 });
    expect(await fetchRecordings()).toEqual({ items: [{ Id: "r1" }], total: 1 });
    expect((global.fetch as jest.Mock).mock.calls[1][0]).toContain(`${SERVER}/LiveTv/Recordings?userId=test-user-id`);
  });

  it("creates a timer or a series rule from the same defaults and cancels either by id", async () => {
    ok({ ProgramId: "p1", Name: "News", Type: "SeriesTimer" });
    const defaults = await fetchTimerDefaults("p1");
    expect((global.fetch as jest.Mock).mock.calls[0][0]).toBe(`${SERVER}/LiveTv/Timers/Defaults?programId=p1`);

    ok(undefined);
    await createTimer(defaults);
    expect((global.fetch as jest.Mock).mock.calls[1][0]).toBe(`${SERVER}/LiveTv/Timers`);
    expect((global.fetch as jest.Mock).mock.calls[1][1].method).toBe("POST");
    expect(JSON.parse((global.fetch as jest.Mock).mock.calls[1][1].body)).toEqual(defaults);

    ok(undefined);
    await createSeriesTimer(defaults);
    expect((global.fetch as jest.Mock).mock.calls[2][0]).toBe(`${SERVER}/LiveTv/SeriesTimers`);

    ok(undefined);
    await cancelTimer("t1");
    expect((global.fetch as jest.Mock).mock.calls[3][0]).toBe(`${SERVER}/LiveTv/Timers/t1`);
    expect((global.fetch as jest.Mock).mock.calls[3][1].method).toBe("DELETE");

    ok(undefined);
    await cancelSeriesTimer("s1");
    expect((global.fetch as jest.Mock).mock.calls[4][0]).toBe(`${SERVER}/LiveTv/SeriesTimers/s1`);
    expect((global.fetch as jest.Mock).mock.calls[4][1].method).toBe("DELETE");
  });

  it("lists timers and series rules", async () => {
    ok({ Items: [{ Id: "t1", Name: "News", StartDate: "2026-09-12T02:30:00Z", EndDate: "2026-09-12T04:30:00Z", Status: "InProgress" }] });
    expect(await fetchTimers()).toHaveLength(1);
    expect((global.fetch as jest.Mock).mock.calls[0][0]).toBe(`${SERVER}/LiveTv/Timers`);
    ok({ Items: [{ Id: "s1", Name: "Cartoons" }] });
    expect(await fetchSeriesTimers()).toEqual([{ Id: "s1", Name: "Cartoons" }]);
    expect((global.fetch as jest.Mock).mock.calls[1][0]).toBe(`${SERVER}/LiveTv/SeriesTimers`);
  });

  it("surfaces a refused request", async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce({ ok: false, status: 500, json: async () => ({}) });
    await expect(fetchTimers()).rejects.toThrow();
  });
});
