/** The wall's filter button only clears: it shows while a group holds the list and a press shows every channel. */
import React from "react";
import TestRenderer, { act } from "react-test-renderer";

let mockScreenOptions: { unstable_headerRightItems?: () => { label: string; onPress: () => void }[] } = {};
let mockGridProps: Record<string, unknown> = {};
let mockFilter = "all";
const mockUpdate = jest.fn();

jest.mock("expo-router", () => ({
  Stack: {
    Screen: ({ options }: { options: typeof mockScreenOptions }) => {
      mockScreenOptions = options;
      return null;
    },
  },
  useIsFocused: () => false,
  useRouter: () => ({ push: jest.fn(), navigate: jest.fn() }),
}));
jest.mock("@/components/ambient-background", () => ({ AmbientBackground: () => null }));
jest.mock("@/components/library-grid", () => ({
  LibraryGrid: (props: Record<string, unknown>) => {
    mockGridProps = props;
    return null;
  },
}));
jest.mock("@/components/live-tv/show-all-channels", () => ({ ShowAllChannels: () => null }));
jest.mock("@/components/live-tv/wall-groups-band", () => ({ WallGroupsBand: () => null }));
jest.mock("@/components/sf-symbol-icon", () => ({ SfSymbolIcon: () => null }));
jest.mock("@/components/header-search-reveal", () => ({ HeaderSearchReveal: () => null }));
jest.mock("@/contexts/LoadingContext", () => ({ useLoadingActions: () => ({ showGlobalLoader: jest.fn() }) }));
jest.mock("@/hooks/useCardPalette", () => ({ useCardPalette: () => ({ accent: "#FFC312" }) }));
jest.mock("@/hooks/useItemLongPress", () => ({ useItemLongPress: () => jest.fn() }));
jest.mock("@/hooks/useLiveTvSearchRefresh", () => ({ useLiveTvSearchRefresh: () => undefined }));
jest.mock("@/hooks/useChannelFavoritesSync", () => ({ useChannelFavoritesSync: () => undefined }));
jest.mock("@/hooks/useChannels", () => ({
  useChannels: () => ({ items: [], isLoading: false, isLoadingMore: false, hasMore: false, error: null, loadMore: jest.fn(), retry: jest.fn() }),
}));
jest.mock("@/hooks/useLiveTvPreferences", () => ({ useLiveTvPreferences: () => ({ filter: mockFilter, sort: "number", hideOffline: false, autoUpdate: true }) }));
jest.mock("@/hooks/useOpenShelfItem", () => ({ useOpenShelfItem: () => jest.fn() }));
jest.mock("@/hooks/useChannelFilterChoices", () => ({
  useChannelFilterChoices: () => [
    { filter: "all", label: "All" },
    { filter: "group:g1", label: "News" },
  ],
}));
jest.mock("@/hooks/useTunerGroups", () => ({ usePlaylistChannelIds: () => null }));
jest.mock("@/hooks/useChannelHealth", () => ({ useHealthGeneration: () => 0 }));
jest.mock("@/services/channelHealth", () => ({ healthFor: () => undefined }));
jest.mock("@/services/i18n", () => ({ t: (key: string) => key }));
jest.mock("@/services/jellyfinApi", () => ({ fetchTimers: jest.fn(async () => []), searchLiveTv: jest.fn(async () => []), warmLiveTvSearch: jest.fn(async () => undefined) }));
jest.mock("@/services/recordingStatus", () => ({ reportRecordingTimers: jest.fn() }));
jest.mock("@/services/searchFocus", () => ({ requestSearchFocus: jest.fn() }));
jest.mock("@/services/liveTvPreferences", () => ({
  activeCategory: () => null,
  activeChannelList: () => null,
  isFavoriteChannel: () => false,
  updateLiveTvPreferences: (...args: unknown[]) => mockUpdate(...args),
}));
jest.mock("@/utils/guide", () => ({ activeRecordTimer: () => undefined, programRecording: () => false }));
jest.mock("@/utils/logger", () => ({ logger: { warn: jest.fn() } }));
jest.mock("@expo/vector-icons", () => ({ Ionicons: () => null }));

import ChannelsScreen from "@/app/channels";

function render(filter: string) {
  mockFilter = filter;
  let tree!: TestRenderer.ReactTestRenderer;
  act(() => {
    tree = TestRenderer.create(<ChannelsScreen />);
  });
  const items = mockScreenOptions.unstable_headerRightItems?.() ?? [];
  const tvAction = mockGridProps.headerSecondaryAction as { onPress: () => void } | undefined;
  act(() => tree.unmount());
  return { labels: items.map((item) => item.label), items, tvAction };
}

beforeEach(() => mockUpdate.mockClear());

test("with every channel shown, the bar has no filter button on either platform", () => {
  const { labels, tvAction } = render("all");
  expect(labels).toEqual(["tab.search", "settings.title"]);
  expect(tvAction).toBeUndefined();
});

test("with a group picked, the filter button sits before Settings and a press shows every channel", () => {
  const { labels, items, tvAction } = render("group:g1");
  expect(labels).toEqual(["tab.search", "liveTv.showAll", "settings.title"]);
  items[1].onPress();
  expect(mockUpdate).toHaveBeenLastCalledWith({ filter: "all" });
  tvAction?.onPress();
  expect(mockUpdate).toHaveBeenCalledTimes(2);
  expect(mockUpdate).toHaveBeenLastCalledWith({ filter: "all" });
});

test("the wall hands the grid its groups band", () => {
  render("all");
  expect(mockGridProps.listBand).toBeTruthy();
});

test("the loading bar names the picked group, and the folder's own name with every channel shown", () => {
  render("group:g1");
  expect(mockGridProps.loadingTitle).toBe("News");
  render("all");
  expect(mockGridProps.loadingTitle).toBeUndefined();
});
