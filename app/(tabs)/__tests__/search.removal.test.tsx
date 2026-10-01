import React from "react";
import TestRenderer, { act } from "react-test-renderer";
import { searchVideos } from "@/services/jellyfinApi";
import { notifyItemRemoved } from "@/services/jellyfin/events";
import type { JellyfinVideoItem } from "@/types/jellyfin";
import SearchScreen from "../search";

let mockNative = false;
jest.mock("expo-tvos-search", () => ({
  isNativeSearchAvailable: () => mockNative,
  TvosSearchView: (props: object) => require("react").createElement("NativeSearch", props),
}));
jest.mock("expo-router", () => ({ useLocalSearchParams: () => ({ q: "film" }), useRouter: () => ({}), useFocusEffect: jest.fn() }));
jest.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ isConnected: true, isReady: true }) }));
jest.mock("@/contexts/LibraryContext", () => ({ useLibrary: () => ({ isLoading: false }) }));
jest.mock("@/contexts/LoadingContext", () => ({ useLoadingActions: () => ({}) }));
jest.mock("@/hooks/use-color-scheme", () => ({ useColorScheme: () => "dark" }));
jest.mock("@/hooks/useItemLongPress", () => ({ useItemLongPress: () => jest.fn() }));
jest.mock("@/hooks/useOpenShelfItem", () => ({ useOpenShelfItem: () => jest.fn() }));
jest.mock("@/services/jellyfinApi", () => ({ searchVideos: jest.fn(), searchLiveTv: jest.fn(async () => []), connectToDemoServer: jest.fn() }));
jest.mock("@/services/i18n", () => ({ t: (key: string) => key, locale: () => "en", subscribeLocale: () => () => {} }));
jest.mock("@/utils/logger", () => ({ logger: { debug: jest.fn(), error: jest.fn() } }));
jest.mock("@expo/vector-icons", () => ({ Ionicons: () => null }));
jest.mock("react-native-safe-area-context", () => ({ useSafeAreaInsets: () => ({ top: 0, left: 0, right: 0, bottom: 0 }) }));
jest.mock("@/components/ambient-background", () => ({ AmbientBackground: () => null }));
jest.mock("@/components/FocusableButton", () => ({ FocusableButton: () => null }));
jest.mock("@/components/loading-row", () => ({ LoadingRow: () => null }));
jest.mock("@/components/search-loading-bar", () => ({ SearchLoadingBar: () => null }));
jest.mock("@/components/settings/ServerConnectScreen", () => ({ ServerConnectScreen: () => null }));
jest.mock("@/components/settings/styles", () => ({ IS_PAD: false, settingsStyles: {} }));
jest.mock("@/components/sunken-text-input", () => ({
  SunkenTextInput: require("react").forwardRef((props: object, ref: unknown) => require("react").createElement("SearchInput", { ...props, ref })),
}));
jest.mock("@/components/live-tv/live-tv-search-shelf", () => ({ LiveTvSearchShelf: () => null }));
jest.mock("@/components/media-shelf", () => ({ ShelfHeading: () => null }));
jest.mock("@/components/search-results-grid", () => ({
  SearchResultsGrid: require("react").forwardRef((props: object, ref: unknown) => require("react").createElement("ResultsGrid", { ...props, ref })),
}));

const item = (Id: string) => ({ Id, Name: Id, Type: "Movie", Path: "" }) as JellyfinVideoItem;
const mockSearch = searchVideos as jest.MockedFunction<typeof searchVideos>;
let tree: TestRenderer.ReactTestRenderer | undefined;
const results = () => tree!.root.findByType("ResultsGrid" as never);
const ids = () => (results().props.items as JellyfinVideoItem[]).map((video) => video.Id);

beforeEach(() => {
  jest.useFakeTimers();
  mockSearch.mockReset();
});
afterEach(() => {
  act(() => tree?.unmount());
  tree = undefined;
  jest.clearAllTimers();
  jest.useRealTimers();
});

it.each([false, true])("removes a deleted result and retires older requests (native search: %s)", async (native) => {
  mockNative = native;
  let finishOld!: (page: { items: JellyfinVideoItem[]; total: number }) => void;
  let finishFresh!: (page: { items: JellyfinVideoItem[]; total: number }) => void;
  mockSearch
    .mockResolvedValueOnce({ items: [item("deleted"), item("kept")], total: 3 })
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishOld = resolve;
        }),
    )
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishFresh = resolve;
        }),
    )
    .mockResolvedValueOnce({ items: [item("next")], total: 2 });

  await act(async () => {
    tree = TestRenderer.create(<SearchScreen />);
  });
  await act(async () => {
    jest.advanceTimersByTime(300);
  });
  expect(ids()).toEqual(["deleted", "kept"]);

  await act(async () => {
    if (native) tree!.root.findByType("NativeSearch" as never).props.onSearch({ nativeEvent: { query: "film" } });
    else results().props.onEndReached();
  });
  if (native)
    await act(async () => {
      jest.advanceTimersByTime(300);
    });
  expect(mockSearch).toHaveBeenCalledTimes(2);

  await act(async () => {
    notifyItemRemoved("deleted");
  });
  expect(ids()).toEqual(["kept"]);
  if (native)
    await act(async () => {
      jest.advanceTimersByTime(300);
    });
  expect(mockSearch).toHaveBeenCalledTimes(3);
  expect(mockSearch).toHaveBeenLastCalledWith("film", native ? { limit: 60 } : { limit: 60, startIndex: 0 });

  await act(async () => {
    finishFresh({ items: [item("kept")], total: 2 });
  });
  await act(async () => {
    finishOld({ items: [item("deleted")], total: 3 });
  });
  expect(ids()).toEqual(["kept"]);

  if (!native) {
    await act(async () => {
      results().props.onEndReached();
    });
    expect(mockSearch).toHaveBeenLastCalledWith("film", { limit: 60, startIndex: 1 });
    expect(ids()).toEqual(["kept", "next"]);
  }
});
