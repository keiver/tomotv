/**
 * On iPhone the info panel is a card on the bottom edge, centred in the safe area: on iPhone Duo the window's
 * right inset (the side bar column) stays beside the card, and the close button sits in the card's own corner.
 */
import VideoInfoScreen from "@/app/video-info";
import { CardDragView } from "@/components/card-drag";
import { PadSheetFrame } from "@/components/pad-sheet";
import { useLocalSearchParams } from "expo-router";
import React from "react";
import { StyleSheet } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import TestRenderer, { act } from "react-test-renderer";

// The real provider, so the window can report its side column.
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
jest.mock("expo-blur", () => ({ BlurView: () => null }));
jest.mock("@/utils/logger", () => ({ logger: { error: jest.fn(), info: jest.fn(), debug: jest.fn(), warn: jest.fn() } }));
jest.mock("@/components/close-overlay-button", () => ({ CloseOverlayButton: () => null }));
// A panel that paints as it mounts, unless a test holds it loading.
let mockPaints = true;
jest.mock("@/components/video-info-panel", () => ({
  VideoInfoPanel: ({ videoId, onReady }: { videoId: string; onReady?: (item: { Id: string }) => void }) => {
    const React = require("react");
    const [item] = React.useState(() => ({ Id: videoId }));
    React.useEffect(() => {
      if (mockPaints) onReady?.(item);
    }, [item, onReady]);
    return null;
  },
}));
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

it("sets the card on the bottom edge beside the window's side column, with the close button in the card's corner", async () => {
  (useLocalSearchParams as jest.Mock).mockReturnValue({ videoId: "m1" });
  let tree!: TestRenderer.ReactTestRenderer;
  await act(async () => {
    tree = TestRenderer.create(
      <SafeAreaProvider initialMetrics={window}>
        <VideoInfoScreen />
      </SafeAreaProvider>,
    );
  });
  const frame = tree.root.findByType(PadSheetFrame);
  expect(frame.props.fit).toBe("bottom");
  expect(StyleSheet.flatten(frame.parent!.props.style)).toEqual(expect.objectContaining({ justifyContent: "flex-end", paddingLeft: 0, paddingRight: 86 }));
  const { CloseOverlayButton } = require("@/components/close-overlay-button");
  expect(StyleSheet.flatten(tree.root.findByType(CloseOverlayButton).props.style).right).toBe(12);
  act(() => tree.unmount());
});

it("draws no card or close button around a panel still loading, so the card appears once at the size it keeps", async () => {
  mockPaints = false;
  (useLocalSearchParams as jest.Mock).mockReturnValue({ videoId: "m1" });
  let tree!: TestRenderer.ReactTestRenderer;
  await act(async () => {
    tree = TestRenderer.create(
      <SafeAreaProvider initialMetrics={window}>
        <VideoInfoScreen />
      </SafeAreaProvider>,
    );
  });
  const frame = tree.root.findByType(PadSheetFrame);
  expect(frame.props.bare).toBe(true);
  expect(tree.root.findAllByType(require("@/components/close-overlay-button").CloseOverlayButton)).toHaveLength(0);
  act(() => tree.unmount());
  mockPaints = true;
});

it("lets the card be dragged down to close it", async () => {
  (useLocalSearchParams as jest.Mock).mockReturnValue({ videoId: "m1" });
  let tree!: TestRenderer.ReactTestRenderer;
  await act(async () => {
    tree = TestRenderer.create(
      <SafeAreaProvider initialMetrics={window}>
        <VideoInfoScreen />
      </SafeAreaProvider>,
    );
  });
  expect(tree.root.findByType(CardDragView).findAllByType(PadSheetFrame)).toHaveLength(1);
  act(() => tree.unmount());
});
