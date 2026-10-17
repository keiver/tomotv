/**
 * Pluto TV channels play on a session the device starts itself with the web player's calls:
 * ptvStart once, streamingUrl per channel, then the stitcher master with the session token.
 */
import type * as PlutoSession from "../jellyfin/plutoSession";

const ID = "5f4d878d3d19b30007d2e782";
const OTHER = "5ca525b650be2571e3943c63";
const START = "https://pluto.tv/api/tn/app-shell/graphql/";
const STREAMING = "https://pluto.tv/api/tn/video/graphql/";
const COOKIES = "CBS_COM=abc123; Path=/; Domain=.pluto.tv, CBS_PID=p1; Path=/";

function started(overrides: Record<string, unknown> = {}, cookies: string | null = COOKIES) {
  return {
    ok: true,
    headers: { get: (name: string) => (name.toLowerCase() === "x-external-set-cookie" ? cookies : null) },
    json: async () => ({ data: { ptvStart: { deviceId: "dev-1", session: { id: "s1", jwt: "tok" }, refreshInSec: 28800, ...overrides } } }),
  };
}

function streaming(channelId: string, success = true) {
  return {
    ok: true,
    headers: { get: () => null },
    json: async () => ({ data: { streamingUrl: { success, stitcherPaths: success ? [{ type: "hls", path: `/v2/stitch/hls/channel/${channelId}/master.m3u8` }] : null } } }),
  };
}

const BOOT = "https://boot.pluto.tv/v4/start?";

function booted() {
  return { ok: true, json: async () => ({ servers: { stitcher: "https://stitcher.pluto.example/" }, stitcherParams: "sid=b1", sessionToken: "btok", refreshInSec: 28800 }) };
}

const failed = () => ({ ok: false, status: 503, headers: { get: () => null }, json: async () => ({}) });

/** Answers ptvStart with `start`, streamingUrl with `stream` for the asked channel, and the boot start with `bootStart`. */
function serve(start: () => unknown = () => started(), bootStart: () => unknown = failed, stream: (channelId: string) => unknown = (channelId) => streaming(channelId)): jest.Mock {
  const mock = jest.fn(async (url: string, init: RequestInit) => {
    if (url === START) return start();
    if (url === STREAMING) return stream(JSON.parse(String(init.body)).variables.params.contentId);
    if (url.startsWith(BOOT)) return bootStart();
    throw new Error(`unexpected ${url}`);
  });
  global.fetch = mock as unknown as typeof fetch;
  return mock;
}

const body = (mock: jest.Mock, call: number) => JSON.parse(String(mock.mock.calls[call][1].body));
const master = (id: string, token = "tok") => `https://ipv4.pluto.tv/api/tn/video/playout/v2/stitch/hls/channel/${id}/master.m3u8?jwt=${token}&masterJWTPassthrough=true`;
const bootMaster = (id: string) => `https://stitcher.pluto.example/v2/stitch/hls/channel/${id}/master.m3u8?sid=b1&jwt=btok&masterJWTPassthrough=true&includeExtendedEvents=true`;
const calls = (mock: jest.Mock, prefix: string) => mock.mock.calls.filter(([url]) => String(url).startsWith(prefix)).length;

let pluto: typeof PlutoSession;

beforeEach(() => {
  jest.resetModules();
  jest.useFakeTimers({ now: new Date("2026-10-14T12:00:00Z") });
  pluto = require("../jellyfin/plutoSession");
});

afterEach(() => {
  jest.useRealTimers();
});

describe("plutoChannelId", () => {
  it("reads the channel id from a jmp2.uk link and from a Pluto stitcher master", () => {
    expect(pluto.plutoChannelId(`https://jmp2.uk/plu-${ID}.m3u8`)).toBe(ID);
    expect(pluto.plutoChannelId(`https://ipv4.pluto.tv/api/tn/video/playout/v2/stitch/hls/channel/${ID}/master.m3u8?sid=x`)).toBe(ID);
    expect(pluto.plutoChannelId(`https://service-stitcher.clusters.pluto.tv/stitch/hls/channel/${ID}/master.m3u8`)).toBe(ID);
  });

  it("reads nothing from other links", () => {
    expect(pluto.plutoChannelId("https://origin.example/live/master.m3u8")).toBeNull();
    expect(pluto.plutoChannelId(`https://jmp2.uk/sam-${ID}.m3u8`)).toBeNull();
    expect(pluto.plutoChannelId(`https://notpluto.tv/stitch/hls/channel/${ID}/master.m3u8`)).toBeNull();
    expect(pluto.plutoChannelId(`https://ipv4.pluto.tv/v2/stitch/hls/channel/${ID}/640930/playlist.m3u8`)).toBeNull();
  });
});

describe("plutoStreamUrl", () => {
  it("leaves a link that is not Pluto alone and asks nothing", async () => {
    const mock = serve();
    expect(await pluto.plutoStreamUrl("https://origin.example/live/master.m3u8")).toBe("https://origin.example/live/master.m3u8");
    expect(mock).not.toHaveBeenCalled();
  });

  it("starts one session for every channel and asks each channel's stitcher path with its cookie", async () => {
    const mock = serve();
    const [a, b] = await Promise.all([pluto.plutoStreamUrl(`https://jmp2.uk/plu-${ID}.m3u8`), pluto.plutoStreamUrl(`https://jmp2.uk/plu-${OTHER}.m3u8`)]);
    expect(a).toBe(master(ID));
    expect(b).toBe(master(OTHER));
    expect(mock.mock.calls.filter(([url]) => url === START)).toHaveLength(1);
    expect(body(mock, 0)).toMatchObject({ operationName: "PtvStart", variables: { params: { deviceId: "", ptvAppName: "web" } } });
    const streamingCall = mock.mock.calls.find(([url]) => url === STREAMING)!;
    expect(streamingCall[1]).toMatchObject({ method: "POST", credentials: "omit", headers: { Cookie: "CBS_COM=abc123", "apollo-require-preflight": "true" } });
    expect(JSON.parse(String(streamingCall[1].body)).variables.params).toEqual({ appVersion: "", contentId: ID, contentType: "channel", drm: "", drmLevel: "", streamType: "stitcher" });
  });

  it("asks a channel's stitcher path once per session", async () => {
    const mock = serve();
    await pluto.plutoStreamUrl(`https://jmp2.uk/plu-${ID}.m3u8`);
    await pluto.plutoStreamUrl(`https://jmp2.uk/plu-${ID}.m3u8`);
    expect(mock.mock.calls.filter(([url]) => url === STREAMING)).toHaveLength(1);
  });

  it("starts a new session once Pluto's refresh time passes, sending back the device id", async () => {
    let starts = 0;
    const mock = serve(() => (starts++ === 0 ? started({ refreshInSec: 60 }) : started({ session: { id: "s2", jwt: "tok2" } })));
    await pluto.plutoStreamUrl(`https://jmp2.uk/plu-${ID}.m3u8`);
    jest.advanceTimersByTime(59_000);
    expect(await pluto.plutoStreamUrl(`https://jmp2.uk/plu-${ID}.m3u8`)).toBe(master(ID));
    jest.advanceTimersByTime(2_000);
    expect(await pluto.plutoStreamUrl(`https://jmp2.uk/plu-${ID}.m3u8`)).toBe(master(ID, "tok2"));
    const startBodies = mock.mock.calls
      .map((_, i) => i)
      .filter((i) => mock.mock.calls[i][0] === START)
      .map((i) => body(mock, i));
    expect(startBodies.map((b) => b.variables.params.deviceId)).toEqual(["", "dev-1"]);
  });

  it("plays on the boot start when the web start fails, with FastChannels' parameters and no stored cookies", async () => {
    const mock = serve(failed, booted);
    expect(await pluto.plutoStreamUrl(`https://jmp2.uk/plu-${ID}.m3u8`)).toBe(bootMaster(ID));
    const bootCall = mock.mock.calls.find(([url]) => String(url).startsWith(BOOT))!;
    const query = new URLSearchParams(String(bootCall[0]).slice(BOOT.length));
    expect(Object.fromEntries(query)).toMatchObject({
      appName: "web",
      appVersion: "8.0.0-111b2b9dc00bd0bea9030b30662159ed9e7c8bc6",
      deviceMake: "chrome",
      deviceVersion: "122.0.0",
      serverSideAds: "false",
    });
    expect(query.get("clientID")).toMatch(/^[0-9a-f-]{36}$/i);
    expect(bootCall[1]).toMatchObject({ credentials: "omit" });
  });

  it("plays on the boot start when the web start answers GraphQL errors, no CBS_COM cookie, or throws", async () => {
    const link = `https://jmp2.uk/plu-${ID}.m3u8`;
    const answers = [
      () => ({ ok: true, headers: { get: () => COOKIES }, json: async () => ({ errors: [{ message: "BAD_USER_INPUT" }] }) }),
      () => started({}, null),
      () => Promise.reject(new Error("offline")),
    ];
    for (const answer of answers) {
      jest.resetModules();
      pluto = require("../jellyfin/plutoSession");
      serve(answer, booted);
      expect(await pluto.plutoStreamUrl(link)).toBe(bootMaster(ID));
    }
  });

  it("plays on the boot start when Pluto's web flow offers no stitcher path for the channel, and asks the web flow again a minute later", async () => {
    let asked = 0;
    const mock = serve(undefined, booted, (channelId) => streaming(channelId, asked++ > 0));
    expect(await pluto.plutoStreamUrl(`https://jmp2.uk/plu-${ID}.m3u8`)).toBe(bootMaster(ID));
    expect(await pluto.plutoStreamUrl(`https://jmp2.uk/plu-${ID}.m3u8`)).toBe(bootMaster(ID));
    expect(calls(mock, STREAMING)).toBe(1);
    jest.advanceTimersByTime(60_000);
    expect(await pluto.plutoStreamUrl(`https://jmp2.uk/plu-${ID}.m3u8`)).toBe(master(ID));
    expect(calls(mock, STREAMING)).toBe(2);
  });

  it("gives up on Pluto calls that never answer after five seconds each and keeps the playlist's link", async () => {
    const link = `https://jmp2.uk/plu-${ID}.m3u8`;
    const aborted = () => Object.assign(new Error("Aborted"), { name: "AbortError" });
    const hang = jest.fn((_url: string, init: RequestInit) => new Promise((_, reject) => init.signal?.addEventListener("abort", () => reject(aborted()))));
    global.fetch = hang as unknown as typeof fetch;
    const answer = pluto.plutoStreamUrl(link);
    await jest.advanceTimersByTimeAsync(5_000);
    expect(hang).toHaveBeenCalledTimes(2);
    await jest.advanceTimersByTimeAsync(5_000);
    await expect(answer).resolves.toBe(link);
  });

  it("never throws, keeping the playlist's link, when a token cannot be put in a URL", async () => {
    const link = `https://jmp2.uk/plu-${ID}.m3u8`;
    serve(failed, () => ({ ok: true, json: async () => ({ servers: { stitcher: "https://s.example" }, stitcherParams: "", sessionToken: "\uD800", refreshInSec: 60 }) }));
    await expect(pluto.plutoStreamUrl(link)).resolves.toBe(link);
  });

  it("keeps the playlist's link when both starts fail, and waits a minute before asking either again", async () => {
    const link = `https://jmp2.uk/plu-${ID}.m3u8`;
    let starts = 0;
    const mock = serve(() => (starts++ === 0 ? failed() : started()));
    expect(await pluto.plutoStreamUrl(link)).toBe(link);
    expect(await pluto.plutoStreamUrl(link)).toBe(link);
    expect([calls(mock, START), calls(mock, BOOT)]).toEqual([1, 1]);
    jest.advanceTimersByTime(60_000);
    expect(await pluto.plutoStreamUrl(link)).toBe(master(ID));
  });

  it("never starts the boot session while the web flow plays", async () => {
    const mock = serve(undefined, booted);
    await pluto.plutoStreamUrl(`https://jmp2.uk/plu-${ID}.m3u8`);
    expect(calls(mock, BOOT)).toBe(0);
  });
});
