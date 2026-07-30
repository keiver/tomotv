/**
 * Tests for the scan row's copy, which is a pure function of scan state.
 *
 * Follows the project pattern of testing the logic rather than rendering it.
 */

import { scanRowLabels } from "../NotConnectedSection";
import type { UseNetworkScanReturn } from "@/hooks/useNetworkScan";

const LOCAL = { ip: "10.48.1.20", netmask: "255.255.254.0", interfaceName: "en0" };

function state(overrides: Partial<UseNetworkScanReturn> = {}): UseNetworkScanReturn {
  return {
    status: "IDLE",
    found: [],
    progress: { done: 0, total: 0, phase: "sweep" },
    local: LOCAL,
    start: () => {},
    cancel: () => {},
    ...overrides,
  };
}

const server = (id: string) => ({ url: `http://10.48.1.${id}:8096`, name: "Home", id, version: "10.9.0" });

describe("scanRowLabels", () => {
  it("offers the scan and names the address it will scan from", () => {
    expect(scanRowLabels(state())).toEqual({ name: "Scan Network", subtitle: "Find servers from 10.48.1.20" });
  });

  it("says which phase is running, so the slower second stage doesn't read as a hang", () => {
    expect(scanRowLabels(state({ status: "SCANNING", progress: { done: 96, total: 510, phase: "sweep" } }))).toEqual({
      name: "Stop Scanning",
      subtitle: "96 of 510 addresses",
    });

    expect(scanRowLabels(state({ status: "SCANNING", progress: { done: 2, total: 6, phase: "probe" } }))).toEqual({
      name: "Stop Scanning",
      subtitle: "2 of 6 that answered",
    });
  });

  it("shows a starting state before the first total is known", () => {
    expect(scanRowLabels(state({ status: "SCANNING" })).subtitle).toBe("Starting…");
  });

  describe("after a stop", () => {
    // The regression this file exists for: a cancelled scan used to land in DONE
    // and announce "No servers found on 10.48.0.0/23" for a sweep the user
    // interrupted seconds in.
    it("says nothing about the subnet when nothing was found yet", () => {
      const labels = scanRowLabels(state({ status: "CANCELLED" }));

      expect(labels).toEqual({ name: "Scan Network", subtitle: "Stopped" });
      expect(labels.subtitle).not.toMatch(/no servers|nothing/i);
    });

    it("keeps credit for whatever was already found", () => {
      expect(scanRowLabels(state({ status: "CANCELLED", found: [server("51"), server("77")] }))).toEqual({
        name: "Scan Network",
        subtitle: "Stopped, 2 found",
      });
    });
  });

  describe("after a scan that ran to completion", () => {
    it("names the range swept and the other explanation", () => {
      const labels = scanRowLabels(state({ status: "DONE" }));

      expect(labels.name).toBe("Scan Again");
      // The range is the diagnostic part; a denied Local Network permission is
      // indistinguishable from an empty subnet from in here, so it gets named too.
      expect(labels.subtitle).toBe("Nothing on 10.48.0.0/23, or local network access is off");
    });

    it("falls back to a vague range when this device's address is unknown", () => {
      expect(scanRowLabels(state({ status: "DONE", local: null })).subtitle).toContain("this network");
    });

    it("goes back to the plain offer once something was found", () => {
      expect(scanRowLabels(state({ status: "DONE", found: [server("51")] })).name).toBe("Scan Network");
    });
  });

  it("stays pressable with no network, since that resolves on its own", () => {
    // A TV launched before Wi-Fi associated lands here. Pressing re-reads the
    // address, so the copy must not read as a dead end.
    expect(scanRowLabels(state({ status: "UNSUPPORTED", local: null }))).toEqual({
      name: "Scan Network",
      subtitle: "No network connection yet",
    });
  });
});
