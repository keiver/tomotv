/** A gliding home shelf never lets the page take the touch from another shelf, so every shelf scrolls at once. */
import { ContinueWatchingRow } from "@/components/continue-watching-row";
import { HomeShelves, stopShelfScrollClaim } from "@/components/home-shelves";
import { ItemShelf } from "@/components/item-shelf";
import { MediaShelf } from "@/components/media-shelf";
import React from "react";
import { GestureResponderEvent, ScrollView } from "react-native";
import TestRenderer, { act } from "react-test-renderer";

jest.mock("react-native-safe-area-context", () => ({ useSafeAreaInsets: () => ({ top: 0, left: 0, right: 0, bottom: 0 }) }));
jest.mock("expo-router", () => ({ useRouter: () => ({ push: jest.fn() }), useIsFocused: () => true }));
jest.mock("@/hooks/useCardPalette", () => ({ useCardPalette: () => ({ accent: "#FFC312", onAccent: "#000" }), themedStyles: () => () => ({}) }));
jest.mock("@/hooks/useItemLongPress", () => ({ useItemLongPress: () => jest.fn() }));
jest.mock("@/hooks/useRecordingStatus", () => ({ useIsRecording: () => false }));
jest.mock("@/services/connectionRecovery", () => ({ getRecoveryStatus: () => "idle", subscribeRecoveryStatus: () => () => {} }));
jest.mock("@/services/jellyfinApi", () => ({ fetchFavoriteItems: jest.fn(async () => []), fetchLatestItems: jest.fn(async () => []), isFolder: () => false, signOut: jest.fn() }));
jest.mock("@/services/i18n", () => ({ t: (key: string) => key }));
jest.mock("@/components/ambient-background", () => ({ AmbientBackground: () => null }));
jest.mock("@/components/continue-watching-row", () => ({ ContinueWatchingRow: () => null }));
jest.mock("@/components/FocusableButton", () => ({ FocusableButton: () => null }));
jest.mock("@/components/loading-row", () => ({ LoadingRow: () => null }));
jest.mock("@/components/item-shelf", () => ({ ItemShelf: () => null }));
jest.mock("@/components/media-shelf", () => ({ MediaShelf: () => null }));
jest.mock("@/components/folder-grid-item", () => ({ FolderGridItem: () => null }));
jest.mock("@/components/video-grid-item", () => ({ VideoGridItem: () => null }));
jest.mock("@expo/vector-icons", () => ({ Ionicons: () => null }));

it("stops a shelf's scroll event before the page and claims nothing itself", () => {
  const stopPropagation = jest.fn();
  expect(stopShelfScrollClaim({ stopPropagation } as unknown as GestureResponderEvent)).toBe(false);
  expect(stopPropagation).toHaveBeenCalledTimes(1);
});

it("wraps every shelf in the page in the view that stops shelf scroll events", async () => {
  let tree!: TestRenderer.ReactTestRenderer;
  await act(async () => {
    tree = TestRenderer.create(
      <HomeShelves libraries={[{ Id: "lib-1", Name: "Movies", Type: "CollectionFolder" } as never]} isLoading={false} error={null} onRetry={jest.fn()} onLibraryPress={jest.fn()} />,
    );
  });
  const wrapper = tree.root.findByType(ScrollView).findAll((node) => node.props.onScrollShouldSetResponder === stopShelfScrollClaim)[0];
  expect(wrapper.findAllByType(MediaShelf)).toHaveLength(1);
  expect(wrapper.findAllByType(ContinueWatchingRow)).toHaveLength(1);
  expect(wrapper.findAllByType(ItemShelf)).toHaveLength(2);
  act(() => tree.unmount());
});
