/** On TV a band host's bar claims focus only for the first load's empty result: a reload starts in the band, which stays mounted. */
import type { JellyfinItem } from "@/types/jellyfin";
import React, { useEffect } from "react";
import { Platform, Text } from "react-native";
import TestRenderer, { act } from "react-test-renderer";

let mockClaims: boolean[] = [];

jest.mock("react-native-safe-area-context", () => ({ useSafeAreaInsets: () => ({ top: 0, left: 0, right: 0, bottom: 0 }) }));
jest.mock("expo-router", () => ({ useRouter: () => ({ push: jest.fn(), dismissTo: jest.fn() }), useIsFocused: () => true }));
jest.mock("@/hooks/useCardPalette", () => ({ useCardPalette: () => ({ accent: "#FFC312", onAccent: "#000" }), themedStyles: () => () => ({}) }));
jest.mock("@/hooks/useLiveFrameViewport", () => ({ useLiveFrameViewport: () => ({ viewabilityPairs: [], visibleChannelIds: new Set() }) }));
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
jest.mock("@/components/library-header", () => ({
  LibraryHeader: ({ filtersButtonHasPreferredFocus }: { filtersButtonHasPreferredFocus: boolean }) => {
    mockClaims.push(filtersButtonHasPreferredFocus);
    return null;
  },
}));
jest.mock("@/components/live-tv/guide-channel-card", () => ({ GuideChannelCard: () => null }));
jest.mock("@/components/video-grid-item", () => ({ VideoGridItem: () => null }));
jest.mock("@expo/vector-icons", () => ({ Ionicons: () => null }));

Object.defineProperty(Platform, "isTV", { value: true, configurable: true });
// Read after the flag: the grid fixes its platform at import.
const { LibraryGrid } = require("@/components/library-grid") as typeof import("@/components/library-grid");

const items = [{ Id: "a", Name: "A", Type: "Movie" }] as JellyfinItem[];
let mounts = 0;
function Band() {
  useEffect(() => {
    mounts += 1;
  }, []);
  return <Text>band</Text>;
}
const grid = (shown: JellyfinItem[], isLoading: boolean) => (
  <LibraryGrid
    items={shown}
    isLoading={isLoading}
    isLoadingMore={false}
    hasMoreResults={false}
    error={null}
    onItemPress={jest.fn()}
    onLoadMore={jest.fn()}
    headerAction={{ icon: "settings-outline", onPress: jest.fn() }}
    listBand={<Band />}
  />
);
const lastClaim = () => mockClaims[mockClaims.length - 1];

beforeEach(() => {
  mockClaims = [];
  mounts = 0;
});

test("the bar and band show through the first load, and an empty first result lets the bar claim focus", () => {
  let tree!: TestRenderer.ReactTestRenderer;
  act(() => {
    tree = TestRenderer.create(grid([], true));
  });
  expect(lastClaim()).toBe(false);
  act(() => tree.update(grid([], false)));
  expect(lastClaim()).toBe(true);
  expect(mounts).toBe(1);
  act(() => tree.unmount());
});

test("a reload that comes back empty keeps the band mounted and never lets the bar claim focus", () => {
  let tree!: TestRenderer.ReactTestRenderer;
  act(() => {
    tree = TestRenderer.create(grid(items, false));
  });
  act(() => tree.update(grid([], true)));
  expect(lastClaim()).toBe(false);
  act(() => tree.update(grid([], false)));
  expect(mockClaims).not.toContain(true);
  expect(mounts).toBe(1);
  act(() => tree.unmount());
});
