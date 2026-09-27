/** A resting reel follows its channel's bursts: a replaced burst repaints without any focus. */
import React from "react";
import TestRenderer, { act } from "react-test-renderer";

const mockListeners = new Map<string, Set<() => void>>();
let mockBurst: { frames: { uri: string; cacheKey: string }[]; at: number } | undefined;

jest.mock("@/services/liveFrames", () => ({
  liveFrameReel: () => mockBurst,
  subscribeLiveFrame: (channelId: string, listener: () => void) => {
    const set = mockListeners.get(channelId) ?? new Set();
    set.add(listener);
    mockListeners.set(channelId, set);
    return () => set.delete(listener);
  },
}));
jest.mock("expo-image", () => ({ Image: (props: { source?: { cacheKey?: string } }) => require("react").createElement("Image", props) }));

import { GuideFocusReel } from "@/components/live-tv/guide-focus-reel";

const scrollX = { value: 0 } as unknown as import("react-native-reanimated").SharedValue<number>;

function frames(at: number, count: number) {
  return { at, frames: Array.from({ length: count }, (_, i) => ({ uri: `file:///f-${at}-${i}.jpg`, cacheKey: `k-${at}-${i}` })) };
}

describe("GuideFocusReel", () => {
  it("repaints a resting reel when a new burst replaces the old, no focus involved", () => {
    mockBurst = frames(1000, 3);
    let tree!: TestRenderer.ReactTestRenderer;
    act(() => {
      tree = TestRenderer.create(<GuideFocusReel channelId="c1" left={0} width={4000} cellHeight={180} scrollX={scrollX} active={false} />);
    });
    const keys = () => tree.root.findAllByType("Image" as never).map((node) => (node.props as { source: { cacheKey: string } }).source.cacheKey);
    expect(keys()).toEqual(["k-1000-0", "k-1000-1", "k-1000-2"]);
    act(() => {
      mockBurst = frames(2000, 4);
      for (const listener of mockListeners.get("c1") ?? []) listener();
    });
    expect(keys()).toEqual(["k-2000-0", "k-2000-1", "k-2000-2", "k-2000-3"]);
  });
});
