/** LiveFreshnessBadge: LIVE while the picture is seconds old, an hourglass while the next picture waits, no animation. */
import { LIVE_FRESH_MS, LiveFreshnessBadge, liveRemainMs } from "@/components/live-tv/live-freshness-badge";
import React from "react";
import { Text } from "react-native";
import TestRenderer, { act } from "react-test-renderer";

const mockIcon = jest.fn((_props: { name: string }) => null);
jest.mock("@expo/vector-icons", () => ({ Ionicons: (props: { name: string }) => mockIcon(props) }));
jest.mock("expo-image", () => ({ Image: () => null }));
jest.mock("@/services/i18n", () => ({ t: (key: string) => key }));

let mockReel: { frames: { uri: string }[]; at: number } | undefined;
let mockDueAt: number | undefined;
const mockListeners = new Set<() => void>();
jest.mock("@/services/liveFrames", () => ({
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

describe("liveRemainMs", () => {
  it("holds LIVE for the fresh window from the picture's last change, then stops claiming", () => {
    expect(liveRemainMs(1_000_000, 1_000_000)).toBe(LIVE_FRESH_MS);
    expect(liveRemainMs(1_000_000 + 2_000, 1_000_000)).toBe(LIVE_FRESH_MS - 2_000);
    expect(liveRemainMs(1_000_000 + 60_000, 1_000_000)).toBe(0);
  });
});

describe("LiveFreshnessBadge", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(1_000_000);
    mockIcon.mockClear();
    mockListeners.clear();
    mockReel = undefined;
    mockDueAt = undefined;
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  const badge = () => React.createElement(LiveFreshnessBadge, { channelId: "c1" });
  const texts = (renderer: TestRenderer.ReactTestRenderer) => renderer.root.findAllByType(Text).map((node) => node.props.children);
  const glyphs = () => mockIcon.mock.calls.map(([props]) => props.name);

  it("shows LIVE for a just-landed burst, the hourglass once the window passes, and LIVE again on a new burst", () => {
    mockReel = { frames: [{ uri: "a" }], at: 1_000_000 };
    mockDueAt = 1_000_000 + 120_000;
    let renderer!: TestRenderer.ReactTestRenderer;
    act(() => {
      renderer = TestRenderer.create(badge());
    });
    expect(texts(renderer)).toEqual(["liveTv.live"]);
    expect(glyphs()).toEqual([]);

    act(() => {
      jest.advanceTimersByTime(LIVE_FRESH_MS);
    });
    expect(texts(renderer)).toEqual([]);
    expect(glyphs()).toEqual(["hourglass-outline"]);

    // A fresh burst is a new reel object: LIVE again from now.
    mockReel = { frames: [{ uri: "b" }], at: Date.now() };
    act(() => notify());
    expect(texts(renderer)).toEqual(["liveTv.live"]);
    act(() => renderer.unmount());
  });

  it("counts an unchanged verify as fresh: the reel is re-dated in place and its due moves", () => {
    mockReel = { frames: [{ uri: "a" }], at: 1_000_000 - 60_000 };
    mockDueAt = 1_000_000 + 60_000;
    let renderer!: TestRenderer.ReactTestRenderer;
    act(() => {
      renderer = TestRenderer.create(badge());
    });
    expect(glyphs()).toEqual(["hourglass-outline"]);
    mockReel.at = Date.now();
    mockDueAt = Date.now() + 120_000;
    act(() => notify());
    expect(texts(renderer)).toEqual(["liveTv.live"]);
    act(() => renderer.unmount());
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
