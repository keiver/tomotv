/** channelOrigin - what an app learns about a live channel's origin before the engine opens it. */

jest.mock("@keiver/tomo-engine", () => ({
  canProbeOrigin: () => true,
  engineLog: () => ({ debug: jest.fn(), warn: jest.fn() }),
  probeOriginReach: jest.fn(async () => "reachable"),
}));

import { probeOriginReach } from "@keiver/tomo-engine";

import { dashProtection, drmKeyFormat, manifestDrm, mergeOriginHeaders, originKeyOf, originReach, resetOriginReach, splitPipeHeaders } from "../src/channelOrigin";

const fetchMock = jest.fn();
beforeEach(() => {
  fetchMock.mockReset();
  global.fetch = fetchMock as unknown as typeof fetch;
  resetOriginReach();
  (probeOriginReach as jest.Mock).mockClear();
});

function answer(text: string, url = "") {
  return { ok: true, url, text: async () => text };
}

it("splits a pipe-header URL the way the native M3U parser does", () => {
  expect(splitPipeHeaders("http://o/live.ts|User-Agent=VLC%2F3&Referrer=http://r/")).toEqual({
    url: "http://o/live.ts",
    headers: { "user-agent": "VLC/3", referer: "http://r/" },
  });
  expect(splitPipeHeaders("http://o/live.ts")).toEqual({ url: "http://o/live.ts", headers: {} });
});

it("keys a provider by host and port", () => {
  expect(originKeyOf("http://User:pw@Provider.example:8080/live/1.ts")).toBe("provider.example:8080");
  expect(originKeyOf("https://provider.example/a")).toBe("provider.example");
});

it("lets the playlist's own headers win over the server's, whatever their case", () => {
  expect(mergeOriginHeaders({ "User-Agent": "server", Referer: "r" }, { "user-agent": "own" })).toEqual({ Referer: "r", "user-agent": "own" });
  expect(mergeOriginHeaders(undefined, {})).toBeUndefined();
});

it("names a DRM key scheme and lets plain AES-128 through", () => {
  expect(drmKeyFormat('#EXT-X-KEY:METHOD=SAMPLE-AES,URI="skd://k",KEYFORMAT="com.apple.streamingkeydelivery"')).toBe("com.apple.streamingkeydelivery");
  expect(drmKeyFormat('#EXT-X-KEY:METHOD=AES-128,URI="https://k/key"')).toBeNull();
  expect(dashProtection('<MPD><ContentProtection schemeIdUri="urn:uuid:edef8ba9-79d6-4ace-a3c8-27dcd51d21ed"/></MPD>')).toBe("urn:uuid:edef8ba9-79d6-4ace-a3c8-27dcd51d21ed");
});

it("reads a master and its first variant to find DRM before the engine opens the channel", async () => {
  fetchMock
    .mockResolvedValueOnce(answer("#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1\nv1/index.m3u8\n", "https://landed.example/c/master.m3u8"))
    .mockResolvedValueOnce(answer('#EXTM3U\n#EXT-X-KEY:METHOD=SAMPLE-AES,URI="skd://k",KEYFORMAT="com.apple.streamingkeydelivery"\n'));
  expect(await manifestDrm("https://short.example/c", { "User-Agent": "x" })).toBe("com.apple.streamingkeydelivery");
  expect(fetchMock.mock.calls[1][0]).toBe("https://landed.example/c/v1/index.m3u8");
  expect(fetchMock.mock.calls[1][1].headers).toEqual({ "User-Agent": "x" });
});

it("answers null for a clear channel and for one it could not read", async () => {
  fetchMock.mockResolvedValueOnce(answer("#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1\nv1.m3u8\n")).mockResolvedValueOnce(answer("#EXTM3U\n#EXTINF:6,\ns.ts\n"));
  expect(await manifestDrm("https://o/master.m3u8")).toBeNull();
  fetchMock.mockRejectedValueOnce(new Error("offline"));
  expect(await manifestDrm("https://o/master.m3u8")).toBeNull();
});

it("asks a host's reach once and remembers it", async () => {
  expect(await originReach("http://provider.example:8080/live/1.ts")).toBe("reachable");
  expect(await originReach("http://provider.example:8080/live/2.ts")).toBe("reachable");
  expect(probeOriginReach).toHaveBeenCalledTimes(1);
});
