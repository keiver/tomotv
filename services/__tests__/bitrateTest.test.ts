/** bitrateTest - the per-server link measurement the playback routing gate reads. */

jest.mock("@/utils/logger", () => ({
  logger: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

jest.mock("@/services/playbackHold", () => ({
  isPlaybackHeld: jest.fn(),
}));

jest.mock("@/services/localNetworkIdentity", () => ({
  getLocalNetworkInfo: jest.fn(),
  describeSubnet: jest.fn(),
}));

jest.mock("../jellyfin/session", () => ({
  getConfig: jest.fn(),
  getAuthHeader: jest.fn(),
}));

import * as SecureStore from "expo-secure-store";
import { describeSubnet, getLocalNetworkInfo } from "@/services/localNetworkIdentity";
import { isPlaybackHeld } from "@/services/playbackHold";
import { measureIfIdle, measureServerBitrate, nudgeBitrateMemory, rememberedBitrate, rememberedBitrateStatus, warmBitrateMemory } from "../jellyfin/bitrateTest";
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

let now = 1_000_000_000;
let mockFetch: jest.Mock;

/** A probe response whose body read costs `elapsedMs` of wall clock. */
function stage(bytes: number, elapsedMs: number) {
  return {
    ok: true,
    arrayBuffer: async () => {
      now += elapsedMs;
      return new ArrayBuffer(bytes);
    },
  };
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
  mockFetch = jest.fn();
  global.fetch = mockFetch as unknown as typeof fetch;
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
    mockFetch.mockResolvedValue(stage(500_000, 1_000));
    await measureServerBitrate();
    await measureServerBitrate();
    await measureServerBitrate();

    const urls = mockFetch.mock.calls.map((call) => String(call[0]));
    expect(urls).toHaveLength(3);
    expect(new Set(urls).size).toBe(3);
    for (const url of urls) expect(url).toContain("Size=500000");
  });

  it("stays unique across both stages of one probe", async () => {
    // Fast first stage, so the refine runs and both URLs come from the same probe.
    mockFetch.mockResolvedValueOnce(stage(500_000, 100)).mockResolvedValueOnce(stage(2_000_000, 200));
    await measureServerBitrate();

    const urls = mockFetch.mock.calls.map((call) => String(call[0]));
    expect(urls).toHaveLength(2);
    expect(new Set(urls).size).toBe(2);
  });

  it("times the body and remembers the reading against the current subnet", async () => {
    mockFetch.mockResolvedValueOnce(stage(500_000, 1_000));

    // 500 KB in 1s = 4 Mbps. Too slow to read as timer noise, so one stage only.
    await expect(measureServerBitrate()).resolves.toBe(4_000_000);
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(JSON.parse(mockSetItem.mock.calls[0][1])[HOST]).toEqual({ bps: 4_000_000, at: expect.any(Number), net: HOME });
  });

  it("issues the stage under an abort budget", async () => {
    mockFetch.mockResolvedValueOnce(stage(500_000, 1_000));
    await measureServerBitrate();

    const signal = mockFetch.mock.calls[0][1].signal;
    expect(signal).toBeInstanceOf(AbortSignal);
    expect(signal.aborted).toBe(false);
  });

  it("refines with the big stage when the small one reads as timer noise", async () => {
    mockFetch.mockResolvedValueOnce(stage(500_000, 100)).mockResolvedValueOnce(stage(2_000_000, 500));

    await expect(measureServerBitrate()).resolves.toBe(32_000_000);
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it("keeps the small stage's reading when the refine stage dies", async () => {
    mockFetch.mockResolvedValueOnce(stage(500_000, 100)).mockRejectedValueOnce(new Error("aborted"));

    // 500 KB in 100ms = 40 Mbps. The refine measured the same link; losing it
    // must not cost the reading that already landed.
    await expect(measureServerBitrate()).resolves.toBe(40_000_000);
    expect(JSON.parse(mockSetItem.mock.calls[0][1])[HOST].bps).toBe(40_000_000);
  });

  it("shares one download between concurrent callers", async () => {
    mockFetch.mockResolvedValue(stage(500_000, 1_000));

    const [a, b] = await Promise.all([measureServerBitrate(), measureServerBitrate()]);
    expect(a).toBe(b);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it("keeps the in-playback probe out of the shared probe and out of the memory", async () => {
    mockFetch.mockResolvedValue(stage(500_000, 1_000));

    await Promise.all([measureServerBitrate(), measureServerBitrate({ remember: false })]);
    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(mockSetItem).toHaveBeenCalledTimes(1);
  });

  it("remembers nothing when the server refuses the probe", async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, arrayBuffer: jest.fn() });

    await expect(measureServerBitrate()).resolves.toBeNull();
    expect(mockSetItem).not.toHaveBeenCalled();
  });

  it("holds a failed host for its backoff on a direct call, not only on a trigger", async () => {
    // Settings and the Auto startup pick call in here directly; both used to
    // re-probe a dead host on every visit, at 15s a time.
    mockFetch.mockResolvedValue({ ok: false, arrayBuffer: jest.fn() });

    await expect(measureServerBitrate()).resolves.toBeNull();
    await expect(measureServerBitrate()).resolves.toBeNull();
    expect(mockFetch).toHaveBeenCalledTimes(1);

    now += 61 * 1000;
    await expect(measureServerBitrate()).resolves.toBeNull();
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it("never hands one server's probe to a caller on another server", async () => {
    let releaseFirst: (value: unknown) => void = () => {};
    mockFetch.mockImplementationOnce(() => new Promise((resolve) => (releaseFirst = resolve)));
    const first = measureServerBitrate();
    await jest.advanceTimersByTimeAsync(1);
    expect(mockFetch).toHaveBeenCalledTimes(1);

    // The switch lands while the first probe is still downloading.
    mockGetConfig.mockResolvedValue({ server: "http://10.0.0.77:8096", apiKey: "key", userId: "u", deviceId: "d" });
    mockFetch.mockResolvedValueOnce(stage(500_000, 1_000));

    await expect(measureServerBitrate()).resolves.toBe(4_000_000);
    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(mockFetch.mock.calls[0][0]).toContain("10.0.0.5");
    expect(mockFetch.mock.calls[1][0]).toContain("10.0.0.77");

    releaseFirst(stage(500_000, 2_000));
    await first;
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
    mockFetch.mockResolvedValue(stage(500_000, 1_000));

    warmBitrateMemory(0);
    await jest.advanceTimersByTimeAsync(1);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it("leaves a fresh reading on this subnet alone", async () => {
    storedMemory({ bps: 90_000_000, at: now - 60 * 1000, net: HOME });

    warmBitrateMemory(0);
    await jest.advanceTimersByTimeAsync(1);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("re-measures a fresh reading taken on another subnet", async () => {
    storedMemory({ bps: 90_000_000, at: now - 60 * 1000, net: AWAY });
    mockFetch.mockResolvedValue(stage(500_000, 1_000));

    warmBitrateMemory(0);
    await jest.advanceTimersByTimeAsync(1);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it("stands down while playback owns the link", async () => {
    mockHeld.mockReturnValue(true);

    warmBitrateMemory(0);
    await jest.advanceTimersByTimeAsync(1);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("holds a failed host for its backoff instead of retrying on every trigger", async () => {
    mockFetch.mockResolvedValue({ ok: false, arrayBuffer: jest.fn() });

    warmBitrateMemory(0);
    await jest.advanceTimersByTimeAsync(1);
    expect(mockFetch).toHaveBeenCalledTimes(1);

    warmBitrateMemory(0);
    await jest.advanceTimersByTimeAsync(1);
    expect(mockFetch).toHaveBeenCalledTimes(1);

    now += 61 * 1000;
    warmBitrateMemory(0);
    await jest.advanceTimersByTimeAsync(1);
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it("stays out of the launch window until the warm-up has run", async () => {
    // The latch is once per process, so this needs a module that has never been
    // warmed — which means re-wiring the mocks inside the isolated registry.
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
    mockFetch.mockResolvedValue(stage(500_000, 1_000));
    // The launch warm-up runs first and hands navigation the wheel.
    warmBitrateMemory(0);
    await jest.advanceTimersByTimeAsync(1);
    expect(mockFetch).toHaveBeenCalledTimes(1);
    mockFetch.mockClear();
    now += 20 * 60 * 1000;
    storedMemory(null);

    nudgeBitrateMemory();
    nudgeBitrateMemory();
    nudgeBitrateMemory();
    await jest.advanceTimersByTimeAsync(2_100);
    expect(mockFetch).toHaveBeenCalledTimes(1);

    // Inside the floor: the next burst must not even reach the keychain.
    mockGetItem.mockClear();
    nudgeBitrateMemory();
    await jest.advanceTimersByTimeAsync(2_100);
    expect(mockGetItem).not.toHaveBeenCalled();
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it("declines the settings measurement while playback owns the link", async () => {
    mockHeld.mockReturnValue(true);

    await expect(measureIfIdle()).resolves.toBeNull();
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("hands the new reading back to the settings surface", async () => {
    mockFetch.mockResolvedValue(stage(500_000, 1_000));

    await expect(measureIfIdle()).resolves.toBe(4_000_000);
  });
});
