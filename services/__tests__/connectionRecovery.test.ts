import { attemptConnectionRecovery, getRecoveryStatus, resetRecoveryStateForTests, subscribeRecoveryStatus } from "../connectionRecovery";
import { adoptRecoveredServerUrl, evaluateSavedConnection, getStoredServerId, isDemoMode, notifyServerRecovered, restoreLastConnection } from "@/services/jellyfinApi";
import { getLocalNetworkInfo, scanLocalNetwork } from "@/services/networkDiscovery";

jest.mock("@/services/jellyfinApi", () => ({
  adoptRecoveredServerUrl: jest.fn().mockResolvedValue(undefined),
  evaluateSavedConnection: jest.fn(),
  getStoredServerId: jest.fn(),
  isDemoMode: jest.fn().mockResolvedValue(false),
  notifyServerRecovered: jest.fn(),
  restoreLastConnection: jest.fn(),
}));

jest.mock("@/services/networkDiscovery", () => ({
  getLocalNetworkInfo: jest.fn(),
  scanLocalNetwork: jest.fn(),
}));

const mockEvaluate = evaluateSavedConnection as jest.Mock;
const mockRestore = restoreLastConnection as jest.Mock;
const mockGetServerId = getStoredServerId as jest.Mock;
const mockLocalInfo = getLocalNetworkInfo as jest.Mock;
const mockScan = scanLocalNetwork as jest.Mock;
const mockAdopt = adoptRecoveredServerUrl as jest.Mock;
const mockDemo = isDemoMode as jest.Mock;
const mockNotify = notifyServerRecovered as jest.Mock;

beforeEach(() => {
  jest.clearAllMocks();
  resetRecoveryStateForTests();
  mockDemo.mockResolvedValue(false);
});

describe("attemptConnectionRecovery", () => {
  it("recovers on a transient blip without restore or scan", async () => {
    mockEvaluate.mockResolvedValue("connected");

    const result = await attemptConnectionRecovery();

    expect(result).toBe("recovered");
    expect(mockNotify).toHaveBeenCalled();
    expect(mockRestore).not.toHaveBeenCalled();
    expect(mockScan).not.toHaveBeenCalled();
  });

  it("recovers via same-host restore when the saved URL is dead", async () => {
    mockEvaluate.mockResolvedValue("needs_restore");
    mockRestore.mockResolvedValue({ url: "https://server:8920", serverName: "Server" });

    const result = await attemptConnectionRecovery();

    expect(result).toBe("recovered");
    expect(mockScan).not.toHaveBeenCalled();
  });

  it("recovers via LAN scan when the same server Id is found at a new address", async () => {
    mockEvaluate.mockResolvedValue("needs_restore");
    mockRestore.mockRejectedValue(new Error("host gone"));
    mockGetServerId.mockResolvedValue("server-id-1");
    mockLocalInfo.mockResolvedValue({ ip: "192.168.50.2", netmask: "255.255.255.0", interfaceName: "en0" });
    mockScan.mockResolvedValue([
      { id: "other-server", url: "http://192.168.50.10:8096", name: "Other", version: "10.10" },
      { id: "server-id-1", url: "http://192.168.50.20:8096", name: "Mine", version: "10.10" },
    ]);

    const result = await attemptConnectionRecovery();

    expect(result).toBe("recovered");
    expect(mockAdopt).toHaveBeenCalledWith("http://192.168.50.20:8096");
  });

  it("resolves not_found when only different servers exist on the network", async () => {
    mockEvaluate.mockResolvedValue("needs_restore");
    mockRestore.mockRejectedValue(new Error("host gone"));
    mockGetServerId.mockResolvedValue("server-id-1");
    mockLocalInfo.mockResolvedValue({ ip: "192.168.50.2", netmask: "255.255.255.0", interfaceName: "en0" });
    mockScan.mockResolvedValue([{ id: "other-server", url: "http://192.168.50.10:8096", name: "Other", version: "10.10" }]);

    const result = await attemptConnectionRecovery();

    expect(result).toBe("not_found");
    expect(mockAdopt).not.toHaveBeenCalled();
  });

  it("skips the scan entirely when no server Id was ever stored", async () => {
    mockEvaluate.mockResolvedValue("needs_restore");
    mockRestore.mockRejectedValue(new Error("host gone"));
    mockGetServerId.mockResolvedValue(null);

    const result = await attemptConnectionRecovery();

    expect(result).toBe("not_found");
    expect(mockScan).not.toHaveBeenCalled();
  });

  it("does nothing in demo mode", async () => {
    mockDemo.mockResolvedValue(true);

    const result = await attemptConnectionRecovery();

    expect(result).toBe("idle");
    expect(mockEvaluate).not.toHaveBeenCalled();
  });

  it("collapses concurrent calls into a single run", async () => {
    let release: (value: string) => void = () => {};
    mockEvaluate.mockReturnValue(new Promise((resolve) => (release = resolve)));

    const first = attemptConnectionRecovery();
    const second = attemptConnectionRecovery();
    release("connected");

    expect(await first).toBe("recovered");
    expect(await second).toBe("recovered");
    expect(mockEvaluate).toHaveBeenCalledTimes(1);
  });

  it("respects the cooldown after a completed run", async () => {
    mockEvaluate.mockResolvedValue("needs_restore");
    mockRestore.mockRejectedValue(new Error("host gone"));
    mockGetServerId.mockResolvedValue(null);

    await attemptConnectionRecovery();
    const second = await attemptConnectionRecovery();

    expect(second).toBe("not_found");
    expect(mockEvaluate).toHaveBeenCalledTimes(1);
  });

  it("notifies status subscribers through the run", async () => {
    mockEvaluate.mockResolvedValue("connected");
    const seen: string[] = [];
    const unsubscribe = subscribeRecoveryStatus((status) => seen.push(status));

    await attemptConnectionRecovery();
    unsubscribe();

    expect(seen).toEqual(["running", "recovered"]);
    expect(getRecoveryStatus()).toBe("recovered");
  });
});
