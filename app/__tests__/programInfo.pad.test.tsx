/**
 * iPad presents the programme panel over the app with no native way out, so the screen owns
 * its dismissal: the dim behind the sheet and the floating close both pop the route, while it
 * loads and once the programme is on screen.
 */
import React from "react";
import TestRenderer, { act } from "react-test-renderer";
import { Platform } from "react-native";
import { fetchProgram, fetchTimers } from "@/services/jellyfinApi";

// Patched before the screen is required: the branch is a module constant, read at import.
Object.defineProperty(Platform, "isPad", { get: () => true, configurable: true });

const ProgramInfoScreen = require("@/app/program-info").default as React.ComponentType;

const mockBack = jest.fn();
jest.mock("expo-router", () => ({
  useLocalSearchParams: () => ({ programId: "p1", channelId: "c1", channelName: "One" }),
  useRouter: () => ({ back: mockBack, push: jest.fn(), replace: jest.fn() }),
}));
jest.mock("expo-blur", () => {
  const { View } = require("react-native");
  return { BlurView: (props: Record<string, unknown>) => <View testID="pad-blur" {...props} /> };
});
jest.mock("@/components/close-overlay-button", () => {
  const { Pressable } = require("react-native");
  return { CloseOverlayButton: ({ onPress }: { onPress: () => void }) => <Pressable testID="pad-close" onPress={onPress} /> };
});
jest.mock("@/utils/logger", () => ({ logger: { error: jest.fn(), info: jest.fn(), debug: jest.fn(), warn: jest.fn() } }));
jest.mock("@/contexts/LoadingContext", () => ({ useLoadingActions: () => ({ showGlobalLoader: jest.fn(), hideGlobalLoader: jest.fn() }) }));
jest.mock("@/components/ambient-background", () => ({ AmbientBackground: () => null }));
jest.mock("@/components/loading-row", () => ({ LoadingRow: () => null }));
jest.mock("@/components/FocusableButton", () => ({ FocusableButton: () => null }));
jest.mock("@expo/vector-icons", () => ({ Ionicons: () => null }));
jest.mock("expo-image", () => ({ Image: () => null }));
jest.mock("react-native-safe-area-context", () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));
jest.mock("@/services/jellyfinApi", () => ({
  fetchProgram: jest.fn(),
  fetchTimers: jest.fn(),
  fetchTimerDefaults: jest.fn(),
  createTimer: jest.fn(),
  createSeriesTimer: jest.fn(),
  cancelTimer: jest.fn(),
  cancelSeriesTimer: jest.fn(),
  fetchLiveTvManagement: jest.fn().mockResolvedValue(false),
  hasPoster: () => false,
  getPosterUrl: () => "",
}));

const now = Date.now();
const later = { Id: "p1", Name: "Football Live", ChannelId: "c1", ChannelName: "One", StartDate: new Date(now + 3_600_000).toISOString(), EndDate: new Date(now + 7_200_000).toISOString() };

async function settle() {
  for (let i = 0; i < 4; i++) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

describe("ProgramInfoScreen on iPad", () => {
  beforeEach(() => jest.clearAllMocks());

  it("dismisses from the dim and the close while loading and once loaded", async () => {
    let release!: (value: unknown) => void;
    (fetchProgram as jest.Mock).mockReturnValue(new Promise((resolve) => (release = resolve)));
    (fetchTimers as jest.Mock).mockResolvedValue([]);
    let tree!: TestRenderer.ReactTestRenderer;
    await act(async () => {
      tree = TestRenderer.create(<ProgramInfoScreen />);
    });

    const dim = () => tree.root.findByProps({ accessibilityRole: "button", accessibilityLabel: "Close the video info panel" });
    expect(tree.root.findAllByProps({ testID: "pad-blur" }).length).toBeGreaterThan(0);
    act(() => dim().props.onPress());
    expect(mockBack).toHaveBeenCalledTimes(1);

    await act(async () => release(later));
    await settle();
    act(() => tree.root.findByProps({ testID: "pad-close" }).props.onPress());
    expect(mockBack).toHaveBeenCalledTimes(2);
  });
});
