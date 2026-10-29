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
import { t } from "@/services/i18n";
import { CardNavProgress } from "@/components/card-nav-progress";
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

  it("fills a media card's base under the picture, starting a resume card at its watched share", () => {
    const tree = mount(<VideoGridItem video={movie} onPress={jest.fn()} index={0} progressPercent={0.4} />);
    expect(slotOf(tree).findAllByType(CardNavProgress)).toHaveLength(0);
    const [sweep] = tree.root.findAllByType(CardNavProgress);
    expect(sweep.props).toMatchObject({ stand: true, title: "A Movie", startFraction: 0.4 });
    expect(sweep.parent!.findAllByType(CardStand)).toHaveLength(1);
    act(() => tree.unmount());
  });

  it("draws no ring or tint over a pressed media card", () => {
    const tree = mount(<VideoGridItem video={movie} onPress={jest.fn()} index={0} />);
    expect(tree.root.findAll((n) => typeof n.props.testID === "string" && n.props.testID.startsWith("card-press"))).toHaveLength(0);
    expect(tree.root.findByType(CardNavProgress).props.startFraction).toBeUndefined();
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
    const rings = tree.root.findAll((n) => typeof n.type === "string" && StyleSheet.flatten(n.props.style)?.borderWidth > 1);
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

  it("fills the whole base of a watched card with no resume position", () => {
    const watched = { Id: "e2", Name: "Finale", Type: "Episode", UserData: { Played: true } } as JellyfinVideoItem;
    const tree = mount(<VideoGridItem video={watched} onPress={jest.fn()} index={0} />);
    expect(tree.root.findByType(CardStand).props.progress).toBe(1);
    const fill = tree.root.findAll((n) => n.props.testID === "card-stand-fill" && typeof n.type === "string")[0];
    expect(StyleSheet.flatten(fill.props.style).width).toBe("100%");
    act(() => tree.unmount());
  });

  it("leaves the base empty on a watched track or an unwatched card", () => {
    const track = { Id: "t1", Name: "Song", Type: "Audio", UserData: { Played: true } } as JellyfinVideoItem;
    for (const video of [track, movie]) {
      const tree = mount(<VideoGridItem video={video} onPress={jest.fn()} index={0} />);
      expect(tree.root.findByType(CardStand).props.progress).toBeNull();
      act(() => tree.unmount());
    }
  });

  it("wears the episode number on a pill over the picture and the favorite heart before the name, never an eye", () => {
    const episode = { Id: "e1", Name: "Pilot", Type: "Episode", IndexNumber: 5, ParentIndexNumber: 1, UserData: { Played: true, IsFavorite: true } } as JellyfinVideoItem;
    const tree = mount(<VideoGridItem video={episode} onPress={jest.fn()} index={0} />);
    expect(tree.root.findAllByType(CardBadge)).toHaveLength(1);
    expect(slotOf(tree).findByType(CardBadge).props).toMatchObject({ segments: [{ label: "S01E05" }], tone: "gold" });
    expect(tree.root.findByType(CardStand).props.name).toBe("Pilot");
    expect(tree.root.findByType(CardStand).findAll((n) => n.props.name === "heart")).not.toHaveLength(0);
    expect(tree.root.findAll((n) => n.props.name === "eye")).toHaveLength(0);
    act(() => tree.unmount());
  });

  it("puts a programme's NOW on a pill over the picture in the live red", () => {
    const now = Date.now();
    const program = { Id: "p1", Name: "News", Type: "Program", StartDate: new Date(now - 60_000).toISOString(), EndDate: new Date(now + 60_000).toISOString() } as JellyfinVideoItem;
    const tree = mount(<VideoGridItem video={program} onPress={jest.fn()} index={0} />);
    expect(slotOf(tree).findByType(CardBadge).props).toMatchObject({ segments: [{ label: t("liveTv.now") }], tone: "live" });
    act(() => tree.unmount());
  });

  it("puts a shelf channel card's NOW on a pill over the picture in the live red", () => {
    const airing = { ...channel, CurrentProgram: { Name: "News" } } as JellyfinVideoItem;
    const tree = mount(<VideoGridItem video={airing} onPress={jest.fn()} index={0} titleIcon="heart" />);
    expect(slotOf(tree).findByType(CardBadge).props).toMatchObject({ segments: [{ label: t("liveTv.now") }], tone: "live" });
    act(() => tree.unmount());
  });

  it("shows a passed channel heart before the name on a shelf channel card", () => {
    const tree = mount(<VideoGridItem video={channel} onPress={jest.fn()} index={0} titleIcon="heart" />);
    expect(tree.root.findByType(CardStand).findAll((n) => n.props.name === "heart")).not.toHaveLength(0);
    expect(tree.root.findByType(CardBadge).props).toMatchObject({ segments: [{ label: t("liveTv.channel") }], tone: "gold" });
    act(() => tree.unmount());
  });

  it("names a channel card by the channel and shows its number on a pill when the airing programme is hidden", () => {
    const airing = { ...channel, ChannelNumber: "7", CurrentProgram: { Name: "News" } } as JellyfinVideoItem;
    const tree = mount(<VideoGridItem video={airing} onPress={jest.fn()} index={0} hideAiring />);
    expect(tree.root.findByType(CardBadge).props).toMatchObject({ segments: [{ label: t("liveTv.channelNumber").replace("{number}", "7") }], tone: "gold" });
    expect(tree.root.findByType(CardStand).props.name).toBe("Channel One");
    act(() => tree.unmount());
  });

  it("keeps NOW on a channel card titled by its airing programme", () => {
    const airing = { ...channel, ChannelNumber: "7", CurrentProgram: { Name: "News" } } as JellyfinVideoItem;
    const tree = mount(<VideoGridItem video={airing} onPress={jest.fn()} index={0} />);
    expect(tree.root.findByType(CardBadge).props).toMatchObject({ segments: [{ label: t("liveTv.now") }], tone: "live" });
    expect(tree.root.findByType(CardStand).props.name).toBe("News");
    act(() => tree.unmount());
  });

  it("leads with a passed icon over the heart", () => {
    const tree = mount(<VideoGridItem video={movie} onPress={jest.fn()} index={0} titleIcon="videocam-outline" />);
    const stand = tree.root.findByType(CardStand);
    expect(stand.findAll((n) => n.props.name === "videocam-outline")).not.toHaveLength(0);
    expect(stand.findAll((n) => n.props.name === "heart")).toHaveLength(0);
    act(() => tree.unmount());
  });

  it("floors a just-started fill at 5% and caps at the whole base", () => {
    expect(standFillPercent(0)).toBe(5);
    expect(standFillPercent(0.42)).toBe(42);
    expect(standFillPercent(2)).toBe(100);
  });
});
