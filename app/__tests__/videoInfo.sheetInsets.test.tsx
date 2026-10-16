/**
 * The info panel reads its own safe area, not the window's: on iPhone Duo's open screen the modal is a
 * centred card, and the window's right inset (the side bar column) is not on the card.
 */
import VideoInfoScreen from "@/app/video-info";
import { useLocalSearchParams } from "expo-router";
import React from "react";
import { SafeAreaProvider } from "react-native-safe-area-context";
import TestRenderer, { act } from "react-test-renderer";

// The real provider, so the card can report insets of its own.
jest.mock("react-native-safe-area-context", () => jest.requireActual("react-native-safe-area-context"));
jest.mock("expo-router", () => ({
  useLocalSearchParams: jest.fn(),
  useRouter: () => ({ back: jest.fn(), push: jest.fn(), replace: jest.fn() }),
}));
jest.mock("react-native-gesture-handler", () => {
  const { View } = require("react-native");
  const chain: any = new Proxy(() => chain, { get: () => () => chain, apply: () => chain });
  return { Gesture: { Pan: () => chain, Native: () => chain }, GestureDetector: ({ children }: { children: React.ReactNode }) => children, GestureHandlerRootView: View };
});
jest.mock("@/utils/logger", () => ({ logger: { error: jest.fn(), info: jest.fn(), debug: jest.fn(), warn: jest.fn() } }));
jest.mock("@/components/close-overlay-button", () => ({ CloseOverlayButton: () => null }));
jest.mock("@/components/video-info-panel", () => ({ VideoInfoPanel: () => null }));
jest.mock("@/services/jellyfinApi", () => ({
  fetchRecursiveVideos: jest.fn(async () => []),
  fetchFolderContents: jest.fn(async () => ({ items: [], total: 0 })),
  fetchUserViews: jest.fn(async () => ({ items: [], total: 0 })),
  fetchChannelRing: jest.fn(async () => []),
  isAudioItem: () => false,
  isFolder: () => false,
  isPhoto: () => false,
  isBook: () => false,
  isLiveChannel: () => false,
}));
jest.mock("@/services/playedCache", () => ({ getPlayedOverrides: () => new Map() }));
jest.mock("@/services/liveTvPreferences", () => ({ getLiveTvPreferences: () => ({ filter: "all", sort: "number", favorites: [], groups: [] }) }));

const window = { frame: { x: 0, y: 0, width: 951, height: 669 }, insets: { top: 0, left: 0, bottom: 20, right: 86 } };

it("places the close button by the card's own right inset, not the window's side column", async () => {
  (useLocalSearchParams as jest.Mock).mockReturnValue({ videoId: "m1" });
  let tree!: TestRenderer.ReactTestRenderer;
  await act(async () => {
    tree = TestRenderer.create(
      <SafeAreaProvider initialMetrics={window}>
        <VideoInfoScreen />
      </SafeAreaProvider>,
    );
  });
  const { CloseOverlayButton } = require("@/components/close-overlay-button");
  const right = () => tree.root.findByType(CloseOverlayButton).props.style.right;
  // Until the card measures itself it starts from the window's insets.
  expect(right()).toBe(12 + 86);

  const providers = tree.root.findAll((node) => typeof node.props.onInsetsChange === "function" && typeof node.type === "string");
  const card = providers[providers.length - 1];
  await act(async () => {
    card.props.onInsetsChange({ nativeEvent: { frame: { x: 0, y: 0, width: 620, height: 640 }, insets: { top: 0, left: 0, bottom: 20, right: 0 } } });
  });
  expect(right()).toBe(12);
  act(() => tree.unmount());
});
