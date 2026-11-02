/** The Hidden Channels screen: one row per hidden channel, a press shows it again and drops the cached lists; an empty list says so. */
import HiddenChannelsScreen from "@/app/hidden-channels";
import { ListRow } from "@/components/settings/ListRow";
import { invalidateChannelListReads } from "@/services/jellyfin/channelEdits";
import { unhideChannel, type ChannelFavorite } from "@/services/liveTvPreferences";
import React from "react";
import TestRenderer, { act } from "react-test-renderer";

let mockHidden: ChannelFavorite[] = [];
jest.mock("@/components/ambient-background", () => ({ AmbientBackground: () => null }));
jest.mock("@/components/settings/ListRow", () => ({ ListRow: () => null }));
jest.mock("@/components/settings/SectionFooter", () => ({ SectionFooter: ({ children }: { children: React.ReactNode }) => children }));
jest.mock("@/hooks/useLiveTvPreferences", () => ({ useLiveTvPreferences: () => ({ hidden: mockHidden }) }));
jest.mock("@/services/i18n", () => ({ t: (key: string) => key }));
jest.mock("@/services/jellyfin/channelEdits", () => ({ invalidateChannelListReads: jest.fn() }));
jest.mock("@/services/liveTvPreferences", () => ({
  favoriteKey: (entry: { number?: string; name: string }) => (entry.number ? `${entry.number}|${entry.name}` : entry.name),
  unhideChannel: jest.fn(),
}));
jest.mock("expo-router/react-navigation", () => ({ useHeaderHeight: () => 0 }));
jest.mock("react-native-safe-area-context", () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));

function rows() {
  let tree!: TestRenderer.ReactTestRenderer;
  act(() => {
    tree = TestRenderer.create(<HiddenChannelsScreen />);
  });
  const found = tree.root.findAllByType(ListRow).map((row) => row.props as { title: string; subtitle?: string; onPress?: () => void; disabled?: boolean; isFirst?: boolean; isLast?: boolean });
  act(() => tree.unmount());
  return found;
}

describe("HiddenChannelsScreen", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockHidden = [];
  });

  it("says when nothing is hidden", () => {
    expect(rows()).toEqual([expect.objectContaining({ title: "liveTv.noHiddenChannels", disabled: true, isFirst: true, isLast: true })]);
  });

  it("lists each hidden channel with its number and shows one again on press", () => {
    mockHidden = [{ id: "x", number: "9.1", name: "KQED" }, { name: "Al Jazeera English" }];
    const list = rows();
    expect(list.map((row) => [row.title, row.subtitle, row.isFirst, row.isLast])).toEqual([
      ["KQED", "9.1", true, false],
      ["Al Jazeera English", undefined, false, true],
    ]);
    list[1].onPress?.();
    expect(unhideChannel).toHaveBeenCalledWith({ name: "Al Jazeera English" });
    expect(invalidateChannelListReads).toHaveBeenCalledTimes(1);
  });
});
