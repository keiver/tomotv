/** On TV the Live TV screen hands focus to the Channels cell: on open, on Down from the tab bar, and on each Home card press. */
import React from "react";
import TestRenderer, { act } from "react-test-renderer";
import { Platform } from "react-native";

const mockParams: { opened?: string } = {};
const mockGuide = { rows: [], isLoading: false, isUpdating: false, error: null, nowMs: 0 };
jest.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ isConnected: true, isReady: true }) }));
jest.mock("@/contexts/LoadingContext", () => ({ useLoadingActions: () => ({ showGlobalLoader: jest.fn() }) }));
jest.mock("@/components/settings/ServerConnectScreen", () => ({ ServerConnectScreen: () => null }));
jest.mock("@/hooks/useGuide", () => ({ useGuide: () => mockGuide, invalidateGuideReads: jest.fn() }));
jest.mock("@/hooks/useAuthSession", () => ({ useAuthSession: () => "session" }));
jest.mock("@/hooks/useChannelFavoritesSync", () => ({ useChannelFavoritesSync: jest.fn() }));
jest.mock("@/hooks/useLiveTvPreferences", () => ({ useLiveTvPreferences: () => ({ filter: "all" }) }));
jest.mock("@/hooks/useRecordingStatus", () => ({ useIsRecording: () => false }));
jest.mock("@/components/live-tv/guide-canvas", () => ({ GuideCanvas: () => null }));
jest.mock("@/components/live-tv/guide-hud", () => ({ GuideHud: () => null }));
jest.mock("@/components/live-tv/guide-corner-actions", () => ({ GuideCornerActions: () => null, HudAction: () => null, HUD_ACTION_ICON: 20, scheduleSymbol: () => "calendar" }));
jest.mock("@/components/sf-symbol-icon", () => ({ SfSymbolIcon: () => null }));
jest.mock("@/components/ambient-background", () => ({ AmbientBackground: () => null }));
jest.mock("@/services/i18n", () => ({ t: (key: string) => key }));
jest.mock("@/services/externalGuide", () => ({ refreshExternalGuide: jest.fn() }));
jest.mock("@/services/jellyfinApi", () => ({ invalidateLiveTvSearchIndex: jest.fn(), warmLiveTvSearch: jest.fn() }));
jest.mock("@/services/toast", () => ({ showToast: jest.fn(), dismissToast: jest.fn() }));
jest.mock("expo-router", () => ({ Stack: { Screen: () => null }, useIsFocused: () => true, useLocalSearchParams: () => mockParams, useRouter: () => ({ push: jest.fn() }) }));
jest.mock("expo-router/react-navigation", () => ({ useHeaderHeight: () => 0 }));
jest.mock("react-native/Libraries/ReactNative/RendererProxy", () => ({ ...jest.requireActual("react-native/Libraries/ReactNative/RendererProxy"), findNodeHandle: () => 42 }));
jest.mock("react-native/Libraries/Components/TV/TVFocusGuideView", () => {
  const { View } = jest.requireActual("react-native");
  return { __esModule: true, default: (props: object) => require("react").createElement(View, props) };
});
jest.mock("react-native-safe-area-context", () => {
  const { View } = jest.requireActual("react-native");
  return { SafeAreaListener: View, useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }) };
});

Object.defineProperty(Platform, "isTV", { value: true, configurable: true });
// Read after the flag: the screen fixes its platform at import.
const LiveTvRoute = (require("@/app/live-tv") as typeof import("@/app/live-tv")).default;
const { GuideCanvas } = jest.requireMock("@/components/live-tv/guide-canvas") as { GuideCanvas: React.ComponentType };
const TVFocusGuideView = jest.requireMock("react-native/Libraries/Components/TV/TVFocusGuideView").default;

const channelsNode = { requestTVFocus: jest.fn() };

async function renderScreen() {
  let tree!: TestRenderer.ReactTestRenderer;
  await act(async () => {
    tree = TestRenderer.create(<LiveTvRoute />);
  });
  // TV lays the body out only after the screen measures its own insets.
  const listener = tree.root.find((node) => typeof node.props.onChange === "function" && node.props.style !== undefined);
  await act(async () => listener.props.onChange({ insets: { top: 0, right: 0, bottom: 0, left: 0 } }));
  const corner = () => tree.root.findByType(GuideCanvas).props.hudRow.props.cornerActions.props;
  await act(async () => corner().onFirstRef(channelsNode));
  const body = () => tree.root.find((node) => node.type === TVFocusGuideView && typeof node.props.onFocusEnter === "function");
  const tabBarGuide = () => tree.root.findAll((node) => node.type === TVFocusGuideView && node.props.destinations !== undefined);
  return { tree, corner, body, tabBarGuide };
}

describe("Live TV focus on TV", () => {
  beforeEach(() => {
    delete mockParams.opened;
    channelsNode.requestTVFocus.mockClear();
  });

  it("the Channels cell claims focus on open, and the claim stops once focus is inside the screen", async () => {
    const { corner, body } = await renderScreen();
    expect(corner().claimFocus).toBe(true);
    await act(async () => body().props.onFocusEnter());
    expect(corner().claimFocus).toBe(false);
    await act(async () => body().props.onFocusLeave());
    expect(corner().claimFocus).toBe(false);
  });

  it("the guide over the top edge points at Channels only while focus is outside the screen", async () => {
    const { body, tabBarGuide } = await renderScreen();
    expect(tabBarGuide()).toHaveLength(1);
    expect(tabBarGuide()[0].props.destinations).toEqual([42]);
    await act(async () => body().props.onFocusEnter());
    expect(tabBarGuide()).toHaveLength(0);
    await act(async () => body().props.onFocusLeave());
    expect(tabBarGuide()).toHaveLength(1);
  });

  it("each Home card press moves focus to the Channels cell", async () => {
    const { tree } = await renderScreen();
    expect(channelsNode.requestTVFocus).not.toHaveBeenCalled();
    mockParams.opened = "1";
    await act(async () => tree.update(<LiveTvRoute />));
    expect(channelsNode.requestTVFocus).toHaveBeenCalledTimes(1);
    mockParams.opened = "2";
    await act(async () => tree.update(<LiveTvRoute />));
    expect(channelsNode.requestTVFocus).toHaveBeenCalledTimes(2);
  });
});
