/**
 * Tests for the native two-phase scan path (TCP sweep, then HTTP probes), which
 * the main networkDiscovery suite never reaches because it runs without the
 * NetworkInfo native module. The regression this file exists for: priority
 * hosts were only reordered within the sweep, but rows come from the probe
 * phase, which starts after the WHOLE subnet is swept — so the saved server
 * still appeared last. Priority hosts must be probed over HTTP immediately,
 * in parallel with the sweep.
 *
 * react-native is mocked to just what networkDiscovery imports; spreading the
 * real barrel evaluates its lazy getters and trips TurboModule lookups.
 */

import { scanLocalNetwork } from "../networkDiscovery";
import type { LocalNetworkInfo } from "../networkDiscovery";

const mockScanOpenPorts = jest.fn();
const mockCheckServerInfo = jest.fn();

jest.mock("react-native", () => ({
  NativeModules: { NetworkInfo: { scanOpenPorts: (...args: unknown[]) => mockScanOpenPorts(...args) } },
  Platform: { OS: "ios", isTV: false },
}));
jest.mock("@/services/jellyfinApi", () => ({ checkServerInfo: (...args: unknown[]) => mockCheckServerInfo(...args) }));
jest.mock("@/services/localNetworkPermission", () => ({
  isLocalNetworkPrimed: () => true,
  markLocalNetworkPrimedFor: jest.fn(),
  LOCAL_NETWORK_GRACE_MS: 0,
  LOCAL_NETWORK_POLL_MS: 0,
}));
jest.mock("@/utils/logger", () => ({ logger: { error: jest.fn(), info: jest.fn(), debug: jest.fn(), warn: jest.fn() } }));

const LOCAL: LocalNetworkInfo = { ip: "10.48.1.20", netmask: "255.255.255.0", interfaceName: "en0" };

/** Answer as Jellyfin for the listed base URLs, refuse everything else. */
function serveJellyfinAt(servers: Record<string, { name: string; id: string }>) {
  mockCheckServerInfo.mockImplementation(async (url: string) => {
    const server = servers[url];
    if (!server) throw new Error("connection refused");
    return { ServerName: server.name, Version: "10.9.0", Id: server.id };
  });
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe("scanLocalNetwork on the native sweep path", () => {
  it("streams a priority host's server while the TCP sweep is still running", async () => {
    serveJellyfinAt({ "http://10.48.1.51:8096": { name: "Home", id: "server-a" } });

    // A slow sweep that never finds an open port: any result can only have come
    // from the direct priority probe, and it must arrive before the sweep ends.
    let chunksDone = 0;
    mockScanOpenPorts.mockImplementation(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
      chunksDone++;
      return [];
    });

    let chunksDoneAtFound = -1;
    const found = await scanLocalNetwork(LOCAL, {
      priorityHosts: ["10.48.1.51"],
      onFound: () => {
        chunksDoneAtFound = chunksDone;
      },
    });

    expect(found).toEqual([{ url: "http://10.48.1.51:8096", name: "Home", id: "server-a", version: "10.9.0" }]);
    // 254 hosts in chunks of 32 = 8 chunks; the row must not wait for them.
    expect(chunksDone).toBe(8);
    expect(chunksDoneAtFound).toBeLessThan(8);
  });

  it("dedups the priority probe against the sweep finding the same server", async () => {
    serveJellyfinAt({ "http://10.48.1.51:8096": { name: "Home", id: "server-a" } });
    mockScanOpenPorts.mockImplementation(async (hosts: string[]) => hosts.filter((host) => host === "10.48.1.51").map((host) => ({ host, port: 8096 })));

    const onFound = jest.fn();
    const found = await scanLocalNetwork(LOCAL, { priorityHosts: ["10.48.1.51"], onFound });

    expect(found).toHaveLength(1);
    expect(onFound).toHaveBeenCalledTimes(1);
  });
});
