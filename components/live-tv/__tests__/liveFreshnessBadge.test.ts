/** LiveFreshnessBadge: LIVE at full strength while the picture is seconds old, then fading out by the refresh floor. */
import { LIVE_FRESH_MS, LiveFreshnessBadge, liveBadgeOpacity } from "@/components/live-tv/live-freshness-badge";
import React from "react";
import { Animated, StyleSheet, Text } from "react-native";
import { COLORS } from "@/constants/colors";
import TestRenderer, { act } from "react-test-renderer";

jest.mock("expo-image", () => ({ Image: () => null }));
jest.mock("@/services/i18n", () => ({ t: (key: string) => key }));

let mockReel: { frames: { uri: string }[]; at: number } | undefined;
let mockDueAt: number | undefined;
const mockListeners = new Set<() => void>();
jest.mock("@/services/liveFrames", () => ({
  LIVE_FRAME_TRANSITION_MS: 300,
  LIVE_FRAME_REFRESH_MS: 120_000,
  liveFrameReel: () => mockReel,
  liveFrameDueAt: () => mockDueAt,
  subscribeLiveFrame: (_id: string, listener: () => void) => {
    mockListeners.add(listener);
    return () => mockListeners.delete(listener);
  },
}));
const notify = () => {
  for (const listener of mockListeners) listener();
};

describe("LiveFreshnessBadge", () => {
  beforeEach(() => {
    // Each fade lands at once, so the style shows the step's opacity.
    jest
      .spyOn(Animated, "timing")
      .mockImplementation(
        (value, config) => ({ start: () => (value as Animated.Value).setValue(config.toValue as number), stop: () => undefined, reset: () => undefined }) as Animated.CompositeAnimation,
      );
    jest.useFakeTimers();
    jest.setSystemTime(1_000_000);
    mockListeners.clear();
    mockReel = undefined;
    mockDueAt = undefined;
  });
  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  const badge = () => React.createElement(LiveFreshnessBadge, { channelId: "c1" });
  const texts = (renderer: TestRenderer.ReactTestRenderer) => renderer.root.findAllByType(Text).map((node) => node.props.children);
  const opacity = (renderer: TestRenderer.ReactTestRenderer) => StyleSheet.flatten((renderer.toJSON() as TestRenderer.ReactTestRendererJSON).props.style).opacity;

  it("shows LIVE on red at full strength for a just-landed burst, fades it out after the window, and brings it back on a new burst", () => {
    mockReel = { frames: [{ uri: "a" }], at: 1_000_000 };
    mockDueAt = 1_000_000 + 120_000;
    let renderer!: TestRenderer.ReactTestRenderer;
    act(() => {
      renderer = TestRenderer.create(badge());
    });
    expect(texts(renderer)).toEqual(["liveTv.live"]);
    expect(StyleSheet.flatten((renderer.toJSON() as TestRenderer.ReactTestRendererJSON).props.style).backgroundColor).toBe(COLORS.DESTRUCTIVE_DEEP);
    expect(opacity(renderer)).toBe(1);

    act(() => {
      jest.advanceTimersByTime(LIVE_FRESH_MS + 2_000);
    });
    expect(texts(renderer)).toEqual(["liveTv.live"]);
    expect(opacity(renderer)).toBeLessThan(1);
    expect(opacity(renderer)).toBeGreaterThan(0);

    act(() => {
      jest.advanceTimersByTime(120_000);
    });
    expect(opacity(renderer)).toBe(0);

    // A fresh burst is a new reel object: LIVE again from now.
    mockReel = { frames: [{ uri: "b" }], at: Date.now() };
    act(() => notify());
    act(() => {
      jest.advanceTimersByTime(1_000);
    });
    expect(opacity(renderer)).toBe(1);
    act(() => renderer.unmount());
  });

  it("counts an unchanged verify as fresh: the reel is re-dated in place and its due moves", () => {
    mockReel = { frames: [{ uri: "a" }], at: 1_000_000 - 60_000 };
    mockDueAt = 1_000_000 + 60_000;
    let renderer!: TestRenderer.ReactTestRenderer;
    act(() => {
      renderer = TestRenderer.create(badge());
    });
    expect(opacity(renderer)).toBeLessThan(1);
    mockReel.at = Date.now();
    mockDueAt = Date.now() + 120_000;
    act(() => notify());
    act(() => {
      jest.advanceTimersByTime(1_000);
    });
    expect(opacity(renderer)).toBe(1);
    act(() => renderer.unmount());
  });

  it("steps the opacity from full while fresh down to none, and none without a picture", () => {
    expect(liveBadgeOpacity(-1)).toBe(0);
    expect(liveBadgeOpacity(0)).toBe(1);
    expect(liveBadgeOpacity(1)).toBeGreaterThan(liveBadgeOpacity(5));
    expect(liveBadgeOpacity(9)).toBe(0);
  });

  it("renders nothing without a picture", () => {
    let renderer!: TestRenderer.ReactTestRenderer;
    act(() => {
      renderer = TestRenderer.create(badge());
    });
    expect(renderer.toJSON()).toBeNull();
    act(() => renderer.unmount());
  });
});
