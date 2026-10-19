/** A band heading the grid on phone: scrolls with the rows, its height in their offsets, and mounted through a reload. */
import { LibraryGrid } from "@/components/library-grid";
import type { JellyfinItem } from "@/types/jellyfin";
import React, { useEffect } from "react";
import { FlatList, StyleSheet, Text, View } from "react-native";
import TestRenderer, { act } from "react-test-renderer";

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
jest.mock("@/components/library-header", () => ({ LibraryHeader: () => null }));
jest.mock("@/components/live-tv/guide-channel-card", () => ({ GuideChannelCard: () => null }));
jest.mock("@/components/video-grid-item", () => ({ VideoGridItem: () => null }));
jest.mock("@expo/vector-icons", () => ({ Ionicons: () => null }));

const items = [{ Id: "a", Name: "A", Type: "Movie" }] as JellyfinItem[];

function firstRowOffset(band: React.ReactNode, bandHeight: number): number {
  let tree!: TestRenderer.ReactTestRenderer;
  act(() => {
    tree = TestRenderer.create(
      <LibraryGrid items={items} isLoading={false} isLoadingMore={false} hasMoreResults={false} error={null} onItemPress={jest.fn()} onLoadMore={jest.fn()} listBand={band} />,
    );
  });
  // The innermost measured View holding the band: the list's own cell wrappers measure too.
  const header = tree.root.findAll((node) => node.type === View && typeof node.props.onLayout === "function" && node.findAllByType(Text).length > 0).pop();
  if (header) act(() => header.props.onLayout({ nativeEvent: { layout: { x: 0, y: 0, width: 300, height: bandHeight } } }));
  const offset = tree.root.findByType(FlatList).props.getItemLayout(null, 0).offset;
  act(() => tree.unmount());
  return offset;
}

test("the band's measured height rides the first row's offset, and no band leaves it out", () => {
  const without = firstRowOffset(undefined, 0);
  expect(firstRowOffset(<Text>band</Text>, 50)).toBe(without + 50);
});

test("a reload that empties the grid keeps the band and the list mounted, its empty block under the band", () => {
  let mounts = 0;
  function Band() {
    useEffect(() => {
      mounts += 1;
    }, []);
    return <Text>band</Text>;
  }
  const grid = (shown: JellyfinItem[], isLoading: boolean) => (
    <LibraryGrid items={shown} isLoading={isLoading} isLoadingMore={false} hasMoreResults={false} error={null} onItemPress={jest.fn()} onLoadMore={jest.fn()} listBand={<Band />} />
  );
  let tree!: TestRenderer.ReactTestRenderer;
  act(() => {
    tree = TestRenderer.create(grid(items, false));
  });
  const list = tree.root.findByType(FlatList).instance;
  // On screen: the grid spans 0 to 900, the bar and band 64 to 164.
  type Measured = { measureInWindow: (callback: (x: number, y: number, width: number, height: number) => void) => void };
  (tree.root.findByProps({ testID: "library-grid" }).instance as Measured).measureInWindow = (callback) => callback(0, 0, 300, 900);
  const header = tree.root.findByProps({ testID: "library-grid-header" });
  (header.instance as Measured).measureInWindow = (callback) => callback(0, 64, 300, 100);
  act(() => header.props.onLayout({ nativeEvent: { layout: { x: 0, y: 0, width: 300, height: 100 } } }));
  act(() => tree.update(grid([], true)));
  // Loading: the hourglass fills the screen under the band, so it sits at that space's centre.
  expect(StyleSheet.flatten(tree.root.findByProps({ testID: "library-grid-loading" }).props.style)).toMatchObject({
    position: "absolute",
    top: 164,
    bottom: 0,
    justifyContent: "center",
    alignItems: "center",
  });
  act(() => tree.update(grid([], false)));
  // Loaded empty: the block in the list is exactly that space's height.
  expect(tree.root.findByType(FlatList).props.ListEmptyComponent.props.style).toEqual({ height: 736 });
  act(() => tree.update(grid([{ Id: "b", Name: "B", Type: "Movie" } as JellyfinItem], false)));
  expect(mounts).toBe(1);
  expect(tree.root.findByType(FlatList).instance).toBe(list);
  act(() => tree.unmount());
});
