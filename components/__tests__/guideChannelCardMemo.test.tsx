/** A list re-running its renderItem re-renders only the channel cards whose props moved. */
import React from "react";
import TestRenderer, { act } from "react-test-renderer";

let mockCardRenders = 0;
jest.mock("expo-router", () => ({ useIsFocused: () => true }));
jest.mock("@/components/video-grid-item", () => ({
  VideoGridItem: (props: object) => require("react").createElement("VideoGridItem", props),
}));
jest.mock("@/hooks/useLiveFrame", () => ({ useLiveFrame: () => undefined, useLiveClip: () => undefined }));
// Called once per card render.
jest.mock("@/hooks/useChannelHealth", () => ({
  useChannelHealth: () => {
    mockCardRenders += 1;
    return "unknown";
  },
}));

import { GuideChannelCard } from "@/components/live-tv/guide-channel-card";
import type { JellyfinItem } from "@/types/jellyfin";

const CARDS = 10;
const channels = Array.from({ length: CARDS }, (_, i) => ({ Id: `c${i}`, Name: `Channel ${i}`, Type: "TvChannel" }) as JellyfinItem);
const inset = { vertical: 8, horizontal: 8 };
const press = () => undefined;

/** The guide column's renderItem: fresh elements on every call. */
function Column({ visible }: { visible: ReadonlySet<string> }) {
  return (
    <>
      {channels.map((channel, index) => (
        <GuideChannelCard
          key={channel.Id}
          channel={channel}
          index={index}
          cardWidth={300}
          hideAiring
          hideNumber
          flat
          inset={inset}
          recording={false}
          onPress={press}
          onLongPress={press}
          playsClipInView
          inView={visible.has(channel.Id)}
        />
      ))}
    </>
  );
}

describe("GuideChannelCard", () => {
  it("re-renders only the cards entering or leaving view when the visible set is rebuilt", () => {
    const ids = channels.slice(0, 4).map((channel) => channel.Id);
    let tree!: TestRenderer.ReactTestRenderer;
    act(() => {
      tree = TestRenderer.create(<Column visible={new Set(ids)} />);
    });
    mockCardRenders = 0;
    act(() => tree.update(<Column visible={new Set(ids)} />));
    expect(mockCardRenders).toBe(0);
    // One row down: c0 leaves, c4 enters.
    act(() => tree.update(<Column visible={new Set(ids.slice(1).concat("c4"))} />));
    expect(mockCardRenders).toBe(2);
    act(() => tree.unmount());
  });
});
