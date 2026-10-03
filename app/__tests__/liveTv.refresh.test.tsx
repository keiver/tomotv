/** The refresh press remounts the Live TV screen and its first load tells the viewer how it ended. */
import LiveTvRoute from "@/app/live-tv";
import React from "react";
import TestRenderer, { act } from "react-test-renderer";

let mockCanvasMounts = 0;
const mockGuide = { rows: [] as { programs: unknown[] }[], isLoading: false, isUpdating: false, error: null as string | null, nowMs: 0 };
jest.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ isConnected: true, isReady: true }) }));
jest.mock("@/contexts/LoadingContext", () => ({ useLoadingActions: () => ({ showGlobalLoader: jest.fn() }) }));
jest.mock("@/components/settings/ServerConnectScreen", () => ({ ServerConnectScreen: () => null }));
jest.mock("@/hooks/useGuide", () => ({ useGuide: () => mockGuide }));
jest.mock("@/hooks/useAuthSession", () => ({ useAuthSession: () => "session" }));
jest.mock("@/hooks/useChannelFavoritesSync", () => ({ useChannelFavoritesSync: jest.fn() }));
jest.mock("@/hooks/useLiveTvPreferences", () => ({ useLiveTvPreferences: () => ({ filter: "all" }) }));
jest.mock("@/components/live-tv/guide-canvas", () => {
  const { useEffect } = jest.requireActual("react");
  return {
    GuideCanvas: () => {
      useEffect(() => {
        mockCanvasMounts += 1;
      }, []);
      return null;
    },
  };
});
jest.mock("@/components/live-tv/guide-hud", () => ({ GuideHud: () => null }));
jest.mock("@/components/live-tv/guide-corner-actions", () => ({ GuideCornerActions: () => null, HudAction: () => null, HUD_ACTION_ICON: 20 }));
jest.mock("@/components/sf-symbol-icon", () => ({ SfSymbolIcon: () => null }));
jest.mock("@/components/ambient-background", () => ({ AmbientBackground: () => null }));
jest.mock("@/services/i18n", () => ({ t: (key: string) => key }));
jest.mock("@/services/externalGuide", () => ({ refreshExternalGuide: jest.fn() }));
jest.mock("@/services/toast", () => ({ showToast: jest.fn() }));
jest.mock("expo-router", () => ({ Stack: { Screen: () => null }, useLocalSearchParams: () => ({}), useRouter: () => ({ push: jest.fn() }) }));
jest.mock("expo-router/react-navigation", () => ({ useHeaderHeight: () => 0 }));
jest.mock("react-native-safe-area-context", () => {
  const { View } = jest.requireActual("react-native");
  return { SafeAreaListener: View, useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }) };
});

const { GuideCanvas } = jest.requireMock("@/components/live-tv/guide-canvas") as { GuideCanvas: React.ComponentType };
const { refreshExternalGuide } = jest.requireMock("@/services/externalGuide") as { refreshExternalGuide: jest.Mock };
const { showToast } = jest.requireMock("@/services/toast") as { showToast: jest.Mock };

async function refreshThenLand(landed: Partial<typeof mockGuide>) {
  Object.assign(mockGuide, { rows: [], isLoading: false, error: null });
  let renderer!: TestRenderer.ReactTestRenderer;
  await act(async () => {
    renderer = TestRenderer.create(<LiveTvRoute />);
  });
  const press = renderer.root.findByType(GuideCanvas).props.hudRow.props.cornerActions.props.onPress as () => void;
  mockGuide.isLoading = true;
  await act(async () => press());
  const whilePending = showToast.mock.calls.length;
  Object.assign(mockGuide, { isLoading: false }, landed);
  await act(async () => renderer.update(<LiveTvRoute />));
  return { whilePending };
}

describe("Live TV refresh", () => {
  beforeEach(() => {
    mockCanvasMounts = 0;
    jest.clearAllMocks();
  });

  it("remounts the screen, re-downloads the guides and announces the update", async () => {
    const { whilePending } = await refreshThenLand({ rows: [{ programs: [{}] }] });
    expect(mockCanvasMounts).toBe(2);
    expect(refreshExternalGuide).toHaveBeenCalledTimes(1);
    expect(whilePending).toBe(1);
    expect(showToast.mock.calls).toEqual([[{ id: "guide-refresh", title: "liveTv.guideDownloading", progress: true }], [{ id: "guide-refresh", title: "liveTv.guideUpdated", kind: "success" }]]);
  });

  it("says so when the refresh brought no listings", async () => {
    await refreshThenLand({ rows: [{ programs: [] }] });
    expect(showToast).toHaveBeenLastCalledWith({ id: "guide-refresh", title: "liveTv.noGuide", kind: "info" });
  });

  it("says the guide is unavailable when the load failed", async () => {
    await refreshThenLand({ error: "offline" });
    expect(showToast).toHaveBeenLastCalledWith({ id: "guide-refresh", title: "liveTv.guideUnavailable", kind: "error" });
  });

  it("stays silent on the first open", async () => {
    Object.assign(mockGuide, { rows: [{ programs: [{}] }], isLoading: false, error: null });
    await act(async () => {
      TestRenderer.create(<LiveTvRoute />);
    });
    expect(showToast).not.toHaveBeenCalled();
  });
});
