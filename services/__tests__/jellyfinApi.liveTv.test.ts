/**
 * Live TV client: the channel list, opening a channel as raw direct play on the address the
 * app signed into (never the server's own bind address), and releasing the tuner.
 */
import {
  closeLiveStream,
  closeWarmedChannels,
  fetchChannels,
  isServerLaneChannel,
  openChannel,
  refreshConfig,
  resolveChannel,
  resolveChannelOrigin,
  warmChannel,
  warmedChannelCount,
  warmedStreamUrl,
} from "../jellyfinApi";
import { dashProtection, drmKeyFormat, liveStreamUrlFor, topVariantUrl } from "../jellyfin/liveTv";

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

  it("tells real DRM from a plain AES-128 key", () => {
    expect(drmKeyFormat('#EXTM3U\n#EXT-X-KEY:METHOD=AES-128,URI="https://k/1.key",IV=0x00\n')).toBeNull();
    expect(drmKeyFormat('#EXTM3U\n#EXT-X-KEY:METHOD=AES-128,URI="k.key",KEYFORMAT="identity"\n')).toBeNull();
    expect(drmKeyFormat("#EXTM3U\n#EXT-X-KEY:METHOD=NONE\n")).toBeNull();
    expect(drmKeyFormat('#EXTM3U\n#EXT-X-KEY:METHOD=SAMPLE-AES,URI="skd://x",KEYFORMAT="com.apple.streamingkeydelivery",KEYFORMATVERSIONS="1"\n')).toBe("com.apple.streamingkeydelivery");
    expect(drmKeyFormat('#EXTM3U\n#EXT-X-SESSION-KEY:METHOD=SAMPLE-AES-CTR,URI="data:x",KEYFORMAT="urn:uuid:edef8ba9-79d6-4ace-a3c8-27dcd51d21ed"\n')).toBe(
      "urn:uuid:edef8ba9-79d6-4ace-a3c8-27dcd51d21ed",
    );
    expect(drmKeyFormat('#EXT-X-KEY:METHOD=SAMPLE-AES,URI="k"\n')).toBe("SAMPLE-AES");
  });

  it("names the DRM system an MPD declares", () => {
    expect(dashProtection('<MPD><Period><AdaptationSet><Representation id="v"/></AdaptationSet></Period></MPD>')).toBeNull();
    expect(
      dashProtection(
        '<MPD><AdaptationSet><ContentProtection schemeIdUri="urn:mpeg:dash:mp4protection:2011" value="cenc" cenc:default_KID="x"/><ContentProtection schemeIdUri="urn:uuid:edef8ba9-79d6-4ace-a3c8-27dcd51d21ed"/></AdaptationSet></MPD>',
      ),
    ).toBe("cenc");
    expect(dashProtection('<MPD><ContentProtection schemeIdUri="urn:uuid:9a04f079-9840-4286-ab92-e65be0885f95"></ContentProtection></MPD>')).toBe("urn:uuid:9a04f079-9840-4286-ab92-e65be0885f95");
  });

  it("opens a DASH channel on its MPD whole, with the tuner's headers", async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        MediaSources: [
          {
            Id: "ms-5",
            Protocol: "Http",
            Path: "https://origin.example/live/Manifest.mpd",
            IsInfiniteStream: true,
            SupportsDirectPlay: false,
            LiveStreamId: "ls-5",
            RequiredHttpHeaders: { "User-Agent": "Mozilla/5.0" },
            MediaStreams: [],
          },
        ],
      }),
    });
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      text: async () => '<?xml version="1.0"?>\n<MPD type="dynamic"><Period><AdaptationSet><Representation id="V300" bandwidth="300000"/></AdaptationSet></Period></MPD>',
    });
    const channel = await openChannel("c5", { Id: "c5", Name: "Five", Type: "TvChannel", Path: "" });
    expect(channel.liveStreamUrl).toBe("https://origin.example/live/Manifest.mpd");
    expect(channel.liveHttpHeaders).toEqual({ "User-Agent": "Mozilla/5.0" });
    expect((global.fetch as jest.Mock).mock.calls).toHaveLength(2);
  });

  it("refuses a DRM DASH channel at the open and releases the tuner", async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ MediaSources: [{ Id: "ms-6", Protocol: "Http", Path: "https://origin.example/drm/Manifest.mpd", SupportsDirectPlay: false, LiveStreamId: "ls-6", MediaStreams: [] }] }),
    });
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      text: async () => '<MPD><Period><AdaptationSet><ContentProtection schemeIdUri="urn:mpeg:dash:mp4protection:2011" value="cenc"/></AdaptationSet></Period></MPD>',
    });
    (global.fetch as jest.Mock).mockResolvedValueOnce({ ok: true });
    await expect(openChannel("c6", { Id: "c6", Name: "Six", Type: "TvChannel", Path: "" })).rejects.toThrow("DRM protected (cenc)");
    expect(String((global.fetch as jest.Mock).mock.calls[2][0])).toBe(`${SERVER}/LiveStreams/Close?liveStreamId=ls-6`);
  });

  it("refuses a DRM channel at the open and releases the tuner, before any lane runs", async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        MediaSources: [
          { Id: "ms-4", Container: "hls", Protocol: "Http", Path: "https://origin.example/drm/master.m3u8", IsInfiniteStream: true, SupportsDirectPlay: false, LiveStreamId: "ls-4", MediaStreams: [] },
        ],
      }),
    });
    (global.fetch as jest.Mock).mockResolvedValueOnce({ ok: true, url: "https://cdn.example/drm/master.m3u8", text: async () => "#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=3000000\nhigh.m3u8\n" });
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      text: async () => '#EXTM3U\n#EXT-X-KEY:METHOD=SAMPLE-AES,URI="skd://k",KEYFORMAT="com.apple.streamingkeydelivery"\n#EXTINF:6,\ns0.ts\n',
    });
    (global.fetch as jest.Mock).mockResolvedValueOnce({ ok: true });
    await expect(openChannel("c4", { Id: "c4", Name: "Four", Type: "TvChannel", Path: "" })).rejects.toThrow("DRM protected (com.apple.streamingkeydelivery)");
    const calls = (global.fetch as jest.Mock).mock.calls.map(([url]) => String(url));
    // The variant resolved against the master's landing URL, not the shortlink it was asked for.
    expect(calls[2]).toBe("https://cdn.example/drm/high.m3u8");
    expect(calls[3]).toBe(`${SERVER}/LiveStreams/Close?liveStreamId=ls-4`);
  });

  it("warms a channel once, and not again inside the window", async () => {
    (global.fetch as jest.Mock).mockResolvedValue({ ok: true, json: async () => ({}) });
    await warmChannel("c9");
    await warmChannel("c9");
    const opens = (global.fetch as jest.Mock).mock.calls.filter(([url]) => String(url).includes("/Items/c9/PlaybackInfo"));
    expect(opens).toHaveLength(1);
    expect(JSON.parse(opens[0][1].body).EnableTranscoding).toBe(true);
  });

  it("keeps a warm open's stream URL on the configured server until the open closes", async () => {
    (global.fetch as jest.Mock).mockImplementation(async (url: string) => {
      const channel = /\/Items\/(c\d+)\/PlaybackInfo/.exec(String(url))?.[1];
      return { ok: true, json: async () => (channel ? { MediaSources: [{ LiveStreamId: `ls-${channel}`, Path: "http://172.17.0.2:8096/LiveTv/LiveStreamFiles/ls-c30/stream.ts" }] } : {}) };
    });
    await warmChannel("c30");
    expect(warmedStreamUrl("c30")).toBe(`${SERVER}/LiveTv/LiveStreamFiles/ls-c30/stream.ts?ApiKey=test-api-key`);
    expect(warmedChannelCount()).toBe(1);
    await closeWarmedChannels();
    expect(warmedStreamUrl("c30")).toBeUndefined();
    expect(warmedChannelCount()).toBe(0);
  });

  it("resolves a manifest channel's origin for a frame grab without opening it, and no origin for a tuner channel", async () => {
    (global.fetch as jest.Mock).mockImplementation(async (url: string) => {
      if (url.includes("/Items/c40/PlaybackInfo")) {
        return {
          ok: true,
          json: async () => ({ MediaSources: [{ Protocol: "Http", Container: "hls", Path: "https://origin.example/live/master.m3u8", RequiredHttpHeaders: { "User-Agent": "Tuner" } }] }),
        };
      }
      if (url.includes("/Items/c41/PlaybackInfo")) {
        return { ok: true, json: async () => ({ MediaSources: [{ Protocol: "Http", Container: "ts", Path: "http://172.17.0.2:8096/LiveTv/LiveStreamFiles/x/stream.ts" }] }) };
      }
      return { ok: true, url, text: async () => "#EXTM3U\n#EXTINF:6,\nseg1.ts\n" };
    });
    expect(await resolveChannelOrigin("c40")).toEqual({ url: "https://origin.example/live/master.m3u8", headers: { "User-Agent": "Tuner" } });
    expect(await resolveChannelOrigin("c41")).toBeNull();
    const calls = (global.fetch as jest.Mock).mock.calls;
    expect(calls.filter(([, init]) => init?.method === "POST")).toHaveLength(0);
    expect(calls.filter(([url]) => String(url).includes("/LiveStreams/"))).toHaveLength(0);
    expect(calls.filter(([url]) => String(url).includes("origin.example"))).toHaveLength(0);
  });

  it("closes every warm open it is not told to keep, and warms a closed channel again", async () => {
    (global.fetch as jest.Mock).mockImplementation(async (url: string) => {
      const channel = /\/Items\/(c\d+)\/PlaybackInfo/.exec(String(url))?.[1];
      return { ok: true, json: async () => (channel ? { MediaSources: [{ LiveStreamId: `ls-${channel}` }] } : {}) };
    });
    await warmChannel("c20");
    await warmChannel("c21");
    await closeWarmedChannels(["c21"]);
    let closes = (global.fetch as jest.Mock).mock.calls.map(([url]) => String(url)).filter((url) => url.includes("/LiveStreams/Close"));
    expect(closes).toEqual([`${SERVER}/LiveStreams/Close?liveStreamId=ls-c20`]);
    await warmChannel("c20");
    const opens = (global.fetch as jest.Mock).mock.calls.filter(([url]) => String(url).includes("/Items/c20/PlaybackInfo"));
    expect(opens).toHaveLength(2);
    await closeWarmedChannels();
    closes = (global.fetch as jest.Mock).mock.calls.map(([url]) => String(url)).filter((url) => url.includes("/LiveStreams/Close"));
    expect(closes).toHaveLength(3);
  });

  it("closes a warm open that lands after its owner left, and keeps one asked for again before it lands", async () => {
    const pending = new Map<string, (value: unknown) => void>();
    (global.fetch as jest.Mock).mockImplementation((url: string) => {
      const channel = /\/Items\/(c\d+)\/PlaybackInfo/.exec(String(url))?.[1];
      return channel ? new Promise((resolve) => pending.set(channel, resolve)) : Promise.resolve({ ok: true });
    });
    const landed = (channel: string) => pending.get(channel)!({ ok: true, json: async () => ({ MediaSources: [{ LiveStreamId: `ls-${channel}` }] }) });
    const closes = () => (global.fetch as jest.Mock).mock.calls.map(([url]) => String(url)).filter((url) => url.includes("/LiveStreams/Close"));

    const late = warmChannel("c30");
    const kept = warmChannel("c31");
    await Promise.resolve();
    await closeWarmedChannels();
    await warmChannel("c31");
    landed("c30");
    landed("c31");
    await Promise.all([late, kept]);
    expect(closes()).toEqual([`${SERVER}/LiveStreams/Close?liveStreamId=ls-c30`]);

    await closeWarmedChannels();
    expect(closes()).toEqual([`${SERVER}/LiveStreams/Close?liveStreamId=ls-c30`, `${SERVER}/LiveStreams/Close?liveStreamId=ls-c31`]);
  });

  it("closes each warm stream once when two cleanups overlap", async () => {
    (global.fetch as jest.Mock).mockImplementation((url: string) => {
      const channel = /\/Items\/(c\d+)\/PlaybackInfo/.exec(String(url))?.[1];
      return Promise.resolve(channel ? { ok: true, json: async () => ({ MediaSources: [{ LiveStreamId: `ls-${channel}` }] }) } : { ok: true });
    });
    await warmChannel("c40");
    await warmChannel("c41");
    // Overlapping, un-awaited cleanups: the second starts while the first is still awaiting a close.
    const first = closeWarmedChannels();
    const second = closeWarmedChannels();
    await Promise.all([first, second]);
    const closes = (global.fetch as jest.Mock).mock.calls.map(([url]) => String(url)).filter((url) => url.includes("/LiveStreams/Close"));
    expect(closes.filter((url) => url.includes("ls-c41"))).toHaveLength(1);
    expect(closes).toHaveLength(2);
  });

  it("closes a warm stream against the server it was opened on after a switch", async () => {
    (global.fetch as jest.Mock).mockImplementation((url: string) => {
      const channel = /\/Items\/(c\d+)\/PlaybackInfo/.exec(String(url))?.[1];
      return Promise.resolve(channel ? { ok: true, json: async () => ({ MediaSources: [{ LiveStreamId: `ls-${channel}` }] }) } : { ok: true });
    });
    await warmChannel("c50");
    const SERVER_B = "http://10.0.0.5:8096";
    mockSecureStore.getItemAsync.mockImplementation((key: string) => {
      const cfg: Record<string, string> = { jellyfin_server_url: SERVER_B, jellyfin_api_key: "b-key", jellyfin_user_id: "b-user", jellyfin_device_id: "b-device" };
      return Promise.resolve(cfg[key] || null);
    });
    await refreshConfig();
    await closeWarmedChannels();
    const closes = (global.fetch as jest.Mock).mock.calls.map(([url]) => String(url)).filter((url) => url.includes("/LiveStreams/Close"));
    expect(closes).toEqual([`${SERVER}/LiveStreams/Close?liveStreamId=ls-c50`]);
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

  it("refuses a channel the server neither hands over nor transcodes, releasing its open", async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ ErrorCode: "NoCompatibleStream", MediaSources: [{ Id: "ms-1", SupportsDirectPlay: false, SupportsTranscoding: false, LiveStreamId: "ls-dead" }] }),
    });
    (global.fetch as jest.Mock).mockResolvedValueOnce({ ok: true });
    await expect(openChannel("c1", { Id: "c1", Name: "One", Type: "TvChannel", Path: "" })).rejects.toThrow("did not open One (NoCompatibleStream)");
    for (let hop = 0; hop < 5; hop++) await Promise.resolve();
    expect((global.fetch as jest.Mock).mock.calls.map(([url]) => String(url))).toContain(`${SERVER}/LiveStreams/Close?liveStreamId=ls-dead`);
  });

  it("resolves a manifest channel to its origin off the read-only PlaybackInfo, with no server open", async () => {
    const master = "#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=800000\nlow/index.m3u8\n#EXT-X-STREAM-INF:BANDWIDTH=3000000\nhigh/index.m3u8\n";
    (global.fetch as jest.Mock).mockImplementation(async (url: string) => {
      if (url.includes("/PlaybackInfo")) {
        return {
          ok: true,
          json: async () => ({
            PlaySessionId: "ps-get",
            MediaSources: [{ Id: "ms-7", Protocol: "Http", Path: "https://origin.example/live/master.m3u8", IsInfiniteStream: true, RequiredHttpHeaders: { "User-Agent": "Tuner" }, MediaStreams: [] }],
          }),
        };
      }
      if (url.endsWith("/master.m3u8")) return { ok: true, url, text: async () => master };
      return { ok: true, text: async () => "#EXTM3U\n#EXTINF:6,\nseg1.ts\n" };
    });

    const channel = await resolveChannel("c7", { Id: "c7", Name: "Seven", Type: "TvChannel", Path: "" });

    expect(channel.liveStreamUrl).toBe("https://origin.example/live/high/index.m3u8");
    expect(channel.liveHttpHeaders).toEqual({ "User-Agent": "Tuner" });
    expect(channel.PlaySessionId).toBe("ps-get");
    expect(channel.LiveStreamId).toBeUndefined();
    expect(channel.liveTranscodeUrl).toBeUndefined();
    const calls = (global.fetch as jest.Mock).mock.calls;
    expect(calls.filter(([, init]) => init?.method === "POST")).toHaveLength(0);
    expect(calls[0][0]).toBe(`${SERVER}/Items/c7/PlaybackInfo?UserId=test-user-id`);
    expect(isServerLaneChannel("c7")).toBe(false);
  });

  it("opens a channel whose source is not a manifest on the server", async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        PlaySessionId: "ps-8",
        MediaSources: [
          {
            Id: "ms-8",
            Container: "ts",
            Path: "http://172.17.0.2:8096/LiveTv/LiveStreamFiles/abc/stream.ts",
            IsInfiniteStream: true,
            SupportsDirectPlay: true,
            LiveStreamId: "ls-8",
            MediaStreams: [],
          },
        ],
      }),
    });
    const info = { MediaSources: [{ Id: "ms-8", Protocol: "Http", Path: "http://tuner.local:5004/auto/v8", IsInfiniteStream: true }] };

    const channel = await resolveChannel("c8", { Id: "c8", Name: "Eight", Type: "TvChannel", Path: "" }, { info });

    const [url, init] = (global.fetch as jest.Mock).mock.calls[0];
    expect(url).toBe(`${SERVER}/Items/c8/PlaybackInfo?UserId=test-user-id`);
    expect(init.method).toBe("POST");
    expect(channel.LiveStreamId).toBe("ls-8");
    expect(isServerLaneChannel("c8")).toBe(true);
  });

  it("opens a resolved channel for the server's transcode alone, dropping the origin it carried", async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        PlaySessionId: "ps-9",
        MediaSources: [
          {
            Id: "ms-9",
            Container: "hls",
            Protocol: "Http",
            Path: "https://origin.example/live/master.m3u8",
            SupportsTranscoding: true,
            TranscodingUrl: "/videos/c9/master.m3u8?LiveStreamId=ls-9",
            LiveStreamId: "ls-9",
            MediaStreams: [],
          },
        ],
      }),
    });
    const resolved = { Id: "c9", Name: "Nine", Type: "TvChannel", Path: "", liveStreamUrl: "https://origin.example/live/high/index.m3u8", liveHttpHeaders: { "User-Agent": "Tuner" } };

    const channel = await openChannel("c9", resolved, { serverOnly: true });

    expect((global.fetch as jest.Mock).mock.calls).toHaveLength(1);
    expect(channel.liveStreamUrl).toBeUndefined();
    expect(channel.liveHttpHeaders).toBeUndefined();
    expect(channel.liveTranscodeUrl).toBe(`${SERVER}/videos/c9/master.m3u8?LiveStreamId=ls-9`);
    expect(channel.PlaySessionId).toBe("ps-9");
    expect(isServerLaneChannel("c9")).toBe(true);
  });

  it("asks the server to transcode a direct-playable TS channel when it opens for the server lane", async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        PlaySessionId: "ps-11",
        MediaSources: [
          {
            Id: "ms-11",
            Container: "ts",
            Protocol: "Http",
            Path: "http://172.18.0.2:8096/LiveTv/LiveStreamFiles/abc/stream.ts",
            SupportsDirectPlay: false,
            SupportsTranscoding: true,
            TranscodingUrl: "/videos/c11/master.m3u8?LiveStreamId=ls-11",
            LiveStreamId: "ls-11",
            MediaStreams: [
              { Type: "Video", Codec: "h264" },
              { Type: "Audio", Codec: "aac" },
            ],
          },
        ],
      }),
    });

    const channel = await openChannel("c11", { Id: "c11", Name: "Eleven", Type: "TvChannel", Path: "" }, { serverOnly: true });

    const body = JSON.parse((global.fetch as jest.Mock).mock.calls[0][1].body);
    expect(body.EnableDirectPlay).toBe(false);
    expect(body.EnableDirectStream).toBe(false);
    expect(body.EnableTranscoding).toBe(true);
    expect(channel.liveTranscodeUrl).toBe(`${SERVER}/videos/c11/master.m3u8?LiveStreamId=ls-11`);
    expect(channel.liveStreamUrl).toBeUndefined();
  });

  it("leaves a channel whose server open failed out of the server lane", async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ ErrorCode: "NoCompatibleStream", MediaSources: [{ Id: "ms-10", SupportsDirectPlay: false, SupportsTranscoding: false }] }),
    });
    await expect(openChannel("c10", { Id: "c10", Name: "Ten", Type: "TvChannel", Path: "" }, { serverOnly: true })).rejects.toThrow("did not open Ten");
    expect(isServerLaneChannel("c10")).toBe(false);
  });

  it("caps the fallback's server open at the normal budget and leaves a first open the extended one", async () => {
    jest.useFakeTimers();
    try {
      (global.fetch as jest.Mock).mockImplementation(
        (_url: string, init: { signal: AbortSignal }) =>
          new Promise((_resolve, reject) => init.signal.addEventListener("abort", () => reject(Object.assign(new Error("Aborted"), { name: "AbortError" })))),
      );
      const channel = { Id: "c9", Name: "Nine", Type: "TvChannel", Path: "" };
      const watch = (open: Promise<unknown>) => {
        const state = { settled: false, error: "" };
        open.catch((error: Error) => {
          state.settled = true;
          state.error = error.name;
        });
        return state;
      };

      const fallback = watch(openChannel("c9", channel, { quiet: true, serverOnly: true }));
      const first = watch(openChannel("c9", channel, { quiet: true }));
      await jest.advanceTimersByTimeAsync(14_999);
      expect(fallback.settled).toBe(false);
      await jest.advanceTimersByTimeAsync(1);
      expect(fallback).toEqual({ settled: true, error: "AbortError" });
      expect(first.settled).toBe(false);
      await jest.advanceTimersByTimeAsync(15_000);
      expect(first).toEqual({ settled: true, error: "AbortError" });
    } finally {
      jest.useRealTimers();
    }
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
    fetchLiveTvManagement,
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

  it("asks for the window's programs by start time, images on and user data off", async () => {
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
      EnableImages: true,
      EnableUserData: false,
      EnableTotalRecordCount: false,
      Fields: ["ChannelInfo", "Genres", "PrimaryImageAspectRatio"],
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

  it("reads the recording permission off the account policy", async () => {
    ok({ Policy: { EnableLiveTvAccess: true, EnableLiveTvManagement: false } });
    expect(await fetchLiveTvManagement()).toBe(false);
    expect((global.fetch as jest.Mock).mock.calls[0][0]).toBe(`${SERVER}/Users/Me`);
    ok({ Policy: { EnableLiveTvManagement: true } });
    expect(await fetchLiveTvManagement()).toBe(true);
    ok({});
    expect(await fetchLiveTvManagement()).toBe(false);
  });
});
