import React from "react";
import { StyleSheet, Text } from "react-native";
import TestRenderer, { act } from "react-test-renderer";

jest.mock("@/components/live-tv/live-clip", () => ({ LiveClip: () => null }));
jest.mock("@/components/live-tv/live-freshness-badge", () => ({ LiveFreshnessBadge: () => null, LIVE_FRESH_MS: 15_000 }));
jest.mock("@/hooks/useItemPoster", () => ({ useItemPoster: () => ({ uri: "https://server/poster.jpg" }) }));
jest.mock("@/hooks/useMinuteClock", () => ({ useMinuteClock: () => 0 }));
jest.mock("@/hooks/useNowPlaying", () => ({ useIsNowPlaying: () => false, useNowPlayingVideo: () => ({ active: false, playing: false }), useOpenNowPlaying: () => jest.fn() }));
jest.mock("@/hooks/useCardNavProgress", () => ({ useCardNavProgress: () => ({ navigating: true, visible: true, startNavProgress: jest.fn(), resetNavProgress: jest.fn() }) }));
jest.mock("@/services/itemArtwork", () => ({ showsChannelLogo: () => false }));
jest.mock("@/services/liveFrames", () => ({
  LIVE_FRAME_TRANSITION_MS: 0,
  LIVE_FRAME_REFRESH_MS: 120_000,
  liveFrameReel: () => undefined,
  liveFrameDueAt: () => undefined,
  subscribeLiveFrame: () => () => undefined,
}));
jest.mock("@/services/jellyfinApi", () => ({ isAudioItem: () => false, isBook: () => false }));

import { CardArtClip } from "@/components/card-art-clip";
import { CardNavProgress } from "@/components/card-nav-progress";
import { DESIGN } from "@/constants/app";
import { Image } from "expo-image";
import { STAND_HEIGHT, STAND_NAME_TEXT } from "@/components/live-tv/channel-stand";
import { VideoGridItem } from "@/components/video-grid-item";
import type { JellyfinVideoItem } from "@/types/jellyfin";

const channel = { Id: "c1", Name: "Channel One", Type: "TvChannel" } as JellyfinVideoItem;
const movie = { Id: "m1", Name: "A Movie", Type: "Movie", UserData: { IsFavorite: true } } as JellyfinVideoItem;
const frame = { uri: "file:///pool/c1/live-1-11.jpg", cacheKey: "live-c1-1-11" };

function mount(element: React.ReactElement) {
  let tree!: TestRenderer.ReactTestRenderer;
  act(() => {
    tree = TestRenderer.create(element);
  });
  return tree;
}

const slotOf = (tree: TestRenderer.ReactTestRenderer) => tree.root.findAll((n) => typeof n.type === "string" && StyleSheet.flatten(n.props.style)?.aspectRatio !== undefined)[0];

describe("press sweep on a channel wall card", () => {
  it("fills the stand under the picture, in the stand's lettering, and leaves the picture clear", () => {
    const tree = mount(<VideoGridItem video={channel} onPress={jest.fn()} index={0} liveCard liveFrame={frame} hideAiring stand />);
    expect(slotOf(tree).findAllByType(CardNavProgress)).toHaveLength(0);
    const [sweep] = tree.root.findAllByType(CardNavProgress);
    expect(sweep.props.stand).toBe(true);
    const bar = sweep.findAll((n) => typeof n.type === "string" && n.props.pointerEvents === "none")[0];
    expect(StyleSheet.flatten(bar.props.style)).toMatchObject({ top: 0, bottom: 0, paddingVertical: 0 });
    const title = sweep.findAllByType(Text).find((n) => n.props.children === "Channel One");
    expect(StyleSheet.flatten(title?.props.style)).toMatchObject({ fontSize: STAND_NAME_TEXT.fontSize, letterSpacing: STAND_NAME_TEXT.letterSpacing });
    expect(STAND_HEIGHT).toBeGreaterThan(0);
    act(() => tree.unmount());
  });

  it("stays in the title bar on a card without a stand", () => {
    const tree = mount(<VideoGridItem video={movie} onPress={jest.fn()} index={0} />);
    const sweeps = slotOf(tree).findAllByType(CardNavProgress);
    expect(sweeps).toHaveLength(1);
    expect(sweeps[0].props.stand).toBeFalsy();
    act(() => tree.unmount());
  });
});

describe("poster under the title bar", () => {
  it("ends above the card's rounded foot at its full slot size, and a live picture keeps the whole slot", () => {
    const tree = mount(<VideoGridItem video={movie} onPress={jest.fn()} index={0} />);
    const [clip] = tree.root.findAllByType(CardArtClip);
    expect(clip.props.ratio).toBe(StyleSheet.flatten(slotOf(tree).props.style).aspectRatio);
    expect(clip.findAllByType(Image)).toHaveLength(1);
    const clipBox = clip.findAll((n) => typeof n.type === "string" && StyleSheet.flatten(n.props.style)?.overflow === "hidden")[0];
    expect(StyleSheet.flatten(clipBox.props.style)).toMatchObject({ position: "absolute", top: 0, bottom: DESIGN.BORDER_RADIUS_CARD });
    act(() => tree.unmount());
    const live = mount(<VideoGridItem video={channel} onPress={jest.fn()} index={0} liveCard liveFrame={frame} hideAiring stand />);
    expect(live.root.findAllByType(CardArtClip)).toHaveLength(0);
    act(() => live.unmount());
  });
});

describe("favorite heart on a media card", () => {
  it("sits inline before the name, in the name's colour and size", () => {
    const tree = mount(<VideoGridItem video={movie} onPress={jest.fn()} index={0} />);
    const slot = slotOf(tree);
    const title = slot.findAllByType(Text).find((n) => React.Children.toArray(n.props.children).includes("A Movie") && n.props.numberOfLines === 1);
    const style = StyleSheet.flatten(title?.props.style);
    const heart = title?.findAll((n) => n.props.name === "heart")[0];
    expect(heart?.props.color).toBe(style.color);
    expect(heart?.props.size).toBe(style.fontSize);
    act(() => tree.unmount());
  });
});
