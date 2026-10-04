/** A resting reel follows its channel's bursts: a replaced burst repaints without any focus. */
import React from "react";
import { Animated, StyleSheet } from "react-native";
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

import { GuideFocusReel, reelTiles } from "@/components/live-tv/guide-focus-reel";

const scrollX = new Animated.Value(0);

function frames(at: number, count: number) {
  return { at, frames: Array.from({ length: count }, (_, i) => ({ uri: `file:///f-${at}-${i}.jpg`, cacheKey: `k-${at}-${i}` })) };
}

describe("reelTiles", () => {
  it("stairs each frame over the last by a few pixels at one size", () => {
    const tiles = reelTiles(12, 200, 100, true);
    expect(tiles.every((tile) => tile.width === 200 && tile.height === 100)).toBe(true);
    expect(tiles.map((tile) => tile.marginLeft)).toEqual([0, ...Array(11).fill(-3)]);
  });

  it("keeps the compact strip flat with a gap", () => {
    expect(reelTiles(3, 200, 100, false)).toEqual([
      { width: 200, height: 100, marginLeft: 0 },
      { width: 200, height: 100, marginLeft: 2 },
      { width: 200, height: 100, marginLeft: 2 },
    ]);
  });
});

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

  it("cuts a strip that runs past the screen at the screen's edge, not the window-wide cell's", () => {
    mockBurst = frames(1000, 12);
    const clipWidth = (viewportWidth?: number) => {
      let tree!: TestRenderer.ReactTestRenderer;
      act(() => {
        tree = TestRenderer.create(<GuideFocusReel channelId="c1" left={0} width={40000} cellHeight={180} scrollX={scrollX} viewportWidth={viewportWidth} active={false} />);
      });
      const clip = tree.root.findAll((node) => (node.type as unknown) === "View" && StyleSheet.flatten(node.props.style)?.flexDirection === "row");
      return StyleSheet.flatten(clip[0].props.style).width;
    };
    expect(clipWidth()).toBeUndefined();
    expect(clipWidth(1000)).toBeLessThan(1000);
  });
});
