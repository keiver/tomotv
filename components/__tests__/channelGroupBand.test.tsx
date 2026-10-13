/** The info panel's group band lists Favorites and every group, ticking the channel's own, and a press toggles it. */
import { ChannelGroupBand } from "@/components/live-tv/channel-group-band";
import { getLiveTvPreferences, isChannelInGroup, updateLiveTvPreferences } from "@/services/liveTvPreferences";
import React from "react";
import TestRenderer, { act } from "react-test-renderer";

jest.mock("expo-router", () => ({ useRouter: () => ({ push: jest.fn() }) }));
jest.mock("@expo/vector-icons", () => ({ Ionicons: () => null }));
jest.mock("@/components/sf-symbol-icon", () => ({ SfSymbolIcon: () => null }));
jest.mock("@/services/channelFavorites", () => ({ toggleFavoriteChannel: jest.fn() }));
jest.mock("@/hooks/useTunerGroups", () => ({
  useTunerGroups: () => [
    { name: "General", channelIds: ["c1"] },
    { name: "Shop", channelIds: ["c2"] },
  ],
}));

const channel = { Id: "c1", Name: "One", ChannelNumber: "7" };

function cells(tree: TestRenderer.ReactTestRenderer) {
  return tree.root
    .findAll((node) => typeof node.type !== "string" && node.props.accessibilityRole === "checkbox" && node.props.isTVSelectable)
    .map((node) => ({ label: node.props.accessibilityLabel as string, checked: node.props.accessibilityState.checked as boolean, press: node.props.onPress as () => void }));
}

describe("ChannelGroupBand", () => {
  beforeEach(() => {
    updateLiveTvPreferences({
      favorites: [],
      playlistEdits: {},
      groups: [
        { id: "g1", name: "Sports", channels: [{ number: "7", name: "One" }] },
        { id: "g2", name: "Movies", channels: [] },
        { id: "g3", name: "Kids", channels: [] },
      ],
    });
  });

  it("lists every group, the channel's ticked and the rest unticked", () => {
    let tree!: TestRenderer.ReactTestRenderer;
    act(() => {
      tree = TestRenderer.create(<ChannelGroupBand channel={channel} />);
    });
    expect(cells(tree).map(({ label, checked }) => [label, checked])).toEqual([
      ["Favorites", false],
      ["Sports", true],
      ["Movies", false],
      ["Kids", false],
      ["General", true],
      ["Shop", false],
    ]);
  });

  it("adds the channel to a playlist group it is not in, and takes it out of one it is", () => {
    let tree!: TestRenderer.ReactTestRenderer;
    act(() => {
      tree = TestRenderer.create(<ChannelGroupBand channel={channel} />);
    });
    act(() => cells(tree)[5].press());
    act(() => cells(tree)[4].press());
    expect(
      cells(tree)
        .slice(4)
        .map(({ label, checked }) => [label, checked]),
    ).toEqual([
      ["General", false],
      ["Shop", true],
    ]);
    expect(getLiveTvPreferences().playlistEdits).toEqual({ Shop: { added: ["c1"], removed: [] }, General: { added: [], removed: ["c1"] } });
  });

  it("adds the channel to an unticked group on press", () => {
    let tree!: TestRenderer.ReactTestRenderer;
    act(() => {
      tree = TestRenderer.create(<ChannelGroupBand channel={channel} />);
    });
    act(() => cells(tree)[2].press());
    expect(isChannelInGroup(getLiveTvPreferences().groups[1], channel)).toBe(true);
    expect(cells(tree)[2].checked).toBe(true);
  });
});
