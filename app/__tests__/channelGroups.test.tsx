/** The groups picker: a filter pick returns; opened with a channel, it holds the channel's group section and a close. */
import React from "react";
import TestRenderer, { act } from "react-test-renderer";
import { useLocalSearchParams } from "expo-router";
import ChannelGroupsScreen from "@/app/channel-groups";
import { getLiveTvPreferences, updateLiveTvPreferences } from "@/services/liveTvPreferences";

const mockPush = jest.fn();
const mockBack = jest.fn();
jest.mock("expo-router", () => ({
  useLocalSearchParams: jest.fn(),
  useRouter: () => ({ push: mockPush, back: mockBack }),
  Stack: { Screen: (props: object) => require("react").createElement("StackScreen", props) },
}));
jest.mock("@/components/live-tv/channel-group-section", () => ({ ChannelGroupSection: (props: object) => require("react").createElement("GroupSection", props) }));
jest.mock("expo-router/react-navigation", () => ({ useHeaderHeight: () => 0 }));
jest.mock("@/utils/logger", () => ({ logger: { error: jest.fn(), info: jest.fn(), debug: jest.fn(), warn: jest.fn() } }));
jest.mock("@/components/ambient-background", () => ({ AmbientBackground: () => null }));
jest.mock("@/hooks/useChannelFilterChoices", () => ({
  useChannelFilterChoices: () => [
    { filter: "all", label: "All" },
    { filter: "category:news", label: "News" },
  ],
}));

jest.mock("@/components/settings/ListRow", () => ({
  ListRow: ({ title, onPress, trailingIcon }: { title: string; onPress: () => void; trailingIcon?: unknown }) => {
    const { Text } = require("react-native");
    return <Text testID={`row:${title}`} accessibilityState={{ checked: !!trailingIcon }} onPress={onPress} />;
  },
}));

const row = (tree: TestRenderer.ReactTestRenderer, title: string) => tree.root.findByProps({ testID: `row:${title}` });
const ticked = (tree: TestRenderer.ReactTestRenderer, title: string) => row(tree, title).props.accessibilityState.checked;
const titles = (tree: TestRenderer.ReactTestRenderer) =>
  tree.root.findAll((node) => typeof node.type === "string" && String(node.props.testID ?? "").startsWith("row:")).map((node) => node.props.testID.slice(4));

function mount(params: Record<string, string>) {
  (useLocalSearchParams as jest.Mock).mockReturnValue(params);
  let tree: TestRenderer.ReactTestRenderer | undefined;
  act(() => {
    tree = TestRenderer.create(<ChannelGroupsScreen />);
  });
  return tree!;
}

const press = (tree: TestRenderer.ReactTestRenderer, title: string) => act(() => row(tree, title).props.onPress());

describe("Channel groups", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    updateLiveTvPreferences({ groups: [], favorites: [], filter: "all" });
  });

  it("picks a filter and returns", () => {
    const tree = mount({});
    expect(titles(tree)).toEqual(["All", "News"]);
    expect(ticked(tree, "All")).toBe(true);
    press(tree, "News");
    expect(getLiveTvPreferences().filter).toBe("category:news");
    expect(mockBack).toHaveBeenCalledTimes(1);
  });

  it("with a channel, hosts its group section and a close that returns", () => {
    const tree = mount({ channelId: "c1", channelName: "One", channelNumber: "7" });
    expect(titles(tree)).toEqual([]);
    expect(tree.root.findByType("GroupSection" as never).props.channel).toEqual({ Id: "c1", Name: "One", ChannelNumber: "7" });
    const [close] = tree.root.findByType("StackScreen" as never).props.options.unstable_headerRightItems();
    expect(close.icon).toEqual({ type: "sfSymbol", name: "xmark" });
    act(() => close.onPress());
    expect(mockBack).toHaveBeenCalledTimes(1);
  });

  it("without a channel, adds no close", () => {
    const tree = mount({});
    expect(tree.root.findAllByType("StackScreen" as never)).toHaveLength(0);
    expect(mockPush).not.toHaveBeenCalled();
  });
});
