/** bitrateTest - the per-server link measurement the playback routing gate reads. */

jest.mock("@/utils/logger", () => ({
  logger: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

const mockHoldTaken = new Set<() => void>();
jest.mock("@/services/playbackHold", () => ({
  isPlaybackHeld: jest.fn(),
  onPlaybackHoldTaken: (listener: () => void) => {
    mockHoldTaken.add(listener);
    return () => mockHoldTaken.delete(listener);
  },
}));

jest.mock("@/services/localNetworkIdentity", () => ({
  getLocalNetworkInfo: jest.fn(),
  describeSubnet: jest.fn(),
  parseIPv4: jest.requireActual("@/services/localNetworkIdentity").parseIPv4,
}));

jest.mock("../jellyfin/session", () => ({
  getConfig: jest.fn(),
  getAuthHeader: jest.fn(),
}));

let mockStreamServer = "http://10.0.0.5:8096";
jest.mock("../jellyfin/streamUrls", () => ({
  getRemoteVideoStreamUrl: (id: string) => `${mockStreamServer}/Videos/${id}/stream?Static=true&MediaSourceId=${id}&ApiKey=key`,
}));

jest.mock("../jellyfin/items", () => ({
  fetchLibraryVideos: jest.fn(),
}));

jest.mock("@/services/downloads/localSource", () => ({
  playsFromDisk: jest.fn(),
}));

import * as SecureStore from "expo-secure-store";
import { NativeModules } from "react-native";
import { describeSubnet, getLocalNetworkInfo } from "@/services/localNetworkIdentity";
import { isPlaybackHeld } from "@/services/playbackHold";
import { playsFromDisk } from "@/services/downloads/localSource";
import { measureIfIdle, measureServerBitrate, nudgeBitrateMemory, rememberedBitrate, rememberedBitrateStatus, warmBitrateMemory } from "../jellyfin/bitrateTest";
import { fetchLibraryVideos } from "../jellyfin/items";
import { getAuthHeader, getConfig } from "../jellyfin/session";

const SERVER = "http://10.0.0.5:8096";
const HOST = "10.0.0.5:8096";
const HOME = "10.0.0.0/24";
const AWAY = "192.168.1.0/24";

const mockGetConfig = getConfig as jest.Mock;
const mockAuthHeader = getAuthHeader as jest.Mock;
const mockNetworkInfo = getLocalNetworkInfo as jest.Mock;
const mockDescribeSubnet = describeSubnet as jest.Mock;
const mockHeld = isPlaybackHeld as jest.Mock;
const mockGetItem = SecureStore.getItemAsync as jest.Mock;
const mockSetItem = SecureStore.setItemAsync as jest.Mock;
const mockLibrary = fetchLibraryVideos as jest.Mock;
const mockOnDisk = playsFromDisk as jest.Mock;

let now = 1_000_000_000;
let mockMeasure: jest.Mock;
let mockCancel: jest.Mock;

/** What the engine's probe hands back for a whole ten-second run read at `bps`. */
function link(bps: number, kind = "full", seconds = 10) {
  return { bps, kind, seconds, low: bps, high: bps };
}

function storedMemory(entry: Record<string, unknown> | null): void {
  mockGetItem.mockResolvedValue(entry ? JSON.stringify({ [HOST]: entry }) : null);
}

/** Report a different subnet from here on, past the module's cache window. */
function moveToSubnet(subnet: string | null): void {
  now += 11 * 1000;
  mockNetworkInfo.mockResolvedValue(subnet ? { ip: "10.0.0.9", netmask: "255.255.255.0", interfaceName: "en0" } : null);
  mockDescribeSubnet.mockReturnValue(subnet);
}

beforeEach(() => {
  jest.clearAllMocks();
  // Date stays real so the probe's own timing arithmetic is driven by `now`.
  jest.useFakeTimers({ doNotFake: ["Date"] });
  // Past every window the module keeps between calls: the cached subnet, the
  // failure backoff and the navigation floor all expire here.
  now += 10 * 60 * 1000;
  jest.spyOn(Date, "now").mockImplementation(() => now);

  mockGetConfig.mockResolvedValue({ server: SERVER, apiKey: "key", userId: "u", deviceId: "d" });
  mockAuthHeader.mockReturnValue('MediaBrowser Token="t"');
  mockNetworkInfo.mockResolvedValue({ ip: "10.0.0.9", netmask: "255.255.255.0", interfaceName: "en0" });
  mockDescribeSubnet.mockReturnValue(HOME);
  mockHeld.mockReturnValue(false);
  mockGetItem.mockResolvedValue(null);
  mockSetItem.mockResolvedValue(undefined);
  mockStreamServer = SERVER;
  mockLibrary.mockResolvedValue({ items: [{ Id: "v1" }, { Id: "v2" }] });
  mockOnDisk.mockReturnValue(false);
  mockMeasure = jest.fn();
  mockCancel = jest.fn(async () => undefined);
  NativeModules.LocalRemuxer = { measureLink: mockMeasure, cancelMeasureLink: mockCancel };
});

afterEach(() => {
  jest.runOnlyPendingTimers();
  jest.useRealTimers();
});

describe("measurement", () => {
  /**
   * A repeated probe asked for a byte-identical URL, which the platform's URL cache is free to
   * answer from. A cached body arrives in milliseconds and reads as a link an order of magnitude
   * faster than it is: a server measured at 3 Mb/s from every other client reported 32 on device.
   */
  it("never asks for the same URL twice, so no probe can be served from a cache", async () => {
    mockMeasure.mockResolvedValue(link(16_000_000));
    await measureServerBitrate();
    await measureServerBitrate();
    await measureServerBitrate();

    const urls = mockMeasure.mock.calls.map((call) => String(call[0]));
    expect(urls).toHaveLength(3);
    expect(new Set(urls).size).toBe(3);
    for (const url of urls) expect(url).toContain(`${SERVER}/Videos/v1/stream?Static=true`);
  });

  it("reads a real file, never a synthetic test body", async () => {
    mockMeasure.mockResolvedValue(link(16_000_000));
    await measureServerBitrate();

    expect(String(mockMeasure.mock.calls[0][0])).not.toContain("BitrateTest");
  });

  it("hands the engine's probe the server's auth, a ranged read and a budget", async () => {
    mockMeasure.mockResolvedValue(link(16_000_000));
    await measureServerBitrate();

    expect(mockAuthHeader).toHaveBeenCalledWith("d", "key");
    expect(mockMeasure.mock.calls[0][1]).toEqual({ Authorization: 'MediaBrowser Token="t"', Range: "bytes=0-" });
    expect(mockMeasure.mock.calls[0][2]).toBe(10_000);
  });

  it("skips a library file this device already holds", async () => {
    mockOnDisk.mockImplementation((id: string) => id === "v1");
    mockMeasure.mockResolvedValue(link(16_000_000));
    await measureServerBitrate();

    expect(String(mockMeasure.mock.calls[0][0])).toContain("/Videos/v2/stream");
  });

  it("measures nothing when the server has no file left to read", async () => {
    mockLibrary.mockResolvedValue({ items: [] });

    await expect(measureServerBitrate()).resolves.toBeNull();
    expect(mockMeasure).not.toHaveBeenCalled();
    expect(mockSetItem).not.toHaveBeenCalled();
  });

  it("remembers the probe's reading against the current subnet", async () => {
    mockMeasure.mockResolvedValueOnce(link(231_400_000));

    await expect(measureServerBitrate()).resolves.toBe(231_400_000);
    expect(mockMeasure).toHaveBeenCalledTimes(1);
    expect(JSON.parse(mockSetItem.mock.calls[0][1])[HOST]).toEqual({ bps: 231_400_000, at: expect.any(Number), net: HOME });
  });

  it("takes the whole run's reading", async () => {
    mockMeasure.mockResolvedValueOnce(link(58_000_000));

    await expect(measureServerBitrate()).resolves.toBe(58_000_000);
  });

  it("reads nothing on a build without the engine's probe", async () => {
    NativeModules.LocalRemuxer = {};

    await expect(measureServerBitrate()).resolves.toBeNull();
    expect(mockSetItem).not.toHaveBeenCalled();
  });

  it("treats a zero or broken rate as nothing measured", async () => {
    mockMeasure.mockResolvedValueOnce(link(0)).mockResolvedValueOnce(link(Number.NaN));

    await expect(measureServerBitrate()).resolves.toBeNull();
    now += 61 * 1000;
    await expect(measureServerBitrate()).resolves.toBeNull();
    expect(mockSetItem).not.toHaveBeenCalled();
  });

  it("shares one probe between concurrent callers", async () => {
    mockMeasure.mockResolvedValue(link(16_000_000));

    const [a, b] = await Promise.all([measureServerBitrate(), measureServerBitrate()]);
    expect(a).toBe(b);
    expect(mockMeasure).toHaveBeenCalledTimes(1);
  });

  it("remembers nothing from a read cut off before its budget", async () => {
    mockMeasure.mockResolvedValueOnce(link(300_000_000, "full", 2));

    await expect(measureServerBitrate()).resolves.toBeNull();
    expect(mockSetItem).not.toHaveBeenCalled();
  });

  it("ends the read when playback takes the link, keeps nothing and holds no backoff", async () => {
    let finish: (reading: ReturnType<typeof link> | null) => void = () => undefined;
    mockMeasure.mockReturnValueOnce(new Promise((resolve) => (finish = resolve)));

    const probe = measureServerBitrate();
    for (let tick = 0; tick < 50 && mockMeasure.mock.calls.length === 0; tick++) await Promise.resolve();
    expect(mockMeasure).toHaveBeenCalledTimes(1);
    mockHoldTaken.forEach((listener) => listener());
    expect(mockCancel).toHaveBeenCalledTimes(1);
    finish(link(40_000_000));

    await expect(probe).resolves.toBeNull();
    expect(mockSetItem).not.toHaveBeenCalled();
    expect(mockHoldTaken.size).toBe(0);
    mockMeasure.mockResolvedValueOnce(link(90_000_000));
    await expect(measureServerBitrate()).resolves.toBe(90_000_000);
  });

  it("starts no read when playback took the link while the file was looked up", async () => {
    mockHeld.mockReturnValue(true);

    await expect(measureServerBitrate()).resolves.toBeNull();
    expect(mockMeasure).not.toHaveBeenCalled();
  });

  it("remembers nothing when the server refuses the probe", async () => {
    mockMeasure.mockResolvedValueOnce(null);

    await expect(measureServerBitrate()).resolves.toBeNull();
    expect(mockSetItem).not.toHaveBeenCalled();
  });

  it("remembers nothing when the probe throws", async () => {
    mockMeasure.mockRejectedValueOnce(new Error("bridge"));

    await expect(measureServerBitrate()).resolves.toBeNull();
    expect(mockSetItem).not.toHaveBeenCalled();
  });

  it("holds a failed host for its backoff on a direct call, not only on a trigger", async () => {
    // Settings and the Auto startup pick call in here directly; both used to
    // re-probe a dead host on every visit, at 15s a time.
    mockMeasure.mockResolvedValue(null);

    await expect(measureServerBitrate()).resolves.toBeNull();
    await expect(measureServerBitrate()).resolves.toBeNull();
    expect(mockMeasure).toHaveBeenCalledTimes(1);

    now += 61 * 1000;
    await expect(measureServerBitrate()).resolves.toBeNull();
    expect(mockMeasure).toHaveBeenCalledTimes(2);
  });

  it("never hands one server's probe to a caller on another server", async () => {
    let releaseFirst: (value: unknown) => void = () => {};
    mockMeasure.mockImplementationOnce(() => new Promise((resolve) => (releaseFirst = resolve)));
    const first = measureServerBitrate();
    await jest.advanceTimersByTimeAsync(1);
    expect(mockMeasure).toHaveBeenCalledTimes(1);

    // The switch lands while the first probe is still running.
    mockGetConfig.mockResolvedValue({ server: "http://10.0.0.77:8096", apiKey: "key", userId: "u", deviceId: "d" });
    mockStreamServer = "http://10.0.0.77:8096";
    mockMeasure.mockResolvedValueOnce(link(16_000_000));

    await expect(measureServerBitrate()).resolves.toBe(16_000_000);
    expect(mockMeasure).toHaveBeenCalledTimes(2);
    expect(mockMeasure.mock.calls[0][0]).toContain("10.0.0.5");
    expect(mockMeasure.mock.calls[1][0]).toContain("10.0.0.77");

    releaseFirst(link(2_000_000));
    await first;
  });

  it("holds no backoff on a server whose read the next server's probe cancelled", async () => {
    let cancelFirst: (value: unknown) => void = () => {};
    mockMeasure.mockImplementationOnce(() => new Promise((resolve) => (cancelFirst = resolve)));
    const first = measureServerBitrate();
    await jest.advanceTimersByTimeAsync(1);

    mockGetConfig.mockResolvedValue({ server: "http://10.0.0.77:8096", apiKey: "key", userId: "u", deviceId: "d" });
    mockStreamServer = "http://10.0.0.77:8096";
    mockMeasure.mockResolvedValueOnce(link(16_000_000));
    await expect(measureServerBitrate()).resolves.toBe(16_000_000);
    cancelFirst(null);
    await expect(first).resolves.toBeNull();

    mockGetConfig.mockResolvedValue({ server: SERVER, apiKey: "key", userId: "u", deviceId: "d" });
    mockStreamServer = SERVER;
    mockMeasure.mockResolvedValueOnce(link(40_000_000));
    await expect(measureServerBitrate()).resolves.toBe(40_000_000);
  });

  it("keeps a switch back to the first server on the probe it started, not the replaced one's", async () => {
    const releases: ((value: unknown) => void)[] = [];
    mockMeasure.mockImplementation(() => new Promise((resolve) => releases.push(resolve)));
    const other = { server: "http://10.0.0.77:8096", apiKey: "key", userId: "u", deviceId: "d" };
    const home = { server: SERVER, apiKey: "key", userId: "u", deviceId: "d" };

    const first = measureServerBitrate();
    await jest.advanceTimersByTimeAsync(1);
    mockGetConfig.mockResolvedValue(other);
    const second = measureServerBitrate();
    await jest.advanceTimersByTimeAsync(1);
    mockGetConfig.mockResolvedValue(home);
    const third = measureServerBitrate();
    await jest.advanceTimersByTimeAsync(1);
    expect(mockMeasure).toHaveBeenCalledTimes(3);

    releases[0](null);
    await expect(first).resolves.toBeNull();
    const shared = measureServerBitrate();
    await jest.advanceTimersByTimeAsync(1);
    expect(mockMeasure).toHaveBeenCalledTimes(3);

    releases[1](null);
    releases[2](link(40_000_000));
    await expect(third).resolves.toBe(40_000_000);
    await expect(shared).resolves.toBe(40_000_000);
    await expect(second).resolves.toBeNull();
  });
});

describe("what a reading answers for", () => {
  it("stands at any age on the subnet it was measured on", async () => {
    storedMemory({ bps: 90_000_000, at: now - 3 * 24 * 60 * 60 * 1000, net: HOME });

    // Three days old. The link is the same link, and the routing gate would
    // rather have this than nothing.
    await expect(rememberedBitrate()).resolves.toBe(90_000_000);
  });

  it("is void on a different subnet however fresh it is", async () => {
    storedMemory({ bps: 90_000_000, at: now - 1_000, net: AWAY });

    await expect(rememberedBitrate()).resolves.toBeNull();
  });

  it("falls back to the age backstop when the network cannot be identified", async () => {
    moveToSubnet(null);
    storedMemory({ bps: 90_000_000, at: now - 60 * 60 * 1000, net: HOME });
    await expect(rememberedBitrate()).resolves.toBe(90_000_000);

    storedMemory({ bps: 90_000_000, at: now - 25 * 60 * 60 * 1000, net: HOME });
    await expect(rememberedBitrate()).resolves.toBeNull();
  });

  it("reads an entry written before subnets were recorded on age alone", async () => {
    storedMemory({ bps: 90_000_000, at: now - 60 * 60 * 1000 });

    await expect(rememberedBitrate()).resolves.toBe(90_000_000);
  });

  it("reports freshness to the settings surface off the refresh window", async () => {
    storedMemory({ bps: 90_000_000, at: now - 60 * 1000, net: HOME });
    await expect(rememberedBitrateStatus()).resolves.toEqual({ bps: 90_000_000, fresh: true });

    storedMemory({ bps: 90_000_000, at: now - 20 * 60 * 1000, net: HOME });
    await expect(rememberedBitrateStatus()).resolves.toEqual({ bps: 90_000_000, fresh: false });
  });
});

describe("triggers", () => {
  it("measures on a warm-up when nothing answers for this link", async () => {
    mockMeasure.mockResolvedValue(link(16_000_000));

    warmBitrateMemory(0);
    await jest.advanceTimersByTimeAsync(1);
    expect(mockMeasure).toHaveBeenCalledTimes(1);
  });

  it("leaves a fresh reading on this subnet alone", async () => {
    storedMemory({ bps: 90_000_000, at: now - 60 * 1000, net: HOME });

    warmBitrateMemory(0);
    await jest.advanceTimersByTimeAsync(1);
    expect(mockMeasure).not.toHaveBeenCalled();
  });

  it("re-measures a fresh reading taken on another subnet", async () => {
    storedMemory({ bps: 90_000_000, at: now - 60 * 1000, net: AWAY });
    mockMeasure.mockResolvedValue(link(16_000_000));

    warmBitrateMemory(0);
    await jest.advanceTimersByTimeAsync(1);
    expect(mockMeasure).toHaveBeenCalledTimes(1);
  });

  it("stands down while playback owns the link", async () => {
    mockHeld.mockReturnValue(true);

    warmBitrateMemory(0);
    await jest.advanceTimersByTimeAsync(1);
    expect(mockMeasure).not.toHaveBeenCalled();
  });

  it("holds a failed host for its backoff instead of retrying on every trigger", async () => {
    mockMeasure.mockResolvedValue(null);

    warmBitrateMemory(0);
    await jest.advanceTimersByTimeAsync(1);
    expect(mockMeasure).toHaveBeenCalledTimes(1);

    warmBitrateMemory(0);
    await jest.advanceTimersByTimeAsync(1);
    expect(mockMeasure).toHaveBeenCalledTimes(1);

    now += 61 * 1000;
    warmBitrateMemory(0);
    await jest.advanceTimersByTimeAsync(1);
    expect(mockMeasure).toHaveBeenCalledTimes(2);
  });

  it("stays out of the launch window until the warm-up has run", async () => {
    // The latch is once per process, so this needs a module that has never been
    // warmed, which means re-wiring the mocks inside the isolated registry.
    await jest.isolateModulesAsync(async () => {
      const secureStore = require("expo-secure-store");
      const identity = require("@/services/localNetworkIdentity");
      const hold = require("@/services/playbackHold");
      const session = require("../jellyfin/session");
      secureStore.getItemAsync.mockResolvedValue(null);
      identity.getLocalNetworkInfo.mockResolvedValue({ ip: "10.0.0.9", netmask: "255.255.255.0", interfaceName: "en0" });
      identity.describeSubnet.mockReturnValue(HOME);
      hold.isPlaybackHeld.mockReturnValue(false);
      session.getConfig.mockResolvedValue({ server: SERVER, apiKey: "key", userId: "u", deviceId: "d" });

      const fresh = require("../jellyfin/bitrateTest") as typeof import("../jellyfin/bitrateTest");
      fresh.nudgeBitrateMemory();
      await jest.advanceTimersByTimeAsync(2_100);
      expect(secureStore.getItemAsync).not.toHaveBeenCalled();

      fresh.warmBitrateMemory(0);
      await jest.advanceTimersByTimeAsync(1);
      expect(secureStore.getItemAsync).toHaveBeenCalled();
    });
  });

  it("collapses a navigation burst into one attempt and floors the next one", async () => {
    mockMeasure.mockResolvedValue(link(16_000_000));
    // The launch warm-up runs first and hands navigation the wheel.
    warmBitrateMemory(0);
    await jest.advanceTimersByTimeAsync(1);
    expect(mockMeasure).toHaveBeenCalledTimes(1);
    mockMeasure.mockClear();
    now += 20 * 60 * 1000;
    storedMemory(null);

    nudgeBitrateMemory();
    nudgeBitrateMemory();
    nudgeBitrateMemory();
    await jest.advanceTimersByTimeAsync(2_100);
    expect(mockMeasure).toHaveBeenCalledTimes(1);

    // Inside the floor: the next burst must not even reach the keychain.
    mockGetItem.mockClear();
    nudgeBitrateMemory();
    await jest.advanceTimersByTimeAsync(2_100);
    expect(mockGetItem).not.toHaveBeenCalled();
    expect(mockMeasure).toHaveBeenCalledTimes(1);
  });

  it("declines the settings measurement while playback owns the link", async () => {
    mockHeld.mockReturnValue(true);

    await expect(measureIfIdle()).resolves.toBeNull();
    expect(mockMeasure).not.toHaveBeenCalled();
  });

  it("hands the new reading back to the settings surface", async () => {
    mockMeasure.mockResolvedValue(link(4_000_000));

    await expect(measureIfIdle()).resolves.toBe(4_000_000);
  });
});
