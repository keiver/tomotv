import React from "react";
import TestRenderer, { act } from "react-test-renderer";
import { Text } from "react-native";
import { GuideChannelRow } from "@/components/live-tv/guide-channel-row";
import type { JellyfinItem } from "@/types/jellyfin";

jest.mock("@/services/jellyfinApi", () => ({ getPosterUrl: () => "poster", hasPoster: () => false }));
jest.mock("expo-image", () => ({ Image: () => null }));

const channel = { Id: "c1", Name: "News 24", ChannelNumber: "7" } as unknown as JellyfinItem;

function render(overrides: Partial<React.ComponentProps<typeof GuideChannelRow>> = {}) {
  let tree: TestRenderer.ReactTestRenderer | undefined;
  act(() => {
    tree = TestRenderer.create(<GuideChannelRow channel={channel} height={96} onPress={jest.fn()} {...overrides} />);
  });
  return tree!;
}

describe("GuideChannelRow", () => {
  it("shows the channel number and name", () => {
    const tree = render();
    expect(tree.root.findAllByType(Text).map((node) => node.props.children)).toEqual(["7", "News 24"]);
  });

  it("tunes its channel on press", () => {
    const onPress = jest.fn();
    const tree = render({ onPress });
    act(() => tree.root.findByProps({ accessibilityRole: "button" }).props.onPress());
    expect(onPress).toHaveBeenCalledWith(channel);
  });

  it("reports focus so the column drives the grid's scroll", () => {
    const onFocus = jest.fn();
    const tree = render({ onFocus });
    act(() => tree.root.findByProps({ accessibilityRole: "button" }).props.onFocus());
    expect(onFocus).toHaveBeenCalledTimes(1);
  });
});
