/**
 * The handshake watch: only a server on this device's own subnet is asked, a refusal is reported
 * once per watch, and an answer is reused across a burst of requests.
 */
import { ipv4Endpoint, LAN_CONNECT_TIMEOUT_MS, onSubnet, resetServerHandshakeForTests, watchServerHandshake } from "../serverHandshake";

const mockScanOpenPorts = jest.fn();
const mockGetLocalNetworkInfo = jest.fn();

jest.mock("react-native", () => ({
  NativeModules: {
    NetworkInfo: {
      scanOpenPorts: (...args: unknown[]) => mockScanOpenPorts(...args),
      getLocalNetworkInfo: () => mockGetLocalNetworkInfo(),
    },
  },
  Platform: { OS: "ios", isTV: true },
}));
jest.mock("@/utils/logger", () => ({ logger: { error: jest.fn(), info: jest.fn(), debug: jest.fn(), warn: jest.fn() } }));

const LOCAL = { ip: "192.168.1.20", netmask: "255.255.255.0", interfaceName: "en0" };
const flush = async () => {
  for (let hop = 0; hop < 10; hop++) await Promise.resolve();
};

beforeEach(() => {
  jest.clearAllMocks();
  resetServerHandshakeForTests();
  mockGetLocalNetworkInfo.mockResolvedValue(LOCAL);
});

describe("ipv4Endpoint", () => {
  it("reads the host and the port, defaulting it by scheme", () => {
    expect(ipv4Endpoint("http://192.168.1.5:8096/Items?x=1")).toEqual({ host: "192.168.1.5", port: 8096 });
    expect(ipv4Endpoint("https://10.0.0.2/jellyfin")).toEqual({ host: "10.0.0.2", port: 443 });
    expect(ipv4Endpoint("http://10.0.0.2")).toEqual({ host: "10.0.0.2", port: 80 });
  });

  it("leaves hostnames, other schemes and malformed addresses alone", () => {
    expect(ipv4Endpoint("http://jellyfin.local:8096/")).toBeNull();
    expect(ipv4Endpoint("https://demo.jellyfin.org/stable")).toBeNull();
    expect(ipv4Endpoint("http://192.168.1.300:8096/")).toBeNull();
    expect(ipv4Endpoint("http://192.168.1.5:99999/")).toBeNull();
    expect(ipv4Endpoint("ws://192.168.1.5:8096/socket")).toBeNull();
  });
});

describe("onSubnet", () => {
  it("compares under the interface's real netmask", () => {
    expect(onSubnet("192.168.1.5", LOCAL)).toBe(true);
    expect(onSubnet("192.168.2.5", LOCAL)).toBe(false);
    expect(onSubnet("10.48.1.51", { ip: "10.48.0.20", netmask: "255.255.254.0", interfaceName: "en0" })).toBe(true);
  });
});

describe("watchServerHandshake", () => {
  it("reports a server on the subnet that accepts no connection, asking the sweep with the scan's budget", async () => {
    mockScanOpenPorts.mockResolvedValue([]);
    const refused = jest.fn();
    watchServerHandshake("http://192.168.1.5:8096/Items", refused);
    await flush();
    expect(mockScanOpenPorts).toHaveBeenCalledWith(["192.168.1.5"], [8096], LAN_CONNECT_TIMEOUT_MS, 1);
    expect(refused).toHaveBeenCalledTimes(1);
  });

  it("stays quiet for a server that accepts", async () => {
    mockScanOpenPorts.mockResolvedValue([{ host: "192.168.1.5", port: 8096 }]);
    const refused = jest.fn();
    watchServerHandshake("http://192.168.1.5:8096/Items", refused);
    await flush();
    expect(refused).not.toHaveBeenCalled();
  });

  it("asks nothing about a private address off this subnet, which a router or a tunnel may carry", async () => {
    const refused = jest.fn();
    watchServerHandshake("http://10.8.0.1:8096/Items", refused);
    await flush();
    expect(mockScanOpenPorts).not.toHaveBeenCalled();
    expect(refused).not.toHaveBeenCalled();
  });

  it("asks nothing about a hostname", async () => {
    watchServerHandshake("http://jellyfin.local:8096/Items", jest.fn());
    await flush();
    expect(mockGetLocalNetworkInfo).not.toHaveBeenCalled();
    expect(mockScanOpenPorts).not.toHaveBeenCalled();
  });

  it("asks nothing when the device's own network is unknown", async () => {
    mockGetLocalNetworkInfo.mockResolvedValue(null);
    watchServerHandshake("http://192.168.1.5:8096/Items", jest.fn());
    await flush();
    expect(mockScanOpenPorts).not.toHaveBeenCalled();
  });

  it("reports nothing once stopped", async () => {
    let answer!: (found: unknown[]) => void;
    mockScanOpenPorts.mockReturnValue(new Promise((resolve) => (answer = resolve)));
    const refused = jest.fn();
    const stop = watchServerHandshake("http://192.168.1.5:8096/Items", refused);
    await flush();
    stop();
    answer([]);
    await flush();
    expect(refused).not.toHaveBeenCalled();
  });

  it("treats a sweep that failed as no answer", async () => {
    mockScanOpenPorts.mockRejectedValue(new Error("native"));
    const refused = jest.fn();
    watchServerHandshake("http://192.168.1.5:8096/Items", refused);
    await flush();
    expect(refused).not.toHaveBeenCalled();
  });

  it("reuses an accepted handshake across a burst", async () => {
    mockScanOpenPorts.mockResolvedValue([{ host: "192.168.1.5", port: 8096 }]);
    watchServerHandshake("http://192.168.1.5:8096/a", jest.fn());
    watchServerHandshake("http://192.168.1.5:8096/b", jest.fn());
    await flush();
    watchServerHandshake("http://192.168.1.5:8096/c", jest.fn());
    await flush();
    expect(mockScanOpenPorts).toHaveBeenCalledTimes(1);
  });

  it("asks again after a refusal, so a server that came back is seen at once", async () => {
    mockScanOpenPorts.mockResolvedValueOnce([]).mockResolvedValueOnce([{ host: "192.168.1.5", port: 8096 }]);
    const first = jest.fn();
    watchServerHandshake("http://192.168.1.5:8096/a", first);
    await flush();
    const second = jest.fn();
    watchServerHandshake("http://192.168.1.5:8096/b", second);
    await flush();
    expect(mockScanOpenPorts).toHaveBeenCalledTimes(2);
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).not.toHaveBeenCalled();
  });

  it("asks again once an accepted handshake is older than its reuse window", async () => {
    const now = jest.spyOn(Date, "now").mockReturnValue(1_000_000);
    try {
      mockScanOpenPorts.mockResolvedValue([{ host: "192.168.1.5", port: 8096 }]);
      watchServerHandshake("http://192.168.1.5:8096/a", jest.fn());
      await flush();
      now.mockReturnValue(1_005_001);
      watchServerHandshake("http://192.168.1.5:8096/b", jest.fn());
      await flush();
      expect(mockScanOpenPorts).toHaveBeenCalledTimes(2);
    } finally {
      now.mockRestore();
    }
  });
});
