import { buildSweepHosts, describeSubnet, extractHost, getLocalNetworkInfo, scanLocalNetwork, subnetMismatchHint } from "../networkDiscovery";
import type { LocalNetworkInfo } from "../networkDiscovery";

jest.mock("@/services/libraryManager", () => ({
  libraryManager: { clearCache: jest.fn() },
}));

const mockFetch = jest.fn();
global.fetch = mockFetch;

const LOCAL: LocalNetworkInfo = { ip: "10.48.1.20", netmask: "255.255.255.0", interfaceName: "en0" };

/** Respond as a Jellyfin server for the listed base URLs, and fail for everything else. */
function serveJellyfinAt(servers: Record<string, { name: string; id: string }>) {
  mockFetch.mockImplementation(async (url: string) => {
    const base = url.replace("/System/Info/Public", "");
    const server = servers[base];
    if (!server) throw new Error("connection refused");
    return {
      ok: true,
      json: async () => ({ ServerName: server.name, Version: "10.9.0", Id: server.id }),
    };
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  mockFetch.mockReset();
});

describe("buildSweepHosts", () => {
  it("covers every usable host on a /24", () => {
    const hosts = buildSweepHosts("10.48.1.20", "255.255.255.0");

    // 254 usable addresses, .1 through .254.
    expect(hosts).toHaveLength(254);
    expect(hosts[0]).toBe("10.48.1.1");
    expect(hosts[hosts.length - 1]).toBe("10.48.1.254");
  });

  it("excludes the network and broadcast addresses", () => {
    const hosts = buildSweepHosts("192.168.0.5", "255.255.255.0");

    expect(hosts).not.toContain("192.168.0.0"); // network
    expect(hosts).not.toContain("192.168.0.255"); // broadcast
    expect(hosts).toContain("192.168.0.1");
  });

  it("probes the device's own address, which is the server's on the simulator", () => {
    // The simulator shares the host Mac's network stack, so a Jellyfin server on
    // that Mac sits at the "device" IP. Skipping self would hide it entirely.
    expect(buildSweepHosts("10.48.1.51", "255.255.254.0")).toContain("10.48.1.51");
  });

  it("sweeps a whole /23, where the server can sit in the other half", () => {
    // Real-world case: the server is 10.48.1.51/23, so an Apple TV that pulled
    // a 10.48.0.x address shares its subnet. Clamping to /24 would skip the server.
    const hosts = buildSweepHosts("10.48.0.87", "255.255.254.0");

    expect(hosts).toHaveLength(510);
    expect(hosts[0]).toBe("10.48.0.1");
    expect(hosts).toContain("10.48.1.51");
    expect(hosts[hosts.length - 1]).toBe("10.48.1.254");
  });

  it("clamps a /16 to the device's own /24 instead of enumerating 65k hosts", () => {
    const hosts = buildSweepHosts("10.48.1.20", "255.255.0.0");

    expect(hosts).toHaveLength(254);
    expect(hosts[0]).toBe("10.48.1.1");
    expect(hosts).not.toContain("10.48.2.1");
  });

  it("clamps a /22, which is past the sweep budget", () => {
    expect(buildSweepHosts("10.48.1.20", "255.255.252.0")).toHaveLength(254);
  });

  it("keeps a subnet narrower than /24 as-is", () => {
    const hosts = buildSweepHosts("192.168.0.10", "255.255.255.128");

    // .1 through .126 is 126 usable addresses.
    expect(hosts).toHaveLength(126);
    expect(hosts[hosts.length - 1]).toBe("192.168.0.126");
  });

  it("returns nothing for a malformed address or netmask", () => {
    expect(buildSweepHosts("not-an-ip", "255.255.255.0")).toEqual([]);
    expect(buildSweepHosts("10.48.1.20", "")).toEqual([]);
    expect(buildSweepHosts("10.48.1.999", "255.255.255.0")).toEqual([]);
  });
});

describe("describeSubnet", () => {
  it("gives exact CIDR when the netmask is known", () => {
    expect(describeSubnet("10.48.0.87", "255.255.254.0")).toBe("10.48.0.0/23");
    expect(describeSubnet("192.168.1.30", "255.255.255.0")).toBe("192.168.1.0/24");
  });

  it("falls back to the /24 label without a netmask", () => {
    expect(describeSubnet("10.48.1.20")).toBe("10.48.1.x");
  });

  it("passes through anything that isn't dotted-quad", () => {
    expect(describeSubnet("jellyfin.local")).toBe("jellyfin.local");
  });
});

describe("extractHost", () => {
  it.each([
    ["10.48.1.51", "10.48.1.51"],
    ["http://10.48.1.51:8096", "10.48.1.51"],
    ["https://10.48.1.51/jellyfin", "10.48.1.51"],
    ["10.48.1.51:8096/jellyfin", "10.48.1.51"],
    ["  jellyfin.local  ", "jellyfin.local"],
  ])("reduces %s to %s", (input, expected) => {
    expect(extractHost(input)).toBe(expected);
  });
});

describe("subnetMismatchHint", () => {
  it("flags a private address on a different subnet", () => {
    const hint = subnetMismatchHint("10.48.1.51", { ...LOCAL, ip: "192.168.1.30" });

    expect(hint).toContain("192.168.1.0/24");
  });

  it("stays quiet when the address is on this device's subnet", () => {
    expect(subnetMismatchHint("10.48.1.51", LOCAL)).toBeNull();
  });

  it("stays quiet across /24 halves of the same /23, which really are one subnet", () => {
    // Real-world case: Apple TV on 10.48.0.87/23, server on 10.48.1.51. Comparing
    // /24s would have wrongly claimed these are on different networks.
    const wideLocal = { ip: "10.48.0.87", netmask: "255.255.254.0", interfaceName: "en0" };

    expect(subnetMismatchHint("10.48.1.51", wideLocal)).toBeNull();
  });

  it("stays quiet for public addresses, which route normally", () => {
    expect(subnetMismatchHint("203.0.113.10", LOCAL)).toBeNull();
  });

  it("stays quiet for hostnames, which say nothing about the subnet", () => {
    expect(subnetMismatchHint("jellyfin.example.com", LOCAL)).toBeNull();
  });

  it("stays quiet when this device's address is unknown", () => {
    expect(subnetMismatchHint("10.48.1.51", null)).toBeNull();
  });

  it("looks past the scheme, port, and path to find the address", () => {
    expect(subnetMismatchHint("http://192.168.9.4:8096/jellyfin", LOCAL)).toContain("10.48.1.0/24");
  });
});

describe("getLocalNetworkInfo", () => {
  it("returns null when the native module is absent", async () => {
    // react-native is mocked without NetworkInfo in this suite's module registry.
    await expect(getLocalNetworkInfo()).resolves.toBeNull();
  });
});

describe("scanLocalNetwork", () => {
  it("finds a server on the default HTTP port", async () => {
    serveJellyfinAt({ "http://10.48.1.51:8096": { name: "Home Jellyfin", id: "server-a" } });

    const found = await scanLocalNetwork(LOCAL);

    expect(found).toEqual([{ url: "http://10.48.1.51:8096", name: "Home Jellyfin", id: "server-a", version: "10.9.0" }]);
  });

  it("finds a server running on the device's own address", async () => {
    // The simulator case: Jellyfin runs on the host Mac, so it answers at the
    // very IP getifaddrs reports as "this device".
    serveJellyfinAt({ "http://10.48.1.51:8096": { name: "veguitas", id: "server-self" } });

    const found = await scanLocalNetwork({ ip: "10.48.1.51", netmask: "255.255.254.0", interfaceName: "en0" });

    expect(found).toEqual([{ url: "http://10.48.1.51:8096", name: "veguitas", id: "server-self", version: "10.9.0" }]);
  });

  it("streams each hit through onFound as it is discovered", async () => {
    serveJellyfinAt({
      "http://10.48.1.51:8096": { name: "One", id: "server-a" },
      "http://10.48.1.77:8096": { name: "Two", id: "server-b" },
    });

    const onFound = jest.fn();
    await scanLocalNetwork(LOCAL, { onFound });

    expect(onFound).toHaveBeenCalledTimes(2);
    expect(onFound.mock.calls.map(([server]) => server.id).sort()).toEqual(["server-a", "server-b"]);
  });

  it("reports one entry for a server reachable on both ports", async () => {
    serveJellyfinAt({
      "http://10.48.1.51:8096": { name: "Home", id: "same-server" },
      "https://10.48.1.51:8920": { name: "Home", id: "same-server" },
    });

    const found = await scanLocalNetwork(LOCAL);

    expect(found).toHaveLength(1);
    expect(found[0].url).toBe("http://10.48.1.51:8096");
  });

  it("dedups two addresses that answer as the same server", async () => {
    serveJellyfinAt({
      "http://10.48.1.51:8096": { name: "Home", id: "same-server" },
      "http://10.48.1.52:8096": { name: "Home", id: "same-server" },
    });

    const found = await scanLocalNetwork(LOCAL);

    expect(found).toHaveLength(1);
  });

  it("falls back to HTTPS on 8920 when 8096 is closed", async () => {
    serveJellyfinAt({ "https://10.48.1.51:8920": { name: "Secure", id: "server-tls" } });

    const found = await scanLocalNetwork(LOCAL);

    expect(found).toEqual([{ url: "https://10.48.1.51:8920", name: "Secure", id: "server-tls", version: "10.9.0" }]);
  });

  it("reports progress across every host on the subnet", async () => {
    serveJellyfinAt({});

    const onProgress = jest.fn();
    await scanLocalNetwork(LOCAL, { onProgress });

    const [, total] = onProgress.mock.calls[0];
    expect(total).toBe(254);
    expect(onProgress).toHaveBeenCalledTimes(254);
  });

  it("returns empty when nothing on the subnet answers", async () => {
    serveJellyfinAt({});

    await expect(scanLocalNetwork(LOCAL)).resolves.toEqual([]);
  });

  it("ignores a host that answers but is not Jellyfin", async () => {
    mockFetch.mockImplementation(async () => ({ ok: true, json: async () => ({ message: "hello from a router" }) }));

    await expect(scanLocalNetwork(LOCAL)).resolves.toEqual([]);
  });

  it("stops early when aborted, leaving most of the subnet unprobed", async () => {
    serveJellyfinAt({});

    const controller = new AbortController();
    const onProgress = jest.fn(() => {
      if (onProgress.mock.calls.length >= 5) controller.abort();
    });

    await scanLocalNetwork(LOCAL, { onProgress, signal: controller.signal });

    // Workers finish their in-flight host, so allow for the concurrency window.
    expect(onProgress.mock.calls.length).toBeLessThan(60);
  });

  it("does nothing when the subnet can't be derived", async () => {
    serveJellyfinAt({});

    const found = await scanLocalNetwork({ ip: "bogus", netmask: "bogus", interfaceName: "en0" });

    expect(found).toEqual([]);
    expect(mockFetch).not.toHaveBeenCalled();
  });
});
