/** A folder's loading, error and empty block centres in the safe area, so iPhone Duo's side column never pushes it off centre. */
import { LibraryGrid } from "@/components/library-grid";
import React from "react";
import { StyleSheet, View } from "react-native";
import TestRenderer, { act } from "react-test-renderer";

jest.mock("react-native-safe-area-context", () => ({ useSafeAreaInsets: () => ({ top: 0, left: 0, right: 86, bottom: 20 }) }));
jest.mock("expo-router", () => ({ useRouter: () => ({ push: jest.fn(), dismissTo: jest.fn() }), useIsFocused: () => true }));
jest.mock("@/hooks/useCardPalette", () => ({ useCardPalette: () => ({ accent: "#FFC312", onAccent: "#000" }), themedStyles: () => () => ({}) }));
jest.mock("@/hooks/useLiveFrameViewport", () => ({ useLiveFrameViewport: () => ({ viewabilityConfig: {}, onViewableItemsChanged: jest.fn(), visibleChannelIds: new Set() }) }));
jest.mock("@/services/liveFrames", () => ({ clearLiveFrameFocus: jest.fn(), setLiveFrameFocus: jest.fn() }));
jest.mock("@/services/connectionRecovery", () => ({ getRecoveryStatus: () => "idle", subscribeRecoveryStatus: () => () => {} }));
jest.mock("@/services/jellyfinApi", () => ({ isFolder: () => false, signOut: jest.fn() }));
jest.mock("@/services/i18n", () => ({ t: (key: string) => key }));
jest.mock("@/utils/logger", () => ({ logger: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() } }));
jest.mock("@/components/ambient-background", () => ({ AmbientBackground: () => null }));
jest.mock("@/components/folder-backdrop", () => ({ FolderBackdrop: () => null }));
jest.mock("@/components/FocusableButton", () => ({ FocusableButton: () => null }));
jest.mock("@/components/folder-grid-item", () => ({ FolderGridItem: () => null }));
jest.mock("@/components/loading-row", () => ({ LoadingRow: () => null }));
jest.mock("@/components/folder-loading-bar", () => ({ FolderLoadingBar: () => null }));
jest.mock("@/components/library-header", () => ({ LibraryHeader: () => null }));
jest.mock("@/components/live-tv/guide-channel-card", () => ({ GuideChannelCard: () => null }));
jest.mock("@/components/video-grid-item", () => ({ VideoGridItem: () => null }));
jest.mock("@expo/vector-icons", () => ({ Ionicons: () => null }));

it.each([
  ["loading", { isLoading: true, error: null }],
  ["error", { isLoading: false, error: "offline" }],
  ["empty", { isLoading: false, error: null }],
])("centres the %s block in the safe area, keeping its own 40pt", async (_state, props) => {
  let tree!: TestRenderer.ReactTestRenderer;
  await act(async () => {
    tree = TestRenderer.create(<LibraryGrid items={[]} isLoadingMore={false} hasMoreResults={false} onItemPress={jest.fn()} onLoadMore={jest.fn()} {...props} />);
  });
  const centred = tree.root
    .findAllByType(View)
    .map((node) => StyleSheet.flatten(node.props.style))
    .find((style) => style?.justifyContent === "center" && style?.alignItems === "center");
  expect(centred).toMatchObject({ padding: 40, paddingLeft: 40, paddingRight: 126 });
  act(() => tree.unmount());
});
