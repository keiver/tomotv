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

import { CardBadge } from "@/components/card-badge";
import { CardNavProgress } from "@/components/card-nav-progress";
import { CardPressBurst, CardPressFlash } from "@/components/card-press-burst";
import { CardStand, STAND_NAME_TEXT, standFillPercent } from "@/components/card-stand";
import { Image } from "expo-image";
import { STAND_HEIGHT } from "@/constants/app";
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

  it("bursts the border and flashes the art on a card without a stand, and draws no sweep", () => {
    const tree = mount(<VideoGridItem video={movie} onPress={jest.fn()} index={0} />);
    expect(tree.root.findAllByType(CardNavProgress)).toHaveLength(0);
    expect(tree.root.findAllByType(CardPressBurst)).toHaveLength(1);
    expect(slotOf(tree).findAllByType(CardPressFlash)).toHaveLength(1);
    act(() => tree.unmount());
  });
});

describe("media card base", () => {
  it("sits under the full slot of art, whose bottom corners go square, and names the card", () => {
    const tree = mount(<VideoGridItem video={movie} onPress={jest.fn()} index={0} />);
    const [poster] = slotOf(tree).findAllByType(Image);
    expect(StyleSheet.flatten(poster.props.style)).toMatchObject({ width: "100%", height: "100%" });
    expect(StyleSheet.flatten(slotOf(tree).props.style)).toMatchObject({ borderBottomLeftRadius: 0, borderBottomRightRadius: 0 });
    expect(slotOf(tree).findAllByType(CardStand)).toHaveLength(0);
    const [stand] = tree.root.findAllByType(CardStand);
    expect(stand.props).toMatchObject({ name: "A Movie", scrolls: true, progress: null });
    act(() => tree.unmount());
  });

  it("draws the focus border around the art and the base together, round at the bottom too", () => {
    const tree = mount(<VideoGridItem video={movie} onPress={jest.fn()} index={0} highlighted />);
    const burst = tree.root.findByType(CardPressBurst);
    const rings = tree.root.findAll((n) => typeof n.type === "string" && StyleSheet.flatten(n.props.style)?.borderWidth > 1 && burst.findAll((b) => b === n).length === 0);
    expect(rings).toHaveLength(1);
    expect(slotOf(tree).findAll((n) => n === rings[0])).toHaveLength(0);
    const ring = StyleSheet.flatten(rings[0].props.style);
    expect(ring).toMatchObject({ position: "absolute", top: 0, bottom: 0 });
    expect(ring.borderBottomLeftRadius).toBeUndefined();
    let card = rings[0].parent!;
    while (typeof card.type !== "string") card = card.parent!;
    expect(card.findAllByType(CardStand)).toHaveLength(1);
    act(() => tree.unmount());
  });

  it("fills with a resume card's progress instead of drawing on the art", () => {
    const tree = mount(<VideoGridItem video={movie} onPress={jest.fn()} index={0} progressPercent={0.4} />);
    expect(tree.root.findByType(CardStand).props.progress).toBe(0.4);
    const fill = tree.root.findAll((n) => n.props.testID === "card-stand-fill" && typeof n.type === "string")[0];
    expect(StyleSheet.flatten(fill.props.style).width).toBe("40%");
    act(() => tree.unmount());
  });

  it("names the item and nothing else: no episode number, eye or heart", () => {
    const episode = { Id: "e1", Name: "Pilot", Type: "Episode", IndexNumber: 5, ParentIndexNumber: 1, UserData: { Played: true, IsFavorite: true } } as JellyfinVideoItem;
    const tree = mount(<VideoGridItem video={episode} onPress={jest.fn()} index={0} />);
    expect(tree.root.findAllByType(CardBadge)).toHaveLength(0);
    expect(tree.root.findByType(CardStand).props.name).toBe("Pilot");
    expect(tree.root.findAll((n) => n.props.name === "eye" || n.props.name === "heart")).toHaveLength(0);
    act(() => tree.unmount());
  });

  it("floors a just-started fill at 5% and caps at the whole base", () => {
    expect(standFillPercent(0)).toBe(5);
    expect(standFillPercent(0.42)).toBe(42);
    expect(standFillPercent(2)).toBe(100);
  });
});
