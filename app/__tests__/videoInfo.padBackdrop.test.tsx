/**
 * iPad presents the panel over the app, so the backdrop belongs to the screen: it arrives and
 * leaves with the route, and tapping it is a way out. Nothing outside the route may own it,
 * a backdrop held by app state survives the panel and blurs the whole app.
 */
import React from "react";
import TestRenderer, { act } from "react-test-renderer";
import { Platform } from "react-native";
import { fetchItemDetails } from "@/services/jellyfinApi";
import type { JellyfinItem } from "@/types/jellyfin";

// Patched before the screen is required: the branch is a module constant, read at import.
Object.defineProperty(Platform, "isPad", { get: () => true, configurable: true });

const VideoInfoScreen = require("@/app/video-info").default as React.ComponentType;

const item = {
  Id: "item-1",
  Name: "Arrival",
  Type: "Movie",
  MediaStreams: [],
  UserData: { PlaybackPositionTicks: 0, Played: false },
} as unknown as JellyfinItem;

const mockBack = jest.fn();
jest.mock("expo-router", () => ({
  useLocalSearchParams: () => ({ videoId: "item-1" }),
  useRouter: () => ({ back: mockBack, push: jest.fn(), replace: jest.fn() }),
}));

jest.mock("expo-blur", () => {
  const { View } = require("react-native");
  return { BlurView: (props: Record<string, unknown>) => <View testID="pad-blur" {...props} /> };
});

jest.mock("@/utils/logger", () => ({ logger: { error: jest.fn(), info: jest.fn(), debug: jest.fn(), warn: jest.fn() } }));
jest.mock("@/services/localRemux", () => ({
  predictPlaybackLane: jest.fn(async () => null),
  posterFrameIfCached: jest.fn(() => undefined),
  requestPosterFrame: jest.fn(async () => null),
  cancelPosterFrame: jest.fn(),
}));
jest.mock("@/hooks/useFolderPlay", () => ({ useFolderPlay: () => jest.fn() }));
jest.mock("@/hooks/useShowInFolder", () => ({ useShowInFolder: () => jest.fn() }));
jest.mock("@/hooks/useOpenShelfItem", () => ({ useOpenShelfItem: () => jest.fn() }));
jest.mock("@/services/nextUp", () => ({ containerKey: () => null, dismissNextUpContainer: jest.fn() }));
jest.mock("@/contexts/LoadingContext", () => ({ useLoadingActions: () => ({ showGlobalLoader: jest.fn(), hideGlobalLoader: jest.fn() }) }));
jest.mock("@/components/ambient-background", () => ({ AmbientBackground: () => null }));
jest.mock("@/components/close-overlay-button", () => ({ CloseOverlayButton: () => null }));
jest.mock("@/components/info-action-row", () => ({ InfoActionRow: () => null }));
jest.mock("@/components/info-focus-row", () => ({ InfoFocusRow: () => null }));
jest.mock("@/components/FocusableButton", () => ({ FocusableButton: () => null }));
jest.mock("@/components/progress-button", () => ({ ProgressButton: () => null }));
jest.mock("expo-image", () => ({ Image: () => null }));
jest.mock("expo-linear-gradient", () => ({ LinearGradient: () => null }));
jest.mock("@expo/vector-icons", () => ({ Ionicons: () => null }));

jest.mock("@/services/jellyfinApi", () => ({
  subscribeAuthChange: jest.fn(() => () => {}),
  clearResumePosition: jest.fn(async () => {}),
  fetchItemDetails: jest.fn(),
  fetchFolderMediaKinds: jest.fn(async () => null),
  fetchItemFolderPath: jest.fn(async () => []),
  formatDuration: () => "",
  getBackdropUrl: () => null,
  getLogoUrl: () => null,
  getPersonImageUrl: () => null,
  getPosterUrl: () => null,
  hasPoster: () => false,
  isAudioItem: () => false,
  isFolder: () => false,
  isPhoto: () => false,
  notifyResumeChange: jest.fn(),
  setVideoFavorite: jest.fn(async () => {}),
  setVideoPlayed: jest.fn(async () => {}),
}));

const mockFetchItemDetails = fetchItemDetails as jest.Mock;

async function mountPanel() {
  let tree: TestRenderer.ReactTestRenderer;
  await act(async () => {
    tree = TestRenderer.create(<VideoInfoScreen />);
  });
  return tree!;
}

describe("Video info on iPad", () => {
  beforeEach(() => {
    mockBack.mockClear();
    mockFetchItemDetails.mockResolvedValue(item);
  });

  it("draws its own blurred backdrop", async () => {
    const tree = await mountPanel();
    expect(tree.root.findAllByProps({ testID: "pad-blur" }).length).toBeGreaterThan(0);
  });

  it("closes on a tap outside the card", async () => {
    const tree = await mountPanel();
    const backdrop = tree.root.findAllByProps({ accessibilityLabel: "Close the video info panel" }).find((node) => typeof node.props.onPress === "function");
    await act(async () => {
      backdrop!.props.onPress();
    });
    expect(mockBack).toHaveBeenCalled();
  });

  it("takes the backdrop with it when the route leaves", async () => {
    const tree = await mountPanel();
    await act(async () => {
      tree.unmount();
    });
    expect(tree.toJSON()).toBeNull();
  });
});
