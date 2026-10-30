/** The wall's filter button: always in the bar, filled while a group holds the list, a press opens the Groups picker. */
import React from "react";
import TestRenderer, { act } from "react-test-renderer";

let mockScreenOptions: { unstable_headerRightItems?: () => { label: string; icon: { name: string }; onPress: () => void }[] } = {};
let mockGridProps: Record<string, unknown> = {};
let mockFilter = "all";
const mockPush = jest.fn();

jest.mock("expo-router", () => ({
  Stack: {
    Screen: ({ options }: { options: typeof mockScreenOptions }) => {
      mockScreenOptions = options;
      return null;
    },
  },
  useIsFocused: () => false,
  useRouter: () => ({ push: mockPush, navigate: jest.fn() }),
}));
jest.mock("@/components/ambient-background", () => ({ AmbientBackground: () => null }));
jest.mock("@/components/library-grid", () => ({
  LibraryGrid: (props: Record<string, unknown>) => {
    mockGridProps = props;
    return null;
  },
}));
jest.mock("@/components/live-tv/show-all-channels", () => ({ ShowAllChannels: () => null }));
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

beforeEach(() => mockPush.mockClear());

test("with every channel shown, the filter button sits before Settings with its outline symbol", () => {
  const { labels, items, tvAction } = render("all");
  expect(labels).toEqual(["tab.search", "liveTv.groups", "settings.title"]);
  expect(items[1].icon.name).toBe("line.3.horizontal.decrease.circle");
  expect(tvAction).toBeDefined();
});

test("with a group picked, the symbol fills and a press opens the Groups picker on both platforms", () => {
  const { items, tvAction } = render("group:g1");
  expect(items[1].icon.name).toBe("line.3.horizontal.decrease.circle.fill");
  items[1].onPress();
  expect(mockPush).toHaveBeenLastCalledWith("/channel-groups");
  tvAction?.onPress();
  expect(mockPush).toHaveBeenCalledTimes(2);
});

test("the wall heads its grid with no band", () => {
  render("all");
  expect(mockGridProps.listBand).toBeUndefined();
  expect(mockGridProps.headerTrailingTarget).toBeUndefined();
});
