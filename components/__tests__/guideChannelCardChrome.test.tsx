/** A guide channel card draws no title bar over its picture: the name is a corner pill led by the favorite heart. */
import React from "react";
import { Image } from "expo-image";
import { StyleSheet, Text } from "react-native";
import TestRenderer, { act } from "react-test-renderer";

jest.mock("@/components/MarqueeText", () => {
  const { Text } = require("react-native");
  return { MarqueeText: ({ children, style }: { children: React.ReactNode; style: object }) => <Text style={style}>{children}</Text> };
});
jest.mock("@/components/live-tv/live-clip", () => ({ LiveClip: () => null }));
jest.mock("@/components/live-tv/live-freshness-badge", () => ({ LiveFreshnessBadge: () => null }));
let mockPoster: { uri: string } | undefined;
jest.mock("@/hooks/useItemPoster", () => ({ useItemPoster: () => mockPoster }));
jest.mock("@/hooks/useMinuteClock", () => ({ useMinuteClock: () => 0 }));
jest.mock("@/hooks/useNowPlaying", () => ({ useIsNowPlaying: () => false, useNowPlayingVideo: () => ({ active: false, playing: false }), useOpenNowPlaying: () => jest.fn() }));
jest.mock("@/hooks/useCardNavProgress", () => ({ useCardNavProgress: () => ({ navigating: false, visible: false, startNavProgress: jest.fn(), resetNavProgress: jest.fn() }) }));
jest.mock("@/services/itemArtwork", () => ({ showsChannelLogo: () => false }));
jest.mock("@/services/liveFrames", () => ({ LIVE_FRAME_TRANSITION_MS: 0 }));
jest.mock("@/services/jellyfinApi", () => ({ isAudioItem: () => false, isBook: () => false }));

import { CardBadge } from "@/components/card-badge";
import { VideoGridItem } from "@/components/video-grid-item";
import { GlassSurface } from "@/components/glass-surface";
import { DESIGN } from "@/constants/app";
import { COLORS } from "@/constants/colors";
import { cardPalette } from "@/services/cardTheme";
import type { JellyfinVideoItem } from "@/types/jellyfin";

const channel = { Id: "c1", Name: "Channel One", Type: "TvChannel" } as JellyfinVideoItem;
const frame = { uri: "file:///pool/c1/live-1-11.jpg", cacheKey: "live-c1-1-11" };
const NAME_PILL = [{ icon: "heart", label: "Channel One" }];

function render(props: Partial<React.ComponentProps<typeof VideoGridItem>>) {
  let tree!: TestRenderer.ReactTestRenderer;
  act(() => {
    tree = TestRenderer.create(<VideoGridItem video={channel} onPress={jest.fn()} index={0} slotOrientation="landscape" titleIcon="heart" hideAiring {...props} />);
  });
  const badges = tree.root.findAllByType(CardBadge).map((b) => b.props.segments);
  const names = tree.root.findAllByType(Text).filter((n) => n.props.children === "Channel One").length;
  const images = tree.root.findAllByType(Image).length;
  act(() => tree.unmount());
  return { badges, names, images };
}

describe("guide channel card without a title bar", () => {
  afterEach(() => {
    mockPoster = undefined;
  });

  it("leads the name pill with the heart and draws no heart in the left corner", () => {
    const { badges } = render({ liveCard: true, liveFrame: frame });
    expect(badges).toEqual([NAME_PILL]);
    expect(render({ liveCard: true, liveFrame: frame, titleIcon: undefined }).badges).toEqual([[{ icon: undefined, label: "Channel One" }]]);
  });

  it("names a channel with a logo too, and draws no logo over its live picture", () => {
    mockPoster = { uri: "https://server/logo.png" };
    const { badges, images } = render({ liveCard: true, liveFrame: frame });
    expect(badges).toContainEqual(NAME_PILL);
    expect(images).toBe(1);
  });

  it("keeps the logo as the placeholder until a picture arrives, with the name over it", () => {
    mockPoster = { uri: "https://server/logo.png" };
    const { badges, images } = render({ liveCard: true });
    expect(badges).toContainEqual(NAME_PILL);
    expect(images).toBe(1);
  });

  it("writes the name only in the pill, while other cards keep it in the title bar", () => {
    expect(render({ liveCard: true, liveFrame: frame }).names).toBe(1);
    mockPoster = { uri: "https://server/logo.png" };
    expect(render({ liveCard: true, liveFrame: frame }).names).toBe(1);
    const barred = render({ liveFrame: frame });
    expect(barred.badges).not.toContainEqual(NAME_PILL);
    expect(barred.names).toBe(1);
  });
});

describe("guide channel card name pill on focus", () => {
  it("turns solid accent with the palette's ink, while other focused badges stay glass", () => {
    let tree!: TestRenderer.ReactTestRenderer;
    act(() => {
      tree = TestRenderer.create(<VideoGridItem video={channel} onPress={jest.fn()} index={0} liveCard liveFrame={frame} titleIcon="heart" hideAiring highlighted />);
    });
    const pill = tree.root.findAllByType(CardBadge)[0];
    const fill = pill.findAll((n) => typeof n.type === "string" && StyleSheet.flatten(n.props.style)?.backgroundColor === COLORS.ACCENT);
    expect(fill.length).toBeGreaterThan(0);
    const name = pill.findAllByType(Text).find((n) => n.props.children === "Channel One");
    expect(StyleSheet.flatten(name?.props.style).color).toBe(cardPalette(COLORS.ACCENT).ink);
    act(() => tree.unmount());
    act(() => {
      tree = TestRenderer.create(<CardBadge segments={[{ label: "S01E05" }]} focused />);
    });
    expect(tree.root.findAllByType(GlassSurface)).toHaveLength(1);
    act(() => tree.unmount());
  });
});

describe("guide channel card picture", () => {
  const mount = (id: string) => {
    let tree!: TestRenderer.ReactTestRenderer;
    act(() => {
      tree = TestRenderer.create(<VideoGridItem video={{ ...channel, Id: id }} onPress={jest.fn()} index={0} slotOrientation="landscape" liveCard liveFrame={frame} />);
    });
    const images = () => tree.root.findAllByType(Image);
    const load = (width: number, height: number) => act(() => images().at(-1)?.props.onLoad({ source: { width, height } }));
    return { tree, images, load };
  };

  it("sits in a rounded 16:9 slot on the wall and a square one in the guide", () => {
    const slotStyle = (square: boolean) => {
      let tree!: TestRenderer.ReactTestRenderer;
      act(() => {
        tree = TestRenderer.create(<VideoGridItem video={channel} onPress={jest.fn()} index={0} liveCard square={square} liveFrame={frame} />);
      });
      const slot = tree.root.findAll((n) => typeof n.type === "string" && StyleSheet.flatten(n.props.style)?.aspectRatio !== undefined)[0];
      const style = StyleSheet.flatten(slot.props.style);
      act(() => tree.unmount());
      return style;
    };
    expect(slotStyle(false)).toMatchObject({ aspectRatio: 16 / 9, borderRadius: DESIGN.BORDER_RADIUS_CARD });
    expect(slotStyle(true)).toMatchObject({ aspectRatio: 16 / 9, borderRadius: 0 });
  });

  it("fills the card with a 16:9 picture", () => {
    const { tree, images, load } = mount("p2");
    load(1280, 720);
    expect(images()).toHaveLength(1);
    expect(StyleSheet.flatten(images()[0].props.style)).toMatchObject({ width: "100%", height: "100%" });
    act(() => tree.unmount());
  });

  it("shows a 4:3 picture whole over a blurred copy of itself, and a remount starts that way", () => {
    const { tree, images, load } = mount("p3");
    load(640, 480);
    const [backdrop, picture] = images();
    expect(backdrop.props.blurRadius).toBeGreaterThan(0);
    expect(StyleSheet.flatten(picture.props.style)).toMatchObject({ position: "absolute", left: "12.5%", width: "75%", height: "100%" });
    act(() => tree.unmount());
    const again = mount("p3");
    expect(again.images()).toHaveLength(2);
    act(() => again.tree.unmount());
  });
});
