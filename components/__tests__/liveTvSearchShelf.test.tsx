import React from "react";
import TestRenderer, { act } from "react-test-renderer";

const mockOpenInfoPanel = jest.fn();
jest.mock("@/hooks/useItemLongPress", () => ({ useItemLongPress: () => mockOpenInfoPanel }));
jest.mock("@/hooks/useOpenShelfItem", () => ({ useOpenShelfItem: () => jest.fn() }));
jest.mock("@/components/video-grid-item", () => ({ VideoGridItem: () => null }));
jest.mock("@/components/media-shelf", () => {
  const { createElement, Fragment } = jest.requireActual<typeof import("react")>("react");
  return {
    MediaShelf: ({ data, renderItem }: { data: unknown[]; renderItem: (item: unknown, index: number, cardHeight: number) => import("react").ReactNode }) =>
      data.map((item, index) => createElement(Fragment, { key: index }, renderItem(item, index, 100))),
  };
});

import { LiveTvSearchShelf } from "@/components/live-tv/live-tv-search-shelf";
import { VideoGridItem } from "@/components/video-grid-item";
import type { JellyfinVideoItem } from "@/types/jellyfin";

const channel = { Id: "ch1", Name: "Channel One", Type: "TvChannel" } as JellyfinVideoItem;
const program = { Id: "p1", Name: "Show", Type: "Program", ChannelId: "ch1" } as JellyfinVideoItem;

test("a channel or programme card's long press opens its info panel", () => {
  let tree!: TestRenderer.ReactTestRenderer;
  act(() => {
    tree = TestRenderer.create(<LiveTvSearchShelf items={[channel, program]} />);
  });
  const [channelCard, programCard] = tree.root.findAllByType(VideoGridItem);
  channelCard.props.onLongPress(channel);
  expect(mockOpenInfoPanel).toHaveBeenLastCalledWith(channel);
  programCard.props.onLongPress(program);
  expect(mockOpenInfoPanel).toHaveBeenLastCalledWith(program);
  tree.unmount();
});
