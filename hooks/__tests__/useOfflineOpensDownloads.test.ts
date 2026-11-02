import { offlineResponse, useOfflineOpensDownloads } from "@/hooks/useOfflineOpensDownloads";
import { showToast } from "@/services/toast";
import React from "react";
import TestRenderer, { act } from "react-test-renderer";

let mockEmit: ((available: boolean) => void) | null = null;
let mockLast: boolean | null = null;
jest.mock("@/services/localNetworkIdentity", () => ({
  // Mirrors the native monitor: a new subscription is handed the current path at once.
  subscribeNetworkPath: (listener: (available: boolean) => void) => {
    mockEmit = listener;
    if (mockLast !== null) {
      const value = mockLast;
      void Promise.resolve().then(() => listener(value));
    }
    return () => {
      mockEmit = null;
    };
  },
}));
jest.mock("@/services/toast", () => ({ showToast: jest.fn() }));
jest.mock("@/services/i18n", () => ({ t: (key: string) => key }));
jest.mock("@/services/downloads/paths", () => ({ downloadsSupported: () => true }));
let mockEntries: { state: string }[] = [];
const mockHydrate = jest.fn(() => Promise.resolve());
jest.mock("@/services/downloads/manager", () => ({
  downloadManager: { hydrate: () => mockHydrate(), getState: () => ({ entries: mockEntries }) },
}));
const mockNavigate = jest.fn();
let mockTop = "(tabs)";
jest.mock("expo-router", () => ({
  useRouter: () => ({ navigate: mockNavigate }),
  useNavigation: () => ({ getState: () => ({ index: 0, routes: [{ name: mockTop }] }) }),
}));

const OFFLINE = { wasOffline: false, available: false, hasReady: true, onTabs: true };

describe("offlineResponse", () => {
  it("says so and opens Downloads when the connection is gone and a finished download can play", () => {
    expect(offlineResponse(OFFLINE)).toEqual({ notify: true, openDownloads: true });
  });

  it("says so but stays put with nothing finished to play", () => {
    expect(offlineResponse({ ...OFFLINE, hasReady: false })).toEqual({ notify: true, openDownloads: false });
  });

  it("does nothing online, on a second offline report, or over a player or item screen", () => {
    const nothing = { notify: false, openDownloads: false };
    expect(offlineResponse({ ...OFFLINE, available: true })).toEqual(nothing);
    expect(offlineResponse({ ...OFFLINE, wasOffline: true })).toEqual(nothing);
    expect(offlineResponse({ ...OFFLINE, onTabs: false })).toEqual(nothing);
  });
});

function Harness() {
  useOfflineOpensDownloads();
  return null;
}

async function emit(available: boolean) {
  await act(async () => {
    mockLast = available;
    mockEmit?.(available);
    await Promise.resolve();
  });
}

describe("useOfflineOpensDownloads", () => {
  beforeEach(() => {
    mockEntries = [{ state: "ready" }];
    mockTop = "(tabs)";
    mockLast = null;
    mockHydrate.mockReset();
    mockHydrate.mockResolvedValue(undefined);
    mockNavigate.mockClear();
    (showToast as jest.Mock).mockClear();
  });

  it("answers each drop of the connection while the app runs, once per drop", async () => {
    let tree!: TestRenderer.ReactTestRenderer;
    act(() => {
      tree = TestRenderer.create(React.createElement(Harness));
    });
    await emit(true);
    expect(mockNavigate).not.toHaveBeenCalled();
    await emit(false);
    expect(showToast).toHaveBeenCalledWith("downloads.offline");
    expect(mockNavigate).toHaveBeenCalledWith("/downloads");
    await emit(false);
    expect(mockNavigate).toHaveBeenCalledTimes(1);
    await emit(true);
    await emit(false);
    expect(mockNavigate).toHaveBeenCalledTimes(2);
    act(() => tree.unmount());
    expect(mockEmit).toBeNull();
  });

  it("does not toast again when the effect re-subscribes while offline", async () => {
    let tree!: TestRenderer.ReactTestRenderer;
    act(() => {
      tree = TestRenderer.create(React.createElement(Harness));
    });
    await emit(false);
    expect(showToast).toHaveBeenCalledTimes(1);
    // A re-render gives the effect new router/navigation identities, so it re-subscribes; the monitor
    // re-emits the current (offline) path to the new listener.
    await act(async () => {
      tree.update(React.createElement(Harness));
      await Promise.resolve();
    });
    expect(showToast).toHaveBeenCalledTimes(1);
    act(() => tree.unmount());
  });

  it("keeps the offline flag matching the last event when hydrate resolves out of order", async () => {
    let tree!: TestRenderer.ReactTestRenderer;
    act(() => {
      tree = TestRenderer.create(React.createElement(Harness));
    });
    let releaseOffline!: () => void;
    mockHydrate.mockImplementationOnce(() => new Promise<void>((resolve) => (releaseOffline = resolve)));
    await act(async () => {
      mockLast = false;
      mockEmit?.(false);
      await Promise.resolve();
    });
    await emit(true);
    (showToast as jest.Mock).mockClear();
    await act(async () => {
      releaseOffline();
      await Promise.resolve();
    });
    (showToast as jest.Mock).mockClear();
    await emit(false);
    expect(showToast).toHaveBeenCalledTimes(1);
    act(() => tree.unmount());
  });

  it("leaves a player pushed over the tabs alone", async () => {
    mockTop = "player";
    let tree!: TestRenderer.ReactTestRenderer;
    act(() => {
      tree = TestRenderer.create(React.createElement(Harness));
    });
    await emit(false);
    expect(showToast).not.toHaveBeenCalled();
    expect(mockNavigate).not.toHaveBeenCalled();
    act(() => tree.unmount());
  });
});
