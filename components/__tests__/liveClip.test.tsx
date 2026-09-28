/** The focused card's preview clip plays at once when focus lands at rest, and waits for focus to settle mid-scroll. */
import React from "react";
import * as Reanimated from "react-native-reanimated";
import TestRenderer, { act } from "react-test-renderer";

jest.mock("@/modules/live-clip", () => ({ LiveClipView: (props: object) => require("react").createElement("LiveClipView", props) }));

import { LiveClip } from "@/components/live-tv/live-clip";
import { LIVE_CLIP_SCROLL_SETTLE_MS } from "@/services/liveFrames";

const clip = { uri: "file:///pool/m1/live-1-clip.mp4", cacheKey: "live-m1-1-clip" };

function mount(): TestRenderer.ReactTestRenderer {
  let tree!: TestRenderer.ReactTestRenderer;
  act(() => {
    tree = TestRenderer.create(<LiveClip clip={clip} />);
  });
  return tree;
}

describe("LiveClip", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    // Past any earlier test's last arrival, so each starts with focus at rest.
    jest.setSystemTime(Date.now() + 60_000);
  });
  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it("plays the clip file at once when focus lands at rest, filling the card", () => {
    const tree = mount();
    const view = tree.root.findByType("LiveClipView" as never);
    expect((view.props as { uri: string }).uri).toBe(clip.uri);
    expect((view.props as { style: object }).style).toMatchObject({ position: "absolute", top: 0, left: 0, right: 0, bottom: 0 });
  });

  it("waits for focus to settle on a card reached mid-scroll", () => {
    const first = mount();
    act(() => jest.advanceTimersByTime(LIVE_CLIP_SCROLL_SETTLE_MS / 5));
    act(() => first.unmount());
    const second = mount();
    expect(second.toJSON()).toBeNull();
    act(() => jest.advanceTimersByTime(LIVE_CLIP_SCROLL_SETTLE_MS - 1));
    expect(second.toJSON()).toBeNull();
    act(() => jest.advanceTimersByTime(1));
    expect(second.root.findByType("LiveClipView" as never)).toBeTruthy();
  });

  it("starts nothing on a card the scroll passes through", () => {
    const first = mount();
    act(() => jest.advanceTimersByTime(LIVE_CLIP_SCROLL_SETTLE_MS / 5));
    act(() => first.unmount());
    const second = mount();
    act(() => jest.advanceTimersByTime(LIVE_CLIP_SCROLL_SETTLE_MS / 5));
    expect(second.toJSON()).toBeNull();
    act(() => second.unmount());
    expect(jest.getTimerCount()).toBe(0);
  });

  it("renders nothing under Reduce Motion", () => {
    jest.spyOn(Reanimated, "useReducedMotion").mockReturnValue(true);
    const tree = mount();
    act(() => jest.advanceTimersByTime(LIVE_CLIP_SCROLL_SETTLE_MS));
    expect(tree.toJSON()).toBeNull();
  });
});
