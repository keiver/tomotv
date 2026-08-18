import { buildSweepHosts, describeSubnet, extractHost, getLocalNetworkInfo, prioritizeHosts, scanLocalNetwork, subnetMismatchHint } from "../networkDiscovery";
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

describe("prioritizeHosts", () => {
  const hosts = ["10.48.1.1", "10.48.1.2", "10.48.1.3"];

  it("moves saved hosts to the front, keeping their given order", () => {
    expect(prioritizeHosts(hosts, ["10.48.1.3", "10.48.1.2"])).toEqual(["10.48.1.3", "10.48.1.2", "10.48.1.1"]);
  });

  it("drops priority entries outside the sweep, like other subnets and hostnames", () => {
    expect(prioritizeHosts(hosts, ["192.168.7.4", "jellyfin.local"])).toEqual(hosts);
  });

  it("dedups a host saved more than once, e.g. on two ports", () => {
    expect(prioritizeHosts(hosts, ["10.48.1.2", "10.48.1.2"])).toEqual(["10.48.1.2", "10.48.1.1", "10.48.1.3"]);
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

  it("reports one entry for a server reachable on both ports, preferring HTTPS", async () => {
    serveJellyfinAt({
      "http://10.48.1.51:8096": { name: "Home", id: "same-server" },
      "https://10.48.1.51:8920": { name: "Home", id: "same-server" },
    });

    const found = await scanLocalNetwork(LOCAL);

    expect(found).toHaveLength(1);
    // This URL is the one the user then logs in through, so a working
    // certificate wins. A self-signed one fails the fetch and falls to HTTP.
    expect(found[0].url).toBe("https://10.48.1.51:8920");
  });

  it("finds a server behind a reverse proxy on 443", async () => {
    serveJellyfinAt({ "https://10.48.1.51:443": { name: "Proxied", id: "server-proxy" } });

    const found = await scanLocalNetwork(LOCAL);

    expect(found).toEqual([{ url: "https://10.48.1.51:443", name: "Proxied", id: "server-proxy", version: "10.9.0" }]);
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

  it("probes a priority host before the rest of the subnet", async () => {
    serveJellyfinAt({ "http://10.48.1.200:8096": { name: "Saved", id: "server-saved" } });

    await scanLocalNetwork(LOCAL, { priorityHosts: ["10.48.1.200"] });

    // First fetch is the permission warm-up; the sweep proper starts right after
    // and must open with the saved address, not 10.48.1.1.
    const urls = mockFetch.mock.calls.map(([url]) => url as string);
    const priorityIndex = urls.findIndex((url) => url.includes("//10.48.1.200:"));
    const firstOtherIndex = urls.findIndex((url) => url.includes("//10.48.1.1:"));
    expect(priorityIndex).toBeGreaterThan(0);
    expect(priorityIndex).toBeLessThan(firstOtherIndex);
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

  it("drops probes already in flight when the scan is aborted", async () => {
    // Every request hangs until its signal fires. Without the scan's signal
    // reaching fetch, each probe would instead sit out its full timeout and this
    // test would run past the jest budget rather than finishing.
    mockFetch.mockImplementation(
      (_url: string, init: { signal: AbortSignal }) =>
        new Promise((_resolve, reject) => {
          init.signal.addEventListener("abort", () => {
            const error = new Error("Aborted");
            error.name = "AbortError";
            reject(error);
          });
        }),
    );

    const controller = new AbortController();
    setTimeout(() => controller.abort(), 50);

    await expect(scanLocalNetwork(LOCAL, { signal: controller.signal })).resolves.toEqual([]);
  });
});

describe("scanLocalNetwork with the native port scanner", () => {
  const scanOpenPorts = jest.fn();
  let scan: typeof scanLocalNetwork;

  beforeAll(() => {
    // networkDiscovery reads NativeModules at import time, so the module has to be
    // re-required once the scanner is in place.
    const { NativeModules } = require("react-native");
    NativeModules.NetworkInfo = { scanOpenPorts };
    jest.isolateModules(() => {
      scan = require("../networkDiscovery").scanLocalNetwork;
    });
  });

  afterAll(() => {
    const { NativeModules } = require("react-native");
    delete NativeModules.NetworkInfo;
  });

  beforeEach(() => {
    scanOpenPorts.mockReset();
  });

  /** Report the given address as listening, and nothing else on the subnet. */
  function onlyListening(host: string, port: number) {
    scanOpenPorts.mockImplementation(async (hosts: string[]) => (hosts.includes(host) ? [{ host, port }] : []));
  }

  it("spends an HTTP request only on addresses that accepted a connection", async () => {
    onlyListening("10.48.1.51", 8096);
    serveJellyfinAt({ "http://10.48.1.51:8096": { name: "Home", id: "server-a" } });

    const found = await scan(LOCAL);

    expect(found).toHaveLength(1);
    // The permission warm-up plus one real probe. The other 253 addresses are
    // settled by the TCP sweep and never reach the HTTP stage at all.
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it("finds a server that answers slower than the old single-pass budget allowed", async () => {
    // The regression the two-stage design exists for. 1.6s is past the 1500ms the
    // sweep used to kill every probe at, which silently wrote off any server that
    // was merely cold or busy. Nothing is written off for being slow now: the TCP
    // handshake already proved something is listening here.
    onlyListening("10.48.1.51", 8096);
    mockFetch.mockImplementation(async (url: string) => {
      if (url !== "http://10.48.1.51:8096/System/Info/Public") throw new Error("connection refused");
      await new Promise((resolve) => setTimeout(resolve, 1600));
      return { ok: true, json: async () => ({ ServerName: "Slow", Version: "10.9.0", Id: "server-slow" }) };
    });

    const found = await scan(LOCAL);

    expect(found).toEqual([{ url: "http://10.48.1.51:8096", name: "Slow", id: "server-slow", version: "10.9.0" }]);
  }, 15000);

  it("reports sweep progress across the subnet, then probe progress", async () => {
    onlyListening("10.48.1.51", 8096);
    serveJellyfinAt({ "http://10.48.1.51:8096": { name: "Home", id: "server-a" } });

    const onProgress = jest.fn();
    await scan(LOCAL, { onProgress });

    const phases = onProgress.mock.calls.map(([, , phase]) => phase);
    expect(phases).toContain("sweep");
    expect(phases).toContain("probe");

    const sweepCalls = onProgress.mock.calls.filter(([, , phase]) => phase === "sweep");
    expect(sweepCalls.at(-1)).toEqual([254, 254, "sweep"]);
  });

  it("finds nothing, without probing, when no address is listening", async () => {
    scanOpenPorts.mockResolvedValue([]);
    serveJellyfinAt({});

    await expect(scan(LOCAL)).resolves.toEqual([]);
    // Warm-up only.
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it("prefers HTTPS when one host is listening on several ports", async () => {
    // Both ports have to be resolved together for this host. Probed as two
    // independent tasks they would race, and dedup would keep whichever answered
    // first rather than the preferred scheme.
    scanOpenPorts.mockImplementation(async (hosts: string[]) =>
      hosts.includes("10.48.1.51")
        ? [
            { host: "10.48.1.51", port: 8096 },
            { host: "10.48.1.51", port: 8920 },
          ]
        : [],
    );
    serveJellyfinAt({
      "http://10.48.1.51:8096": { name: "Home", id: "same-server" },
      "https://10.48.1.51:8920": { name: "Home", id: "same-server" },
    });

    const found = await scan(LOCAL);

    expect(found).toHaveLength(1);
    expect(found[0].url).toBe("https://10.48.1.51:8920");
  });

  it("sweeps over HTTP itself when the native scanner fails outright", async () => {
    // A scanner that errored on every chunk has told us nothing. Reporting "no
    // servers" off the back of that would be the same silent miss as a probe
    // killed too early, so the scan falls back to probing every address.
    scanOpenPorts.mockRejectedValue(new Error("scanner unavailable"));
    serveJellyfinAt({ "http://10.48.1.51:8096": { name: "Home", id: "server-a" } });

    const found = await scan(LOCAL);

    expect(found).toEqual([{ url: "http://10.48.1.51:8096", name: "Home", id: "server-a", version: "10.9.0" }]);
  });
});
