/** On TV a media card's base and its tab are glass at rest and the accent on focus, and the card's depth sits on a layer behind the art. */
import React from "react";
import { Platform, StyleSheet } from "react-native";
import TestRenderer, { act } from "react-test-renderer";

jest.mock("@/components/glass-surface", () => ({
  GlassSurface: (props: { tintColor?: string; children?: React.ReactNode }) => require("react").createElement("GlassSurface", props, props.children),
}));
jest.mock("@/components/MarqueeText", () => {
  const { Text } = require("react-native");
  return { MarqueeText: ({ children, style }: { children: React.ReactNode; style: object }) => <Text style={style}>{children}</Text> };
});
jest.mock("@/components/live-tv/live-clip", () => ({ LiveClip: () => null }));
jest.mock("@/components/live-tv/live-freshness-badge", () => ({ LiveFreshnessBadge: () => null, LIVE_FRESH_MS: 15_000 }));
jest.mock("@/hooks/useItemPoster", () => ({ useItemPoster: () => ({ uri: "https://server/poster.jpg" }) }));
jest.mock("@/hooks/useMinuteClock", () => ({ useMinuteClock: () => 0 }));
jest.mock("@/hooks/useNowPlaying", () => ({ useIsNowPlaying: () => false, useNowPlayingVideo: () => ({ active: false, playing: false }), useOpenNowPlaying: () => jest.fn() }));
jest.mock("@/hooks/useCardNavProgress", () => ({ useCardNavProgress: () => ({ navigating: false, visible: false, startNavProgress: jest.fn(), resetNavProgress: jest.fn() }) }));
jest.mock("@/services/itemArtwork", () => ({ showsChannelLogo: () => false }));
jest.mock("@/services/liveFrames", () => ({ LIVE_FRAME_TRANSITION_MS: 0, LIVE_FRAME_REFRESH_MS: 120_000, liveFrameReel: () => undefined, subscribeLiveFrame: () => () => undefined }));
jest.mock("@/services/jellyfinApi", () => ({ isAudioItem: () => false, isBook: () => false }));

Object.defineProperty(Platform, "isTV", { value: true, configurable: true });
// Read after the flag: the components fix their platform at import.
const { CardStand } = require("@/components/card-stand") as typeof import("@/components/card-stand");
const { CardCornerTab } = require("@/components/card-corner-tab") as typeof import("@/components/card-corner-tab");
const { VideoGridItem } = require("@/components/video-grid-item") as typeof import("@/components/video-grid-item");
const { STAND_HEIGHT } = require("@/constants/app") as typeof import("@/constants/app");
const { COLORS } = require("@/constants/colors") as typeof import("@/constants/colors");
const { CardPaletteOverride } = require("@/hooks/useCardPalette") as typeof import("@/hooks/useCardPalette");
const { cardPalette } = require("@/services/cardTheme") as typeof import("@/services/cardTheme");

const ACCENT = "#4F99FF";
const palette = cardPalette(ACCENT);
const episode = { Id: "e1", Name: "Pilot", Type: "Episode", IndexNumber: 5, ParentIndexNumber: 1 } as import("@/types/jellyfin").JellyfinVideoItem;

function mount(element: React.ReactElement) {
  let tree!: TestRenderer.ReactTestRenderer;
  act(() => {
    tree = TestRenderer.create(<CardPaletteOverride.Provider value={palette}>{element}</CardPaletteOverride.Provider>);
  });
  return tree;
}

const glass = (tree: TestRenderer.ReactTestRenderer) => tree.root.findAll((n) => (n.type as unknown) === "GlassSurface");

describe("card glass on TV", () => {
  it("a clear base is glass tinted with the card's colour at rest, and the accent with no glass on focus", () => {
    const resting = mount(<CardStand name="Pilot" focused={false} clear surface={COLORS.SURFACE_SUNKEN} />);
    expect(glass(resting)).toHaveLength(1);
    expect(glass(resting)[0].props.tintColor).toContain("rgba");
    act(() => resting.unmount());
    const lit = mount(<CardStand name="Pilot" focused clear />);
    expect(glass(lit)).toHaveLength(0);
    expect(StyleSheet.flatten(lit.root.findByProps({ testID: "card-stand" }).props.style).backgroundColor).toBe(ACCENT);
    act(() => lit.unmount());
  });

  it("on TV the base's name is centred", () => {
    const tree = mount(<CardStand name="Pilot" focused={false} scrolls />);
    const text = tree.root.findAll((n) => typeof n.type === "string" && n.props.children === "Pilot")[0];
    expect(StyleSheet.flatten(text.props.style).textAlign).toBe("center");
    act(() => tree.unmount());
  });

  it("a base that is not clear stays solid", () => {
    const tree = mount(<CardStand name="Channel" focused={false} />);
    expect(glass(tree)).toHaveLength(0);
    act(() => tree.unmount());
  });

  it("the tab is glass at rest and the accent with the ink on focus", () => {
    const resting = mount(<CardCornerTab segments={[{ label: "S01E05" }]} />);
    expect(glass(resting)).toHaveLength(1);
    act(() => resting.unmount());
    const lit = mount(<CardCornerTab segments={[{ label: "S01E05" }]} focused />);
    expect(glass(lit)).toHaveLength(0);
    const tab = lit.root.findAll((n) => n.props.testID === "card-corner-tab" && typeof n.type === "string")[0];
    expect(StyleSheet.flatten(tab.props.style).backgroundColor).toBe(ACCENT);
    expect(StyleSheet.flatten(lit.root.findAll((n) => typeof n.type === "string" && n.props.children === "S01E05")[0].props.style).color).toBe(palette.ink);
    act(() => lit.unmount());
  });

  it("the card has no fill of its own; a depth layer behind the art stops at the base at rest and covers the card on focus", () => {
    const depthLayer = (tree: TestRenderer.ReactTestRenderer) => {
      const tab = tree.root.findByType(CardCornerTab);
      const card = tab.parent!;
      expect(StyleSheet.flatten(card.props.style).backgroundColor).toBeUndefined();
      return StyleSheet.flatten((card.children[0] as TestRenderer.ReactTestInstance).props.style);
    };
    const resting = mount(<VideoGridItem video={episode} onPress={jest.fn()} index={0} />);
    expect(depthLayer(resting)).toMatchObject({ position: "absolute", bottom: STAND_HEIGHT, backgroundColor: COLORS.SURFACE });
    act(() => resting.unmount());
    const lit = mount(<VideoGridItem video={episode} onPress={jest.fn()} index={0} highlighted />);
    expect(depthLayer(lit)).toMatchObject({ bottom: 0, shadowColor: ACCENT });
    act(() => lit.unmount());
  });
});
