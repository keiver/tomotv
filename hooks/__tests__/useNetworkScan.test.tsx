/**
 * Tests for the useNetworkScan hook's scan wiring: saved servers are handed to
 * scanLocalNetwork as priority hosts (most recently connected first) so the
 * server the user already knows is swept before the rest of the subnet.
 * Rendered with react-test-renderer through the project's null-rendering
 * harness pattern.
 */
import { useNetworkScan } from "@/hooks/useNetworkScan";
import { getSavedServers } from "@/services/jellyfinApi";
import { getLocalNetworkInfo, scanLocalNetwork } from "@/services/networkDiscovery";
import React, { forwardRef, useImperativeHandle } from "react";
import TestRenderer, { act } from "react-test-renderer";

jest.mock("@/services/networkDiscovery", () => {
  const actual = jest.requireActual("@/services/networkDiscovery");
  return { ...actual, getLocalNetworkInfo: jest.fn(), scanLocalNetwork: jest.fn() };
});
jest.mock("@/services/jellyfinApi", () => ({ getSavedServers: jest.fn() }));
jest.mock("@/utils/logger", () => ({ logger: { error: jest.fn(), info: jest.fn(), debug: jest.fn(), warn: jest.fn() } }));

const mockLocalInfo = getLocalNetworkInfo as jest.Mock;
const mockScan = scanLocalNetwork as jest.Mock;
const mockSavedServers = getSavedServers as jest.Mock;

const LOCAL = { ip: "10.48.1.20", netmask: "255.255.255.0", interfaceName: "en0" };

type Hook = ReturnType<typeof useNetworkScan>;
type HookRef = { get: () => Hook };

const Harness = forwardRef<HookRef>((_, ref) => {
  const result = useNetworkScan();
  useImperativeHandle(ref, () => ({ get: () => result }), [result]);
  return null;
});
Harness.displayName = "Harness";

const flush = () => act(async () => {});

beforeEach(() => {
  jest.clearAllMocks();
  mockLocalInfo.mockResolvedValue(LOCAL);
  mockScan.mockResolvedValue([]);
});

describe("useNetworkScan priority hosts", () => {
  it("passes saved server hosts to the scan, most recently connected first", async () => {
    mockSavedServers.mockResolvedValue([
      { id: "http://10.48.1.51:8096", name: "Home", url: "http://10.48.1.51:8096", lastConnectedAt: 2 },
      { id: "https://media.example.com", name: "Remote", url: "https://media.example.com", lastConnectedAt: 1 },
    ]);

    const ref = React.createRef<HookRef>();
    await act(async () => {
      TestRenderer.create(<Harness ref={ref} />);
    });
    act(() => ref.current!.get().start());
    await flush();

    expect(mockScan).toHaveBeenCalledWith(LOCAL, expect.objectContaining({ priorityHosts: ["10.48.1.51", "media.example.com"] }));
  });

  it("scans with no priority hosts when the saved list is unreadable", async () => {
    mockSavedServers.mockRejectedValue(new Error("keychain unavailable"));

    const ref = React.createRef<HookRef>();
    await act(async () => {
      TestRenderer.create(<Harness ref={ref} />);
    });
    act(() => ref.current!.get().start());
    await flush();

    expect(mockScan).toHaveBeenCalledWith(LOCAL, expect.objectContaining({ priorityHosts: [] }));
  });
});
