/** A guide channel card draws no title bar and no name over its picture: the guide row's cells name the channel. */
import React from "react";
import { Image } from "expo-image";
import { StyleSheet, Text } from "react-native";
import TestRenderer, { act } from "react-test-renderer";

jest.mock("@/components/MarqueeText", () => {
  const { Text } = require("react-native");
  return { MarqueeText: ({ children, style }: { children: React.ReactNode; style: object }) => <Text style={style}>{children}</Text> };
});
jest.mock("@/components/live-tv/live-clip", () => ({ LiveClip: () => null }));
jest.mock("@/components/live-tv/live-freshness-badge", () => ({ LiveFreshnessBadge: () => null, LIVE_FRESH_MS: 15_000 }));
let mockPoster: { uri: string } | undefined;
jest.mock("@/hooks/useItemPoster", () => ({ useItemPoster: () => mockPoster }));
jest.mock("@/hooks/useMinuteClock", () => ({ useMinuteClock: () => 0 }));
jest.mock("@/hooks/useNowPlaying", () => ({ useIsNowPlaying: () => false, useNowPlayingVideo: () => ({ active: false, playing: false }), useOpenNowPlaying: () => jest.fn() }));
jest.mock("@/hooks/useCardNavProgress", () => ({ useCardNavProgress: () => ({ navigating: false, visible: false, startNavProgress: jest.fn(), resetNavProgress: jest.fn() }) }));
jest.mock("@/services/itemArtwork", () => ({ showsChannelLogo: () => false }));
let mockStandReel: { frames: { uri: string }[]; at: number } | undefined;
jest.mock("@/services/liveFrames", () => ({
  LIVE_FRAME_TRANSITION_MS: 0,
  LIVE_FRAME_REFRESH_MS: 120_000,
  liveFrameReel: () => mockStandReel,
  liveFrameDueAt: () => undefined,
  subscribeLiveFrame: () => () => undefined,
}));
jest.mock("@/services/jellyfinApi", () => ({ isAudioItem: () => false, isBook: () => false }));

import { CardBadge } from "@/components/card-badge";
import { CardCornerNotch } from "@/components/card-corner-notch";
import { standRedOpacity } from "@/components/card-stand";
import { VideoGridItem } from "@/components/video-grid-item";
import { DESIGN } from "@/constants/app";
import { COLORS } from "@/constants/colors";
import { cardPalette } from "@/services/cardTheme";
import type { JellyfinVideoItem } from "@/types/jellyfin";

const channel = { Id: "c1", Name: "Channel One", Type: "TvChannel" } as JellyfinVideoItem;
const frame = { uri: "file:///pool/c1/live-1-11.jpg", cacheKey: "live-c1-1-11" };

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

  it("draws neither the name nor the heart over its live picture", () => {
    const { badges, names } = render({ liveCard: true, liveFrame: frame });
    expect(badges).toEqual([]);
    expect(names).toBe(0);
  });

  it("draws no logo over its live picture", () => {
    mockPoster = { uri: "https://server/logo.png" };
    const { badges, images } = render({ liveCard: true, liveFrame: frame });
    expect(badges).toEqual([]);
    expect(images).toBe(1);
  });

  it("keeps the logo as the placeholder until a picture arrives", () => {
    mockPoster = { uri: "https://server/logo.png" };
    expect(render({ liveCard: true }).images).toBe(1);
  });

  it("keeps the name in the line under the card on cards that are not guide channel cards", () => {
    expect(render({ liveFrame: frame }).names).toBe(1);
  });

  it("marks a channel card with no picture NOW for its airing programme, leaving LIVE to live pictures", () => {
    const airing = { ...channel, CurrentProgram: { Name: "Evening News" } } as JellyfinVideoItem;
    let tree!: TestRenderer.ReactTestRenderer;
    act(() => {
      tree = TestRenderer.create(<VideoGridItem video={airing} onPress={jest.fn()} index={0} slotOrientation="landscape" />);
    });
    expect(tree.root.findByType(CardCornerNotch).props).toMatchObject({ segments: [{ label: "NOW" }], tone: "live" });
    expect(tree.root.findAllByType(CardBadge)).toHaveLength(0);
    act(() => tree.unmount());
  });

  it("marks an offline guide channel card with the cloud glyph and no Offline word, and tells screen readers it is offline", () => {
    let tree!: TestRenderer.ReactTestRenderer;
    act(() => {
      tree = TestRenderer.create(<VideoGridItem video={channel} onPress={jest.fn()} index={0} slotOrientation="landscape" liveCard offline />);
    });
    expect(tree.root.findAllByType(CardBadge).map((b) => b.props.segments)).toEqual([[{ icon: "cloud-offline" }]]);
    expect(tree.root.findAllByType(Text).filter((n) => n.props.children === "Offline")).toHaveLength(0);
    const card = tree.root.findAll((n) => n.props.accessibilityRole === "button" && typeof n.type === "string")[0];
    expect(card.props.accessibilityValue).toEqual({ text: "Offline" });
    act(() => tree.unmount());
  });
});

describe("channel wall stand", () => {
  const mountCard = (props: Partial<React.ComponentProps<typeof VideoGridItem>>) => {
    let tree!: TestRenderer.ReactTestRenderer;
    act(() => {
      tree = TestRenderer.create(<VideoGridItem video={channel} onPress={jest.fn()} index={0} liveCard liveFrame={frame} titleIcon="heart" hideAiring {...props} />);
    });
    return tree;
  };
  const standOf = (tree: TestRenderer.ReactTestRenderer) => tree.root.findAll((n) => n.props.testID === "card-stand" && typeof n.type === "string")[0];

  it("names the channel under the card, after the heart, only on a card asked for a stand", () => {
    const tree = mountCard({ stand: true });
    const stand = standOf(tree);
    expect(stand.findAllByType(Text).map((n) => n.props.children)).toContain("Channel One");
    expect(stand.findAll((n) => n.props.name === "heart").length).toBeGreaterThan(0);
    act(() => tree.unmount());
    const plain = mountCard({});
    expect(standOf(plain)).toBeUndefined();
    act(() => plain.unmount());
  });

  it("rests dark with a gold name and turns gold with dark ink on focus, at the same height", () => {
    const tree = mountCard({ stand: true });
    const style = () => StyleSheet.flatten(standOf(tree).props.style);
    const nameColor = () => {
      const name = standOf(tree)
        .findAllByType(Text)
        .find((n) => n.props.children === "Channel One");
      return StyleSheet.flatten(name?.props.style).color;
    };
    const resting = style();
    expect(resting.backgroundColor).toBe(COLORS.SURFACE);
    expect(nameColor()).toBe(COLORS.ACCENT);
    act(() => tree.update(<VideoGridItem video={channel} onPress={jest.fn()} index={0} liveCard liveFrame={frame} titleIcon="heart" hideAiring stand highlighted />));
    expect(style().backgroundColor).toBe(COLORS.ACCENT);
    expect(nameColor()).toBe(cardPalette(COLORS.ACCENT).ink);
    expect(style().height).toBe(resting.height);
    act(() => tree.unmount());
  });

  it("wears the channel mark in the picture's corner, never on the stand, and no Offline pill over the grey stand", () => {
    const recording = mountCard({ stand: true, recording: true });
    expect(standOf(recording).findAllByType(CardBadge)).toHaveLength(0);
    expect(recording.root.findAllByType(CardBadge).map((b) => b.props.segments)).toEqual([[{ label: "REC" }]]);
    act(() => recording.unmount());
    const offline = mountCard({ stand: true, offline: true, liveFrame: undefined });
    expect(offline.root.findAllByType(CardBadge)).toHaveLength(0);
    act(() => offline.unmount());
  });

  it("paints a fresh picture's stand red under a white name, gold from LIVE's end, and drops the red on focus", () => {
    jest.useFakeTimers();
    jest.setSystemTime(1_000_000);
    mockStandReel = { frames: [{ uri: "a" }], at: 1_000_000 };
    try {
      const tree = mountCard({ stand: true });
      const nameColor = () => {
        const name = standOf(tree)
          .findAllByType(Text)
          .find((n) => n.props.children === "Channel One");
        return StyleSheet.flatten(name?.props.style).color;
      };
      const red = () => tree.root.findAll((n) => n.props.testID === "card-stand-red" && typeof n.type === "string");
      expect(red()).toHaveLength(1);
      expect(nameColor()).toBe(COLORS.TEXT_PRIMARY);
      act(() => {
        jest.advanceTimersByTime(15_000);
      });
      expect(nameColor()).toBe(COLORS.ACCENT);
      act(() => tree.update(<VideoGridItem video={channel} onPress={jest.fn()} index={0} liveCard liveFrame={frame} titleIcon="heart" hideAiring stand highlighted />));
      expect(red()).toHaveLength(0);
      act(() => tree.unmount());
    } finally {
      mockStandReel = undefined;
      jest.useRealTimers();
    }
  });

  it("steps the red from full while LIVE down to none, and shows none without a picture", () => {
    expect(standRedOpacity(-1)).toBe(0);
    expect(standRedOpacity(0)).toBe(1);
    expect(standRedOpacity(1)).toBeGreaterThan(standRedOpacity(5));
    expect(standRedOpacity(9)).toBe(0);
  });

  it("marks an offline channel with a glyph before its name, in the stand's own colours", () => {
    const tree = mountCard({ stand: true, offline: true, liveFrame: undefined });
    const glyph = tree.root.findAll((n) => n.props.testID === "card-stand-offline" && n.props.name === "cloud-offline");
    expect(glyph.length).toBeGreaterThan(0);
    expect(StyleSheet.flatten(standOf(tree).props.style).backgroundColor).toBe(COLORS.SURFACE);
    act(() => tree.unmount());
    const online = mountCard({ stand: true });
    expect(online.root.findAll((n) => n.props.testID === "card-stand-offline")).toHaveLength(0);
    act(() => online.unmount());
  });

  it("sits flush under a full 16:9 picture whose bottom corners go square, inside the card", () => {
    const tree = mountCard({ stand: true });
    const slot = tree.root.findAll((n) => typeof n.type === "string" && StyleSheet.flatten(n.props.style)?.aspectRatio !== undefined)[0];
    const slotStyle = StyleSheet.flatten(slot.props.style);
    expect(slotStyle).toMatchObject({ aspectRatio: 16 / 9, borderBottomLeftRadius: 0, borderBottomRightRadius: 0 });
    expect(slot.findAll((n) => n.props.testID === "card-stand")).toHaveLength(0);
    // The card is the host wearing the shadow: the glow wraps the picture and the stand together.
    const card = tree.root.findAll((n) => typeof n.type === "string" && StyleSheet.flatten(n.props.style)?.shadowRadius !== undefined)[0];
    expect(card.findAll((n) => n.props.testID === "card-stand" && typeof n.type === "string")).toHaveLength(1);
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
    return { tree, images };
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

  it("fills the card with the live picture cropped to it: one image, no blurred copy, no load handler", () => {
    const { tree, images } = mount("p2");
    expect(images()).toHaveLength(1);
    const [picture] = images();
    expect(StyleSheet.flatten(picture.props.style)).toMatchObject({ width: "100%", height: "100%" });
    expect(picture.props.contentFit).toBe("cover");
    expect(picture.props.blurRadius).toBeUndefined();
    expect(picture.props.onLoad).toBeUndefined();
    act(() => tree.unmount());
  });
});
