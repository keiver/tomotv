/** On TV a media card's base and its corner notch are the card's own colour at rest and the accent on focus, and the card's depth sits on a layer behind the art. */
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
jest.mock("@/services/itemArtwork", () => ({ showsChannelLogo: () => false, folderPosterSource: () => undefined }));
jest.mock("@/components/poster-collage", () => ({ PosterCollage: () => null }));
jest.mock("@/hooks/useFolderPreview", () => ({ useFolderPreview: () => [] }));
jest.mock("@/hooks/useViewItemCount", () => ({ useViewItemCount: () => ({ count: 3, loading: false }) }));
jest.mock("@/services/liveFrames", () => ({ LIVE_FRAME_TRANSITION_MS: 0, LIVE_FRAME_REFRESH_MS: 120_000, liveFrameReel: () => undefined, subscribeLiveFrame: () => () => undefined }));
jest.mock("@/services/jellyfinApi", () => ({ isAudioItem: () => false, isBook: () => false }));

Object.defineProperty(Platform, "isTV", { value: true, configurable: true });
// Read after the flag: the components fix their platform at import.
const { CardStand } = require("@/components/card-stand") as typeof import("@/components/card-stand");
const { CardCornerNotch } = require("@/components/card-corner-notch") as typeof import("@/components/card-corner-notch");
const { VideoGridItem } = require("@/components/video-grid-item") as typeof import("@/components/video-grid-item");
const { FolderGridItem } = require("@/components/folder-grid-item") as typeof import("@/components/folder-grid-item");
const { CARD_DEPTH, CARD_FOCUS } = require("@/constants/app") as typeof import("@/constants/app");
const { COLORS } = require("@/constants/colors") as typeof import("@/constants/colors");
const { CardPaletteOverride } = require("@/hooks/useCardPalette") as typeof import("@/hooks/useCardPalette");
const { cardPalette } = require("@/services/cardTheme") as typeof import("@/services/cardTheme");

const ACCENT = "#4F99FF";
const palette = cardPalette(ACCENT);
const episode = { Id: "e1", Name: "Pilot", Type: "Episode", IndexNumber: 5, ParentIndexNumber: 1 } as import("@/types/jellyfin").JellyfinVideoItem;
const folder = { Id: "f1", Name: "Shows", Type: "Folder", RecursiveItemCount: 3 } as unknown as import("@/types/jellyfin").JellyfinItem;

function mount(element: React.ReactElement) {
  let tree!: TestRenderer.ReactTestRenderer;
  act(() => {
    tree = TestRenderer.create(<CardPaletteOverride.Provider value={palette}>{element}</CardPaletteOverride.Provider>);
  });
  return tree;
}

const glass = (tree: TestRenderer.ReactTestRenderer) => tree.root.findAll((n) => (n.type as unknown) === "GlassSurface");
const notchFill = (tree: TestRenderer.ReactTestRenderer) => StyleSheet.flatten(tree.root.findByProps({ testID: "card-corner-notch-body" }).props.style).backgroundColor;

describe("card base and corner notch on TV", () => {
  it("a base is the card's colour with no glass at rest, and the accent on focus", () => {
    const resting = mount(<CardStand name="Pilot" focused={false} />);
    expect(glass(resting)).toHaveLength(0);
    expect(StyleSheet.flatten(resting.root.findByProps({ testID: "card-stand" }).props.style).backgroundColor).toBe(COLORS.SURFACE);
    act(() => resting.unmount());
    const lit = mount(<CardStand name="Pilot" focused />);
    expect(glass(lit)).toHaveLength(0);
    expect(StyleSheet.flatten(lit.root.findByProps({ testID: "card-stand" }).props.style).backgroundColor).toBe(ACCENT);
    act(() => lit.unmount());
  });

  it("a media card's base and corner notch are the same colour as a folder card's", () => {
    const tree = mount(<VideoGridItem video={episode} onPress={jest.fn()} index={0} />);
    expect(StyleSheet.flatten(tree.root.findByProps({ testID: "card-stand" }).props.style).backgroundColor).toBe(COLORS.SURFACE);
    expect(notchFill(tree)).toBe(COLORS.SURFACE);
    act(() => tree.unmount());
  });

  it("on TV the base's name is centred", () => {
    const tree = mount(<CardStand name="Pilot" focused={false} scrolls />);
    const text = tree.root.findAll((n) => typeof n.type === "string" && n.props.children === "Pilot")[0];
    expect(StyleSheet.flatten(text.props.style).textAlign).toBe("center");
    act(() => tree.unmount());
  });

  it("the corner notch is the card's colour with no glass at rest, and the accent with the ink on focus", () => {
    const resting = mount(<CardCornerNotch segments={[{ label: "S01E05" }]} />);
    expect(glass(resting)).toHaveLength(0);
    expect(notchFill(resting)).toBe(COLORS.SURFACE);
    act(() => resting.unmount());
    const lit = mount(<CardCornerNotch segments={[{ label: "S01E05" }]} focused />);
    expect(glass(lit)).toHaveLength(0);
    expect(notchFill(lit)).toBe(ACCENT);
    expect(StyleSheet.flatten(lit.root.findAll((n) => typeof n.type === "string" && n.props.children === "S01E05")[0].props.style).color).toBe(palette.ink);
    act(() => lit.unmount());
  });

  it("on focus the notch's fillets start inside the focus ring's width, and at rest they start at the card edge", () => {
    const filletMargins = (tree: TestRenderer.ReactTestRenderer) => {
      const top = StyleSheet.flatten(tree.root.findByProps({ testID: "card-corner-notch-fillet-top" }).props.style);
      const left = StyleSheet.flatten(tree.root.findByProps({ testID: "card-corner-notch-fillet-left" }).props.style);
      return { top: top.marginTop, left: left.marginLeft };
    };
    const resting = mount(<CardCornerNotch segments={[{ label: "S01E05" }]} />);
    expect(filletMargins(resting)).toEqual({ top: 0, left: 0 });
    act(() => resting.unmount());
    const lit = mount(<CardCornerNotch segments={[{ label: "S01E05" }]} focused />);
    expect(filletMargins(lit)).toEqual({ top: CARD_FOCUS.BORDER_WIDTH_FOCUSED, left: CARD_FOCUS.BORDER_WIDTH_FOCUSED });
    act(() => lit.unmount());
    const live = mount(<CardCornerNotch segments={[{ label: "NOW" }]} tone="live" focused />);
    expect(filletMargins(live)).toEqual({ top: CARD_FOCUS.BORDER_WIDTH_FOCUSED, left: CARD_FOCUS.BORDER_WIDTH_FOCUSED });
    act(() => live.unmount());
  });

  it("on TV the corner notch is rasterized", () => {
    const tree = mount(<CardCornerNotch segments={[{ label: "S01E05" }]} />);
    const anchor = tree.root.findAll((n) => n.props.testID === "card-corner-notch" && typeof n.type === "string")[0];
    expect(anchor.props.shouldRasterizeIOS).toBe(true);
    act(() => tree.unmount());
  });

  it("the card has no fill of its own; a depth layer behind it covers the whole card at rest and on focus, so its shadow falls below the base", () => {
    const depthLayer = (tree: TestRenderer.ReactTestRenderer) => {
      let card = tree.root.findByType(CardStand).parent!;
      while (card.props.style === undefined) card = card.parent!;
      expect(StyleSheet.flatten(card.props.style).backgroundColor).toBeUndefined();
      return StyleSheet.flatten((card.children[0] as TestRenderer.ReactTestInstance).props.style);
    };
    const resting = mount(<VideoGridItem video={episode} onPress={jest.fn()} index={0} />);
    expect(depthLayer(resting)).toMatchObject({ position: "absolute", bottom: 1, backgroundColor: COLORS.SURFACE_SUNKEN, shadowOpacity: CARD_DEPTH.SHADOW_OPACITY });
    act(() => resting.unmount());
    const lit = mount(<VideoGridItem video={episode} onPress={jest.fn()} index={0} highlighted />);
    expect(depthLayer(lit)).toMatchObject({ bottom: 1, shadowColor: ACCENT });
    act(() => lit.unmount());
  });

  it("the depth layer sits one point inside the art on both cards, so its rounded edge never shares a curve with the art's clip", () => {
    const depthLayer = (tree: TestRenderer.ReactTestRenderer) => {
      let card = tree.root.findByType(CardStand).parent!;
      while (card.props.style === undefined) card = card.parent!;
      return StyleSheet.flatten((card.children[0] as TestRenderer.ReactTestInstance).props.style);
    };
    const inside = { top: 1, left: 1, right: 1 };
    const video = mount(<VideoGridItem video={episode} onPress={jest.fn()} index={0} />);
    expect(depthLayer(video)).toMatchObject(inside);
    act(() => video.unmount());
    const litVideo = mount(<VideoGridItem video={episode} onPress={jest.fn()} index={0} highlighted />);
    expect(depthLayer(litVideo)).toMatchObject({ ...inside, bottom: 1 });
    act(() => litVideo.unmount());
    const folderCard = mount(<FolderGridItem folder={folder} onPress={jest.fn()} index={0} />);
    expect(depthLayer(folderCard)).toMatchObject({ ...inside, bottom: 1, shadowOpacity: CARD_DEPTH.SHADOW_OPACITY });
    act(() => folderCard.unmount());
    const litFolder = mount(<FolderGridItem folder={folder} onPress={jest.fn()} index={0} highlighted />);
    expect(depthLayer(litFolder)).toMatchObject({ ...inside, bottom: 1 });
    act(() => litFolder.unmount());
  });
});
