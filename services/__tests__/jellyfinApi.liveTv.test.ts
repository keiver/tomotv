/**
 * Live TV client: the channel list, opening a channel as raw direct play on the address the
 * app signed into (never the server's own bind address), and releasing the tuner.
 */
import {
  closeLeftoverOpens,
  closeLiveStream,
  fetchCategoryChannelIds,
  fetchChannelOrder,
  fetchChannels,
  fetchChannelsByIds,
  fetchListedChannels,
  openChannel,
  refreshConfig,
  resolveChannel,
  resolveChannelOrigin,
} from "../jellyfinApi";
import { dashProtection, drmKeyFormat, liveStreamUrlFor, remuxOf } from "../jellyfin/liveTv";
import { recordClose, recordedOpens, recordOpen } from "../jellyfin/liveOpens";
import { logger } from "@/utils/logger";
import { invalidateByPrefix } from "@/services/requestCache";

jest.mock("../jellyfin/liveOpens", () => {
  const opens = new Map<string, { server: string; deviceId: string }>();
  return {
    recordOpen: jest.fn((id: string, open: { server: string; deviceId: string }) => opens.set(id, open)),
    recordClose: jest.fn((id: string) => opens.delete(id)),
    recordedOpens: jest.fn(() => Object.fromEntries(opens)),
    __reset: () => opens.clear(),
  };
});
const resetLiveOpens = (jest.requireMock("../jellyfin/liveOpens") as { __reset: () => void }).__reset;

const mockAccounts: { serverUrl: string; serverId: string; userId: string; deviceId: string }[] = [];
jest.mock("../jellyfin/accounts", () => ({ getSavedAccounts: jest.fn(async () => mockAccounts) }));

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

// No active guide sources by default: the airing fill stays inert unless a test arms it.
jest.mock("@/services/externalGuide", () => ({
  activeGuideUrls: jest.fn(() => []),
  fetchExternalAiringPrograms: jest.fn(async () => []),
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
    resetLiveOpens();
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

  it("leaves out the channels the viewer hid and shows a renamed one under its name, on the list, the lineup and an ids read alike", async () => {
    const preferences = jest.requireActual("@/services/liveTvPreferences") as typeof import("@/services/liveTvPreferences");
    preferences.hideChannel({ Id: "c2", Name: "Two" });
    preferences.renameChannel({ Id: "c1", Name: "One" }, "First");
    try {
      const items = [
        { Id: "c1", Name: "One", Type: "TvChannel", CurrentProgram: null },
        { Id: "c2", Name: "Two", Type: "TvChannel", CurrentProgram: null },
      ];
      (global.fetch as jest.Mock).mockResolvedValue({ ok: true, json: async () => ({ Items: items, TotalRecordCount: 2 }) });
      const page = await fetchChannels();
      expect(page.items).toEqual([{ Id: "c1", Name: "First", SourceName: "One", Type: "TvChannel", CurrentProgram: null }]);
      // The total still counts the hidden channel: the next page is asked for by the server's count.
      expect(page.total).toBe(2);
      expect((await fetchChannelOrder()).map((channel) => [channel.Id, channel.Name])).toEqual([["c1", "First"]]);
      expect((await fetchChannelsByIds(["c2", "c1"])).map((channel) => channel.Name)).toEqual(["First"]);
    } finally {
      preferences.unhideChannel({ name: "Two" });
      preferences.renameChannel({ Id: "c1", Name: "One" }, "");
    }
  });

  it("fills a channel's missing current programme from the device guide sources", async () => {
    const external = jest.requireMock("@/services/externalGuide") as { activeGuideUrls: jest.Mock; fetchExternalAiringPrograms: jest.Mock };
    external.activeGuideUrls.mockReturnValueOnce(["http://g/guide.xml"]);
    external.fetchExternalAiringPrograms.mockResolvedValueOnce([{ Id: "ext:c2:1", Name: "On Now", ChannelId: "c2" }]);
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        Items: [
          { Id: "c1", Name: "One", Type: "TvChannel", CurrentProgram: { Name: "News" } },
          { Id: "c2", Name: "Two", Type: "TvChannel", CurrentProgram: null },
        ],
        TotalRecordCount: 2,
      }),
    });
    const { items } = await fetchChannels();
    expect(items[0].CurrentProgram).toEqual({ Name: "News" });
    expect(items[1].CurrentProgram).toEqual({ Id: "ext:c2:1", Name: "On Now", ChannelId: "c2" });
    // Only the bare channel is asked of the guides.
    expect(external.fetchExternalAiringPrograms.mock.calls[0][1]).toEqual([{ channelId: "c2", tvgId: undefined, tvgName: undefined, name: "Two" }]);
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

  it("reads the lineup order without programmes, in the sort's order and held to a category when given", async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce({ ok: true, json: async () => ({ Items: [{ Id: "c1", Name: "One", Type: "TvChannel", CurrentProgram: { Name: "News" } }] }) });
    await expect(fetchChannelOrder()).resolves.toEqual([{ Id: "c1", Name: "One", Type: "TvChannel" }]);
    let [url] = (global.fetch as jest.Mock).mock.calls[0];
    expect(url).toContain("addCurrentProgram=false");
    expect(url).not.toContain("sortBy=");
    (global.fetch as jest.Mock).mockResolvedValueOnce({ ok: true, json: async () => ({ Items: [] }) });
    await fetchChannelOrder({ sortBy: "Name", category: "sports" });
    [url] = (global.fetch as jest.Mock).mock.calls[1];
    expect(url).toContain("sortBy=Name");
    expect(url).toContain("isSports=true");
  });

  it("reads a category's channel ids through the server's flag without programmes or images, once until the guide's reads are dropped", async () => {
    invalidateByPrefix("guide:");
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: async () => ({
        Items: [
          { Id: "c2", Name: "Two", Type: "TvChannel" },
          { Id: "c1", Name: "One", Type: "TvChannel" },
        ],
      }),
    });
    await expect(fetchCategoryChannelIds("kids", "SortName")).resolves.toEqual(["c2", "c1"]);
    const [url] = (global.fetch as jest.Mock).mock.calls[0];
    expect(url).toContain("isKids=true");
    expect(url).toContain("sortBy=SortName");
    expect(url).toContain("addCurrentProgram=false");
    expect(url).toContain("enableImages=false");
    await fetchCategoryChannelIds("kids", "SortName");
    expect(global.fetch).toHaveBeenCalledTimes(1);
    invalidateByPrefix("guide:");
    await fetchCategoryChannelIds("kids", "SortName");
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });

  it("fetches channels by id in chunks of 100 with includeItemTypes, keeping the ids' order and dropping unknown ids", async () => {
    (global.fetch as jest.Mock).mockImplementation(async (url: string) => {
      const ids = new URL(url).searchParams.get("ids")!.split(",");
      // The server answers out of order and never knows c7.
      return {
        ok: true,
        json: async () => ({
          Items: ids
            .filter((id) => id !== "c7")
            .reverse()
            .map((id) => ({ Id: id, Name: id, Type: "TvChannel" })),
        }),
      };
    });
    const ids = Array.from({ length: 150 }, (_, index) => `c${index}`);
    const channels = await fetchChannelsByIds(ids);
    expect(channels.map((channel) => channel.Id)).toEqual(ids.filter((id) => id !== "c7"));
    const urls = (global.fetch as jest.Mock).mock.calls.map(([url]) => url as string);
    expect(urls).toHaveLength(2);
    for (const url of urls) expect(url).toContain("includeItemTypes=TvChannel");
    expect(new URL(urls[0]).searchParams.get("ids")!.split(",")).toHaveLength(100);
    expect(new URL(urls[1]).searchParams.get("ids")!.split(",")).toHaveLength(50);
    await expect(fetchChannelsByIds([])).resolves.toEqual([]);
    expect((global.fetch as jest.Mock).mock.calls).toHaveLength(2);
  });

  it("fetches listed channels by id in one call, and by name where the id answers for another channel", async () => {
    (global.fetch as jest.Mock).mockImplementation(async (url: string) => ({
      ok: true,
      json: async () =>
        url.includes("ids=")
          ? {
              Items: [
                { Id: "c1", Name: "KQED", ChannelNumber: "9.1", Type: "TvChannel" },
                { Id: "c2", Name: "Someone Else", Type: "TvChannel" },
              ],
            }
          : {
              Items: [
                { Id: "x", Name: "Al Jazeera English (1080p)", Type: "TvChannel" },
                { Id: "c9", Name: "Al Jazeera English", Type: "TvChannel" },
              ],
            },
    }));
    const channels = await fetchListedChannels([
      { id: "c2", name: "Al Jazeera English" },
      { id: "c1", number: "9.1", name: "KQED" },
    ]);
    expect(channels.map((channel) => channel.Id)).toEqual(["c9", "c1"]);
    const urls = (global.fetch as jest.Mock).mock.calls.map(([url]) => url as string);
    expect(urls[0]).toContain("ids=c2%2Cc1");
    expect(urls[1]).toContain("searchTerm=Al+Jazeera+English");
    expect(urls).toHaveLength(2);
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
    // The one profile the server answers with a TranscodingUrl (live HLS is TS-only on Jellyfin), naming every codec
    // the engine takes, so a copy of the channel matches it and nothing is re-encoded.
    expect(body.DeviceProfile.TranscodingProfiles).toEqual([{ Type: "Video", Container: "ts", Protocol: "hls", VideoCodec: video.VideoCodec, AudioCodec: video.AudioCodec, Context: "Streaming" }]);
    expect(channel).not.toHaveProperty("liveTranscodeUrl");
  });

  it("hands the engine the server's relay and never the server's transcode beside it", async () => {
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
    expect(channel).not.toHaveProperty("liveTranscodeUrl");
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
            Path: "https://origin.example/live/playlist?channel=2",
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
    const channel = await openChannel("c2", { Id: "c2", Name: "Two", Type: "TvChannel", Path: "" });
    expect(channel.liveStreamUrl).toBe("https://origin.example/live/playlist?channel=2");
    expect(channel.liveHttpHeaders).toEqual({ "User-Agent": "Mozilla/5.0" });
    expect(channel.LiveStreamId).toBe("ls-2");
    // No extension names it a playlist, so the engine is told it is one, to trim it and check it for DRM.
    expect(channel.livePlaylist).toBe(true);
    // The engine reads the master itself, DRM check included: the app asks the origin nothing.
    expect((global.fetch as jest.Mock).mock.calls.map(([url]) => String(url)).filter((url) => url.startsWith("https://origin.example"))).toEqual([]);
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
    expect(channel.livePlaylist).toBeUndefined();
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
      if (url.includes("/Items/c42/PlaybackInfo")) {
        return { ok: true, json: async () => ({ MediaSources: [{ Id: "c42", Protocol: "File", RequiresOpening: true }] }) };
      }
      return { ok: true, url, text: async () => "#EXTM3U\n#EXTINF:6,\nseg1.ts\n" };
    });
    expect(await resolveChannelOrigin("c40")).toEqual({ url: "https://origin.example/live/master.m3u8", headers: { "User-Agent": "Tuner" } });
    expect(await resolveChannelOrigin("c41")).toBeNull();
    // The server's placeholder for a channel it lists that no tuner carries.
    expect(await resolveChannelOrigin("c42")).toBe("untuned");
    const calls = (global.fetch as jest.Mock).mock.calls;
    expect(calls.filter(([, init]) => init?.method === "POST")).toHaveLength(0);
    expect(calls.filter(([url]) => String(url).includes("/LiveStreams/"))).toHaveLength(0);
    expect(calls.filter(([url]) => String(url).includes("origin.example"))).toHaveLength(0);
  });

  it("hands the engine the server's copy of a channel it cannot read otherwise, from a second open asking for it", async () => {
    (global.fetch as jest.Mock)
      .mockResolvedValueOnce({ ok: true, json: async () => ({ MediaSources: [{ Id: "ms-1", Protocol: "Udp", Path: "udp://239.0.0.1:1234", SupportsDirectPlay: true, LiveStreamId: "ls-1" }] }) })
      .mockResolvedValueOnce({ ok: true })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ MediaSources: [{ Id: "ms-1", TranscodingUrl: "/videos/x/master.m3u8?LiveStreamId=ls-2&TranscodeReasons=DirectPlayError", LiveStreamId: "ls-2" }] }),
      });
    const channel = await openChannel("c1", { Id: "c1", Name: "One", Type: "TvChannel", Path: "" });
    expect(channel.liveStreamUrl).toBe(`${SERVER}/videos/x/master.m3u8?LiveStreamId=ls-2&TranscodeReasons=DirectPlayError`);
    expect(channel.LiveStreamId).toBe("ls-2");
    const calls = (global.fetch as jest.Mock).mock.calls;
    expect(String(calls[1][0])).toBe(`${SERVER}/LiveStreams/Close?liveStreamId=ls-1`);
    const second = JSON.parse(calls[2][1].body);
    expect(second.EnableDirectPlay).toBe(false);
    expect(second.EnableDirectStream).toBe(false);
    expect(second.EnableTranscoding).toBe(true);
  });

  it("refuses a channel the server could carry only by re-encoding it, releasing both opens", async () => {
    const noInput = { ok: true, json: async () => ({ MediaSources: [{ Id: "ms-1", SupportsDirectPlay: false, LiveStreamId: "ls-a" }] }) };
    const reencode = {
      ok: true,
      json: async () => ({
        ErrorCode: "NoCompatibleStream",
        MediaSources: [{ Id: "ms-1", TranscodingUrl: "/videos/x/master.m3u8?TranscodeReasons=VideoCodecNotSupported,DirectPlayError", LiveStreamId: "ls-b" }],
      }),
    };
    (global.fetch as jest.Mock).mockImplementation(async (url: string) =>
      String(url).includes("/LiveStreams/Close") ? { ok: true } : (global.fetch as jest.Mock).mock.calls.length === 1 ? noInput : reencode,
    );
    await expect(openChannel("c1", { Id: "c1", Name: "One", Type: "TvChannel", Path: "" })).rejects.toThrow("only by re-encoding it (NoCompatibleStream)");
    for (let hop = 0; hop < 5; hop++) await Promise.resolve();
    const urls = (global.fetch as jest.Mock).mock.calls.map(([url]) => String(url));
    expect(urls).toContain(`${SERVER}/LiveStreams/Close?liveStreamId=ls-a`);
    expect(urls).toContain(`${SERVER}/LiveStreams/Close?liveStreamId=ls-b`);
  });

  it("takes the server's HLS only as a copy: no reason or DirectPlayError alone", () => {
    expect(remuxOf(SERVER, "/videos/x/master.m3u8?LiveStreamId=1")).toBe(`${SERVER}/videos/x/master.m3u8?LiveStreamId=1`);
    expect(remuxOf(SERVER, "/videos/x/master.m3u8?TranscodeReasons=DirectPlayError&a=1")).toBe(`${SERVER}/videos/x/master.m3u8?TranscodeReasons=DirectPlayError&a=1`);
    expect(remuxOf(SERVER, "/videos/x/master.m3u8?TranscodeReasons=ContainerNotSupported%2CDirectPlayError")).toBeNull();
    expect(remuxOf(SERVER, "/videos/x/master.m3u8?TranscodeReasons=VideoCodecNotSupported,DirectPlayError")).toBeNull();
    expect(remuxOf(SERVER, "/videos/x/master.m3u8?TranscodeReasons=AudioCodecNotSupported")).toBeNull();
    expect(remuxOf(SERVER, undefined)).toBeNull();
  });

  describe("Pluto channels", () => {
    const PLUTO = "5f4d878d3d19b30007d2e782";
    const SESSION = `https://ipv4.pluto.tv/api/tn/video/playout/v2/stitch/hls/channel/${PLUTO}/master.m3u8?jwt=tok&masterJWTPassthrough=true`;
    const respond = async (url: string) => {
      if (url.includes("/PlaybackInfo")) {
        return { ok: true, json: async () => ({ MediaSources: [{ Id: "ms-p", Protocol: "Http", Container: "hls", Path: `https://jmp2.uk/plu-${PLUTO}.m3u8`, MediaStreams: [] }] }) };
      }
      if (url === "https://pluto.tv/api/tn/app-shell/graphql/") {
        return { ok: true, headers: { get: () => "CBS_COM=c1; Path=/" }, json: async () => ({ data: { ptvStart: { deviceId: "d1", session: { id: "s1", jwt: "tok" }, refreshInSec: 28800 } } }) };
      }
      if (url === "https://pluto.tv/api/tn/video/graphql/") {
        return {
          ok: true,
          headers: { get: () => null },
          json: async () => ({ data: { streamingUrl: { success: true, stitcherPaths: [{ type: "hls", path: `/v2/stitch/hls/channel/${PLUTO}/master.m3u8` }] } } }),
        };
      }
      return { ok: true, url, text: async () => "#EXTM3U\n#EXTINF:6,\nseg1.ts\n" };
    };

    it("grabs a Pluto channel's frames on this device's session", async () => {
      (global.fetch as jest.Mock).mockImplementation(respond);
      expect(await resolveChannelOrigin("cp")).toEqual({ url: SESSION });
    });

    it("plays a Pluto channel on this device's session", async () => {
      (global.fetch as jest.Mock).mockImplementation(respond);
      const channel = await resolveChannel("cp", { Id: "cp", Name: "Pluto", Type: "TvChannel", Path: "" });
      expect(channel.liveStreamUrl).toBe(SESSION);
      expect((global.fetch as jest.Mock).mock.calls.map(([url]) => String(url))).not.toContain(`https://jmp2.uk/plu-${PLUTO}.m3u8`);
    });
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

    expect(channel.liveStreamUrl).toBe("https://origin.example/live/master.m3u8");
    expect(channel.liveHttpHeaders).toEqual({ "User-Agent": "Tuner" });
    expect(channel.livePlaylist).toBe(true);
    expect(channel.PlaySessionId).toBe("ps-get");
    expect(channel.LiveStreamId).toBeUndefined();
    expect(channel).not.toHaveProperty("liveTranscodeUrl");
    const calls = (global.fetch as jest.Mock).mock.calls;
    expect(calls.filter(([, init]) => init?.method === "POST")).toHaveLength(0);
    expect(calls[0][0]).toBe(`${SERVER}/Items/c7/PlaybackInfo?UserId=test-user-id`);
  });

  it("gives the played channel its airing programme from the device guide when the server lists none", async () => {
    const external = jest.requireMock("@/services/externalGuide") as { activeGuideUrls: jest.Mock; fetchExternalAiringPrograms: jest.Mock };
    external.activeGuideUrls.mockReturnValueOnce(["http://g/guide.xml"]);
    external.fetchExternalAiringPrograms.mockResolvedValueOnce([{ Id: "ext:c7:1", Name: "Late Film", ChannelId: "c7", OfficialRating: "PG", Genres: ["Movie"] }]);
    (global.fetch as jest.Mock).mockImplementation(async (url: string) => {
      if (url.includes("/PlaybackInfo")) {
        return { ok: true, json: async () => ({ MediaSources: [{ Id: "ms-7", Protocol: "Http", Path: "https://origin.example/live/master.m3u8", IsInfiniteStream: true, MediaStreams: [] }] }) };
      }
      if (url.endsWith("/master.m3u8")) return { ok: true, url, text: async () => "#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=800000\nlow/index.m3u8\n" };
      return { ok: true, text: async () => "#EXTM3U\n#EXTINF:6,\nseg1.ts\n" };
    });

    const channel = await resolveChannel("c7", { Id: "c7", Name: "Seven", Type: "TvChannel", Path: "", CurrentProgram: null });

    expect(channel.CurrentProgram).toEqual({ Id: "ext:c7:1", Name: "Late Film", ChannelId: "c7", OfficialRating: "PG", Genres: ["Movie"] });
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
  });

  it("reads the server's relay even when the server turned direct play off for the tuner", async () => {
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
            MediaStreams: [],
          },
        ],
      }),
    });

    const channel = await openChannel("c11", { Id: "c11", Name: "Eleven", Type: "TvChannel", Path: "" });

    expect(channel.liveStreamUrl).toBe(`${SERVER}/LiveTv/LiveStreamFiles/abc/stream.ts?ApiKey=test-api-key`);
    expect((global.fetch as jest.Mock).mock.calls).toHaveLength(1);
  });

  it("opens every channel uncapped whatever the Streaming Quality pick: the server never re-encodes one", async () => {
    const answer = () => ({
      ok: true,
      json: async () => ({
        PlaySessionId: "ps-12",
        MediaSources: [
          {
            Id: "ms-12",
            Container: "ts",
            Path: "http://172.18.0.2:8096/LiveTv/LiveStreamFiles/abc/stream.ts",
            SupportsDirectPlay: true,
            SupportsTranscoding: true,
            TranscodingUrl: "/videos/c12/master.m3u8?LiveStreamId=ls-12",
            LiveStreamId: "ls-12",
            MediaStreams: [],
          },
        ],
      }),
    });
    const baseConfig: Record<string, string> = {
      jellyfin_server_url: SERVER,
      jellyfin_api_key: "test-api-key",
      jellyfin_user_id: "test-user-id",
      jellyfin_device_id: "test-device-id",
      app_video_quality: "3",
    };
    mockSecureStore.getItemAsync.mockImplementation((key: string) => Promise.resolve(baseConfig[key] || null));
    (global.fetch as jest.Mock).mockResolvedValueOnce(answer());

    await openChannel("c12", { Id: "c12", Name: "Twelve", Type: "TvChannel", Path: "" });
    const body = JSON.parse((global.fetch as jest.Mock).mock.calls[0][1].body);
    expect(body.MaxStreamingBitrate).toBe(200_000_000);
    expect(body.DeviceProfile.MaxStreamingBitrate).toBe(200_000_000);
    expect(body.DeviceProfile.MaxStaticBitrate).toBe(200_000_000);
  });

  it("gives an open the extended budget: the server probes the origin first", async () => {
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

      const first = watch(openChannel("c9", channel, { quiet: true }));
      await jest.advanceTimersByTimeAsync(29_999);
      expect(first.settled).toBe(false);
      await jest.advanceTimersByTimeAsync(1);
      expect(first).toEqual({ settled: true, error: "AbortError" });
    } finally {
      jest.useRealTimers();
    }
  });

  it("records every open the server counts and forgets it when the close is answered", async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        PlaySessionId: "ps-60",
        MediaSources: [{ Id: "ms-60", Container: "ts", SupportsDirectPlay: true, LiveStreamId: "ls-60", Path: "http://172.17.0.2:8096/LiveTv/LiveStreamFiles/ls-60/stream.ts" }],
      }),
    });
    await openChannel("c60", { Id: "c60", Name: "Sixty", Type: "TvChannel", Path: "" });
    expect(recordOpen).toHaveBeenCalledWith("ls-60", { server: SERVER, deviceId: "test-device-id" });

    (global.fetch as jest.Mock).mockResolvedValueOnce({ ok: false, status: 404 });
    await closeLiveStream("ls-60");
    expect(recordClose).toHaveBeenCalledWith("ls-60");

    (global.fetch as jest.Mock).mockRejectedValueOnce(new Error("offline"));
    await closeLiveStream("ls-61");
    expect(recordClose).not.toHaveBeenCalledWith("ls-61");
  });

  it("closes an open on the server that made it after a switch to another", async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ MediaSources: [{ Id: "ms-64", Container: "ts", SupportsDirectPlay: true, LiveStreamId: "ls-64", Path: "/LiveTv/LiveStreamFiles/ls-64/stream.ts" }] }),
    });
    await openChannel("c64", { Id: "c64", Name: "Sixty-four", Type: "TvChannel", Path: "" });
    const switched: Record<string, string> = { jellyfin_server_url: "http://127.0.0.1:18096", jellyfin_api_key: "other-key", jellyfin_user_id: "other-user", jellyfin_device_id: "test-device-id" };
    mockSecureStore.getItemAsync.mockImplementation((key: string) => Promise.resolve(switched[key] || null));
    await refreshConfig();

    (global.fetch as jest.Mock).mockResolvedValueOnce({ ok: true });
    await closeLiveStream("ls-64");
    const [url, init] = (global.fetch as jest.Mock).mock.calls.at(-1);
    expect(url).toBe(`${SERVER}/LiveStreams/Close?liveStreamId=ls-64`);
    expect(init.headers.Authorization).toContain('Token="test-api-key"');
    expect(recordedOpens()).toEqual({});
  });

  it("releases the open that went through beside a channel fetch that failed", async () => {
    (global.fetch as jest.Mock)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          MediaSources: [{ Id: "ms-62", Container: "ts", SupportsDirectPlay: true, LiveStreamId: "ls-62", Path: "http://172.17.0.2:8096/LiveTv/LiveStreamFiles/ls-62/stream.ts" }],
        }),
      })
      .mockRejectedValueOnce(new Error("Request timed out"))
      .mockResolvedValueOnce({ ok: true });
    await expect(openChannel("c62")).rejects.toThrow("Request timed out");
    for (let i = 0; i < 8; i += 1) await Promise.resolve();
    const closes = (global.fetch as jest.Mock).mock.calls.map(([url]) => String(url)).filter((url) => url.includes("/LiveStreams/Close"));
    expect(closes).toEqual([`${SERVER}/LiveStreams/Close?liveStreamId=ls-62`]);
    expect(recordOpen).not.toHaveBeenCalledWith("ls-62", expect.anything());
  });

  it("throws the channel fetch's failure before the open answers, and releases the open when it lands", async () => {
    let land!: (response: unknown) => void;
    (global.fetch as jest.Mock)
      .mockImplementationOnce(() => new Promise((resolve) => (land = resolve)))
      .mockRejectedValueOnce(new Error("Request timed out"))
      .mockResolvedValueOnce({ ok: true });
    await expect(openChannel("c63")).rejects.toThrow("Request timed out");
    expect((global.fetch as jest.Mock).mock.calls.map(([url]) => String(url)).filter((url) => url.includes("/LiveStreams/Close"))).toEqual([]);
    land({ ok: true, json: async () => ({ MediaSources: [{ Id: "ms-63", Container: "ts", SupportsDirectPlay: true, LiveStreamId: "ls-63", Path: "/LiveTv/LiveStreamFiles/ls-63/stream.ts" }] }) });
    for (let i = 0; i < 8; i += 1) await Promise.resolve();
    expect((global.fetch as jest.Mock).mock.calls.map(([url]) => String(url)).filter((url) => url.includes("/LiveStreams/Close"))).toEqual([`${SERVER}/LiveStreams/Close?liveStreamId=ls-63`]);
  });

  it("keeps the records of a previous run when the credentials cannot be read", async () => {
    recordOpen("ls-72", { server: SERVER, deviceId: "test-device-id" });
    mockSecureStore.getItemAsync.mockRejectedValue(new Error("keychain locked"));
    await refreshConfig();
    (global.fetch as jest.Mock).mockResolvedValue({ ok: true });
    await closeLeftoverOpens();
    expect(global.fetch).not.toHaveBeenCalled();
    expect(recordedOpens()).toEqual({ "ls-72": { server: SERVER, deviceId: "test-device-id" } });
  });

  it("closes the opens a previous run left on the signed-in server and forgets those no saved account reaches", async () => {
    recordOpen("ls-70", { server: SERVER, deviceId: "test-device-id" });
    recordOpen("ls-71", { server: "http://elsewhere:8096", deviceId: "other" });
    (global.fetch as jest.Mock).mockResolvedValue({ ok: true });
    await closeLeftoverOpens();
    const closes = (global.fetch as jest.Mock).mock.calls.map(([url]) => String(url)).filter((url) => url.includes("/LiveStreams/Close"));
    expect(closes).toEqual([`${SERVER}/LiveStreams/Close?liveStreamId=ls-70`]);
    expect(recordedOpens()).toEqual({});
  });

  it("keeps the record of an open the server answered 5xx for, and sends the close again from the next foreground", async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ MediaSources: [{ Id: "ms-80", Container: "ts", SupportsDirectPlay: true, LiveStreamId: "ls-80", Path: "/LiveTv/LiveStreamFiles/ls-80/stream.ts" }] }),
    });
    await openChannel("c80", { Id: "c80", Name: "Eighty", Type: "TvChannel", Path: "" });
    // An open this run still plays is never swept.
    (global.fetch as jest.Mock).mockClear();
    await closeLeftoverOpens();
    expect(global.fetch).not.toHaveBeenCalled();
    (global.fetch as jest.Mock).mockResolvedValueOnce({ ok: false, status: 503 });
    await closeLiveStream("ls-80");
    expect(recordClose).not.toHaveBeenCalledWith("ls-80");
    // The refused close leaves the record; the foreground pass sends it again and a 204 ends it.
    (global.fetch as jest.Mock).mockClear();
    (global.fetch as jest.Mock).mockResolvedValueOnce({ ok: true, status: 204 });
    await closeLeftoverOpens();
    expect((global.fetch as jest.Mock).mock.calls[0][0]).toContain("/LiveStreams/Close?liveStreamId=ls-80");
    expect(recordClose).toHaveBeenCalledWith("ls-80");
  });

  it("logs how many leftover opens are still held after a close no server answered", async () => {
    const info = jest.spyOn(logger, "info");
    recordOpen("ls-95", { server: SERVER, deviceId: "test-device-id" });
    recordOpen("ls-96", { server: SERVER, deviceId: "test-device-id" });
    (global.fetch as jest.Mock).mockResolvedValueOnce({ ok: true, status: 204 }).mockRejectedValueOnce(new Error("Network request failed"));
    await closeLeftoverOpens();
    expect(info).toHaveBeenCalledWith("Live opens left by a previous run", { service: "LiveTv", count: 2, kept: 1 });
    expect(recordedOpens()).toEqual({ "ls-96": { server: SERVER, deviceId: "test-device-id" } });
    info.mockRestore();
  });

  it("closes an open left on another server with that account's saved token", async () => {
    recordOpen("ls-90", { server: "http://elsewhere:8096", deviceId: "other-device" });
    mockAccounts.splice(0, mockAccounts.length, { serverUrl: "http://elsewhere:8096/", serverId: "srv2", userId: "u2", deviceId: "other-device" });
    mockSecureStore.getItemAsync.mockImplementation((key: string) => {
      const values: Record<string, string> = {
        jellyfin_server_url: SERVER,
        jellyfin_api_key: "test-api-key",
        jellyfin_user_id: "test-user-id",
        jellyfin_device_id: "test-device-id",
        jellyfin_account_token_srv2_u2: "tok-2",
      };
      return Promise.resolve(values[key] || null);
    });
    (global.fetch as jest.Mock).mockResolvedValue({ ok: true, status: 204 });
    await closeLeftoverOpens();
    mockAccounts.length = 0;
    const [url, init] = (global.fetch as jest.Mock).mock.calls.find(([u]) => String(u).includes("/LiveStreams/Close"))!;
    expect(url).toBe("http://elsewhere:8096/LiveStreams/Close?liveStreamId=ls-90");
    expect(init.headers.Authorization).toContain('DeviceId="other-device"');
    expect(init.headers.Authorization).toContain('Token="tok-2"');
    expect(recordedOpens()).toEqual({});
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
    fetchGuideHorizon,
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

  it("reads where the guide ends off its last program's start, one item sorted last first", async () => {
    ok({ Items: [{ Id: "last", StartDate: "2026-10-17T23:30:00.000Z" }] });
    await expect(fetchGuideHorizon()).resolves.toBe(Date.parse("2026-10-17T23:30:00.000Z"));
    const [url, init] = (global.fetch as jest.Mock).mock.calls[0];
    expect(url).toBe(`${SERVER}/LiveTv/Programs`);
    expect(JSON.parse(init.body)).toEqual({
      UserId: "test-user-id",
      SortBy: ["StartDate"],
      SortOrder: ["Descending"],
      Limit: 1,
      EnableImages: false,
      EnableUserData: false,
      EnableTotalRecordCount: false,
      Fields: [],
    });
    ok({ Items: [] });
    await expect(fetchGuideHorizon()).resolves.toBeNull();
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
