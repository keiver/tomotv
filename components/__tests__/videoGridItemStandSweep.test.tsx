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
import { CardMetaLine } from "@/components/card-meta-line";
import { CardNavProgress } from "@/components/card-nav-progress";
import { CardPressBurst, CardPressFlash } from "@/components/card-press-burst";
import { CardProgressStrip, progressStripPercent } from "@/components/card-progress-strip";
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

  it("bursts the border and flashes the art on a card without a stand, and draws no sweep", () => {
    const tree = mount(<VideoGridItem video={movie} onPress={jest.fn()} index={0} />);
    expect(tree.root.findAllByType(CardNavProgress)).toHaveLength(0);
    expect(tree.root.findAllByType(CardPressBurst)).toHaveLength(1);
    expect(slotOf(tree).findAllByType(CardPressFlash)).toHaveLength(1);
    act(() => tree.unmount());
  });
});

describe("media card art", () => {
  it("fills the whole slot, with no title bar over it and the name in the line under the card", () => {
    const tree = mount(<VideoGridItem video={movie} onPress={jest.fn()} index={0} />);
    const [poster] = slotOf(tree).findAllByType(Image);
    expect(StyleSheet.flatten(poster.props.style)).toMatchObject({ width: "100%", height: "100%" });
    expect(slotOf(tree).findAllByType(CardMetaLine)).toHaveLength(0);
    expect(tree.root.findByType(CardMetaLine).props.text).toBe("A Movie");
    act(() => tree.unmount());
  });

  it("puts a live card's name nowhere but its stand", () => {
    const live = mount(<VideoGridItem video={channel} onPress={jest.fn()} index={0} liveCard liveFrame={frame} hideAiring stand />);
    expect(live.root.findAllByType(CardMetaLine)).toHaveLength(0);
    act(() => live.unmount());
  });

  it("shows a resume card's progress as a strip inside the art", () => {
    const tree = mount(<VideoGridItem video={movie} onPress={jest.fn()} index={0} progressPercent={0.4} />);
    const strip = slotOf(tree).findAllByType(CardProgressStrip);
    expect(strip).toHaveLength(1);
    expect(strip[0].props.fraction).toBe(0.4);
    act(() => tree.unmount());
  });
});

describe("index numbers", () => {
  const episode = { Id: "e1", Name: "Pilot", Type: "Episode", IndexNumber: 5, ParentIndexNumber: 1 } as JellyfinVideoItem;

  it("leave the art for the line under the card, in front of the name on phone", () => {
    const tree = mount(<VideoGridItem video={episode} onPress={jest.fn()} index={0} />);
    expect(tree.root.findAllByType(CardBadge)).toHaveLength(0);
    const line = tree.root.findAll((n) => n.props.testID === "card-meta-line" && typeof n.type === "string")[0];
    const text = (node: TestRenderer.ReactTestInstance | string): string => (typeof node === "string" ? node : node.children.map(text).join(""));
    expect(text(line)).toContain("S01E05 · Pilot");
    act(() => tree.unmount());
  });
});

describe("progress strip", () => {
  it("floors a just-started item at 5% and caps at the whole bar", () => {
    expect(progressStripPercent(0)).toBe(5);
    expect(progressStripPercent(0.42)).toBe(42);
    expect(progressStripPercent(2)).toBe(100);
  });
});

describe("favorite heart on a media card", () => {
  it("sits inline before the name, in the name's colour and size", () => {
    const tree = mount(<VideoGridItem video={movie} onPress={jest.fn()} index={0} />);
    const line = tree.root.findByType(CardMetaLine);
    const title = line.findAllByType(Text).find((n) => React.Children.toArray(n.props.children).includes("A Movie") && n.props.numberOfLines === 1);
    const style = StyleSheet.flatten(title?.props.style);
    const heart = title?.findAll((n) => n.props.name === "heart")[0];
    expect(heart?.props.color).toBe(style.color);
    expect(heart?.props.size).toBe(style.fontSize);
    act(() => tree.unmount());
  });
});
