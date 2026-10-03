/** A channel card plays its clip while its guide row holds focus (only its own row), or in view on touch while playback is not holding the link. */
import React from "react";
import TestRenderer, { act } from "react-test-renderer";

const mockClip = { uri: "file:///pool/c1/live-1-clip.mp4", cacheKey: "live-c1-1-clip" };
let mockScreenFocused = true;
jest.mock("expo-router", () => ({ useIsFocused: () => mockScreenFocused }));
jest.mock("@/components/video-grid-item", () => ({
  VideoGridItem: (props: object) => require("react").createElement("VideoGridItem", props),
}));
jest.mock("@/hooks/useLiveFrame", () => ({
  useLiveFrame: () => ({ uri: "file:///pool/c1/live-1-11.jpg", cacheKey: "live-c1-1-11" }),
  useLiveClip: () => mockClip,
}));
jest.mock("@/hooks/useChannelHealth", () => ({ useChannelHealth: () => "up" }));

import { GuideChannelCard } from "@/components/live-tv/guide-channel-card";
import { setFocusedGuideRow } from "@/services/guideChannelFocus";
import { setPlaybackHold } from "@/services/playbackHold";
import type { JellyfinItem } from "@/types/jellyfin";

const channel = { Id: "c1", Name: "One", Type: "TvChannel" } as JellyfinItem;

describe("GuideChannelCard", () => {
  afterEach(() =>
    act(() => {
      setFocusedGuideRow(null);
      setPlaybackHold("video", false);
      mockScreenFocused = true;
    }),
  );

  it("hands the card its clip and turns it on while its own row holds focus", () => {
    let tree!: TestRenderer.ReactTestRenderer;
    act(() => {
      tree = TestRenderer.create(<GuideChannelCard channel={channel} index={0} onPress={() => undefined} />);
    });
    const card = () => tree.root.findByType("VideoGridItem" as never).props as { liveClip?: object; clipActive?: boolean };
    expect(card().liveClip).toBe(mockClip);
    expect(card().clipActive).toBe(false);
    act(() => setFocusedGuideRow("c2"));
    expect(card().clipActive).toBe(false);
    act(() => setFocusedGuideRow("c1"));
    expect(card().clipActive).toBe(true);
    act(() => setFocusedGuideRow(null));
    expect(card().clipActive).toBe(false);
    act(() => tree.unmount());
  });

  it("plays in view on touch, and stops while playback holds the link", () => {
    let tree!: TestRenderer.ReactTestRenderer;
    const render = (playsClipInView: boolean) => <GuideChannelCard channel={channel} index={0} onPress={() => undefined} playsClipInView={playsClipInView} />;
    act(() => {
      tree = TestRenderer.create(render(true));
    });
    const card = () => tree.root.findByType("VideoGridItem" as never).props as { clipActive?: boolean };
    expect(card().clipActive).toBe(true);
    act(() => setPlaybackHold("video", true));
    expect(card().clipActive).toBe(false);
    act(() => setPlaybackHold("video", false));
    expect(card().clipActive).toBe(true);
    act(() => tree.update(render(false)));
    expect(card().clipActive).toBe(false);
    act(() => tree.unmount());
  });

  it("releases the clip offscreen, on blur and during playback even if row focus lingers", () => {
    let tree!: TestRenderer.ReactTestRenderer;
    const render = (inView: boolean) => <GuideChannelCard channel={channel} index={0} onPress={() => undefined} playsClipInView inView={inView} />;
    act(() => {
      setFocusedGuideRow("c1");
      tree = TestRenderer.create(render(true));
    });
    const card = () => tree.root.findByType("VideoGridItem" as never).props;
    expect(card().liveClip).toBe(mockClip);
    act(() => tree.update(render(false)));
    expect(card().liveClip).toBeUndefined();
    expect(card().clipActive).toBe(false);
    mockScreenFocused = false;
    act(() => tree.update(render(true)));
    expect(card().liveClip).toBeUndefined();
    mockScreenFocused = true;
    act(() => {
      setPlaybackHold("video", true);
      tree.update(render(true));
    });
    expect(card().liveClip).toBeUndefined();
    expect(card().clipActive).toBe(false);
    act(() => setPlaybackHold("video", false));
    expect(card().liveClip).toBe(mockClip);
    act(() => tree.unmount());
  });
});
