import { isConnectedDestination, scanRowLabels, type ConnectedDestination } from "@/components/settings/NotConnectedSection";
import type { UseNetworkScanReturn } from "@/hooks/useNetworkScan";

const live: ConnectedDestination = { serverId: "srv-1", url: "http://192.168.1.10:8096", demo: false };

describe("isConnectedDestination", () => {
  it("is never connected while signed out", () => {
    expect(isConnectedDestination(null, "srv-1", "http://192.168.1.10:8096")).toBe(false);
  });

  it("matches by Jellyfin Id even when the card's url went stale", () => {
    expect(isConnectedDestination(live, "srv-1", "http://10.0.0.5:8096")).toBe(true);
  });

  it("falls back to the url for a card saved without an Id", () => {
    expect(isConnectedDestination(live, undefined, "http://192.168.1.10:8096")).toBe(true);
    expect(isConnectedDestination(live, undefined, "http://10.0.0.5:8096")).toBe(false);
  });

  it("does not let a different Id match on url alone when both are present and disagree", () => {
    expect(isConnectedDestination(live, "srv-2", "http://192.168.1.10:8096")).toBe(true);
    expect(isConnectedDestination(live, "srv-2", "http://10.0.0.5:8096")).toBe(false);
  });

  it("matches no server row while the demo is the session", () => {
    const demo: ConnectedDestination = { serverId: null, url: "https://demo.jellyfin.org/stable", demo: true };
    expect(isConnectedDestination(demo, undefined, "https://demo.jellyfin.org/stable")).toBe(false);
  });

  it("ignores a null session Id rather than matching an undefined card Id", () => {
    const noId: ConnectedDestination = { serverId: null, url: "http://a", demo: false };
    expect(isConnectedDestination(noId, undefined, "http://b")).toBe(false);
  });
});

function scan(overrides: Partial<UseNetworkScanReturn>): UseNetworkScanReturn {
  return { status: "IDLE", found: [], progress: { done: 0, total: 0, phase: "sweep" }, local: null, start: () => {}, cancel: () => {}, ...overrides };
}
const found = (url: string) => ({ url, name: "s", id: url, version: "1" });

describe("scanRowLabels", () => {
  it("names the network it can scan from, or that there is none yet", () => {
    expect(scanRowLabels(scan({ status: "IDLE", local: { ip: "192.168.1.5", netmask: "255.255.255.0", interfaceName: "en0" } }))).toEqual({
      name: "Scan Network",
      subtitle: "Find servers from 192.168.1.5",
    });
    expect(scanRowLabels(scan({ status: "UNSUPPORTED" }))).toEqual({ name: "Scan Network", subtitle: "No network connection yet" });
  });

  it("reports progress per phase while scanning", () => {
    expect(scanRowLabels(scan({ status: "SCANNING" }))).toEqual({ name: "Stop Scanning", subtitle: "Starting…" });
    expect(scanRowLabels(scan({ status: "SCANNING", progress: { done: 32, total: 254, phase: "sweep" } })).subtitle).toBe("32 of 254 addresses");
    expect(scanRowLabels(scan({ status: "SCANNING", progress: { done: 1, total: 2, phase: "probe" } })).subtitle).toBe("1 of 2 that answered");
  });

  it("says stopped without judging the subnet", () => {
    expect(scanRowLabels(scan({ status: "CANCELLED" })).subtitle).toBe("Stopped");
    expect(scanRowLabels(scan({ status: "CANCELLED", found: [found("http://a")] })).subtitle).toBe("Stopped, 1 found");
  });

  it("counts new finds against the saved list when done", () => {
    const done = scan({ status: "DONE", found: [found("http://a"), found("http://b")] });
    expect(scanRowLabels(done, 0)).toEqual({ name: "Scan Again", subtitle: "2 new servers found" });
    expect(scanRowLabels(done, 1)).toEqual({ name: "Scan Again", subtitle: "1 new server found" });
    expect(scanRowLabels(done, 2)).toEqual({ name: "Scan Again", subtitle: "Found 2 servers, already in your list" });
    expect(scanRowLabels(scan({ status: "DONE", found: [found("http://a")] }), 1).subtitle).toBe("Found 1 server, already in your list");
  });

  it("names the swept range when nothing was found", () => {
    expect(scanRowLabels(scan({ status: "DONE", local: { ip: "192.168.1.5", netmask: "255.255.255.0", interfaceName: "en0" } })).subtitle).toMatch(
      /^Nothing on 192\.168\.1\.0\/24, or local network access is off$/,
    );
    expect(scanRowLabels(scan({ status: "DONE" })).subtitle).toBe("Nothing on this network, or local network access is off");
  });
});
