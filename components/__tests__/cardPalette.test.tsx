/**
 * Every card surface draws in the chosen theme's colour: the focus ring and glow, the line under the
 * card, the progress fill, the badges, the press sweep and the folder loading bar.
 */
import React from "react";
import { StyleSheet } from "react-native";
import TestRenderer, { act } from "react-test-renderer";

jest.mock("@/components/MarqueeText", () => {
  const { Text } = require("react-native");
  return { MarqueeText: ({ children, style }: { children: React.ReactNode; style: object }) => <Text style={style}>{children}</Text> };
});
jest.mock("@/components/live-tv/live-clip", () => ({ LiveClip: () => null }));
jest.mock("@/components/poster-collage", () => ({ PosterCollage: () => null }));
jest.mock("@/hooks/useItemPoster", () => ({ useItemPoster: () => undefined }));
jest.mock("@/hooks/useMinuteClock", () => ({ useMinuteClock: () => 0 }));
jest.mock("@/hooks/useNowPlaying", () => ({ useIsNowPlaying: () => false, useNowPlayingVideo: () => ({ active: false, playing: false }), useOpenNowPlaying: () => jest.fn() }));
// The press sweep is up, so the card renders it too.
jest.mock("@/hooks/useCardNavProgress", () => ({ useCardNavProgress: () => ({ navigating: true, visible: true, startNavProgress: jest.fn(), resetNavProgress: jest.fn() }) }));
jest.mock("@/hooks/useFolderPreview", () => ({ useFolderPreview: () => [] }));
jest.mock("@/hooks/useViewItemCount", () => ({ useViewItemCount: () => ({ count: 3, loading: false }) }));
jest.mock("@/services/itemArtwork", () => ({ showsChannelLogo: () => false, folderPosterSource: () => undefined }));
jest.mock("@/services/liveFrames", () => ({ LIVE_FRAME_TRANSITION_MS: 0 }));
jest.mock("@/services/jellyfinApi", () => ({ isAudioItem: () => false, isBook: () => false, JELLYFIN_TIME: { TICKS_PER_SECOND: 10_000_000 } }));
jest.mock("@/contexts/PlayerSessionContext", () => ({ usePlayerSession: () => ({ sessionVideoId: null, hostMode: "idle", playbackState: { type: "IDLE" } }) }));
jest.mock("@/services/audioPlayerManager", () => ({ audioPlayerManager: { getUIState: () => ({ playing: true, position: 0 }), subscribe: () => () => {} } }));

import { BADGE_GLASS_TINT, CardBadge } from "@/components/card-badge";
import { CardCornerTab } from "@/components/card-corner-tab";
import { CardNavProgress } from "@/components/card-nav-progress";
import { CardStand } from "@/components/card-stand";
import { FolderGridItem } from "@/components/folder-grid-item";
import { FolderLoadingBar } from "@/components/folder-loading-bar";
import { glassTint } from "@/components/glass-button";
import { GlassSurface } from "@/components/glass-surface";
import { VideoGridItem } from "@/components/video-grid-item";
import { COLORS } from "@/constants/colors";
import { CardPaletteOverride } from "@/hooks/useCardPalette";
import { cardPalette, isLowContrast } from "@/services/cardTheme";
import { __setLocaleForTests } from "@/services/i18n";
import type { JellyfinItem, JellyfinVideoItem } from "@/types/jellyfin";

const ACCENT = "#1A237E";
const palette = cardPalette(ACCENT);
const video = { Id: "v1", Name: "Film", Type: "Series", Path: "", UserData: { Played: true } } as JellyfinVideoItem;
const folder = { Id: "f1", Name: "Shows", Type: "Folder", RecursiveItemCount: 3 } as unknown as JellyfinItem;

/** Every colour any host view, text or icon in the tree is drawn with. */
function colours(element: React.ReactElement): string[] {
  let tree!: TestRenderer.ReactTestRenderer;
  act(() => {
    tree = TestRenderer.create(<CardPaletteOverride.Provider value={palette}>{element}</CardPaletteOverride.Provider>);
  });
  const found: string[] = [];
  for (const node of tree.root.findAll((n) => typeof n.type === "string")) {
    const style = StyleSheet.flatten(node.props.style) ?? {};
    for (const key of ["color", "backgroundColor", "borderColor", "shadowColor"] as const) {
      if (typeof style[key] === "string") found.push(style[key]);
    }
    if (typeof node.props.color === "string") found.push(node.props.color);
  }
  act(() => tree.unmount());
  return found;
}

/** The tint a badge hands its glass surface. */
function glassTintOf(element: React.ReactElement): string {
  let tree!: TestRenderer.ReactTestRenderer;
  act(() => {
    tree = TestRenderer.create(<CardPaletteOverride.Provider value={palette}>{element}</CardPaletteOverride.Provider>);
  });
  const tint = tree.root.findByType(GlassSurface).props.tintColor;
  act(() => tree.unmount());
  return tint;
}

describe("card palette", () => {
  it("a focused video card rings, glows and sweeps in the theme", () => {
    const drawn = colours(<VideoGridItem video={video} onPress={jest.fn()} index={0} highlighted />);
    expect(drawn.filter((c) => c === ACCENT).length).toBeGreaterThanOrEqual(4);
    expect(drawn).not.toContain(COLORS.ACCENT);
  });

  it("a resting resume card fills its base in the theme", () => {
    const drawn = colours(<VideoGridItem video={video} onPress={jest.fn()} index={0} progressPercent={0.4} />);
    expect(drawn).toContain(ACCENT);
    expect(drawn).not.toContain(COLORS.ACCENT);
  });

  it("a focused folder card rings, glows and sweeps in the theme", () => {
    const drawn = colours(<FolderGridItem folder={folder} onPress={jest.fn()} index={0} highlighted />);
    expect(drawn.filter((c) => c === ACCENT).length).toBeGreaterThanOrEqual(4);
    expect(drawn).not.toContain(COLORS.ACCENT);
  });

  it("a pressed folder card fills its base with the sweep and draws no ring or tint over it", () => {
    let tree!: TestRenderer.ReactTestRenderer;
    act(() => {
      tree = TestRenderer.create(<FolderGridItem folder={folder} onPress={jest.fn()} index={0} />);
    });
    const [sweep] = tree.root.findAllByType(CardNavProgress);
    expect(sweep.props).toMatchObject({ stand: true, title: "Shows" });
    expect(sweep.parent!.findAllByType(CardStand)).toHaveLength(1);
    expect(tree.root.findAll((n) => typeof n.props.testID === "string" && n.props.testID.startsWith("card-press"))).toHaveLength(0);
    act(() => tree.unmount());
  });

  it("a folder wears its count on a corner tab cut from the card's own colour, and its heart before the name", () => {
    let tree!: TestRenderer.ReactTestRenderer;
    act(() => {
      tree = TestRenderer.create(
        <CardPaletteOverride.Provider value={palette}>
          <FolderGridItem folder={{ ...folder, UserData: { IsFavorite: true } } as JellyfinItem} onPress={jest.fn()} index={0} />
        </CardPaletteOverride.Provider>,
      );
    });
    expect(tree.root.findAllByType(CardBadge)).toHaveLength(0);
    expect(tree.root.findByType(CardCornerTab).props.segments).toEqual([{ label: "3" }]);
    const tab = tree.root.findAll((n) => n.props.testID === "card-corner-tab" && typeof n.type === "string")[0];
    expect(StyleSheet.flatten(tab.props.style)).toMatchObject({ backgroundColor: COLORS.SURFACE_SUNKEN, top: 0, left: 0, borderBottomRightRadius: expect.any(Number) });
    // The theme's accent is too dark to read on the card, so the count is white, like the name.
    expect(tab.findAll((n) => typeof n.type === "string" && n.props.children === "3").map((n) => StyleSheet.flatten(n.props.style).color)).toEqual([COLORS.TEXT_PRIMARY]);
    expect(tree.root.findByType(CardStand).props).toMatchObject({ name: "Shows", icon: "heart" });
    act(() => tree.unmount());
  });

  it.each([
    ["en", "11,365"],
    ["de", "11.365"],
  ] as const)("a folder count groups its digits the way the app's language does (%s)", (tag, label) => {
    __setLocaleForTests(tag);
    let tree!: TestRenderer.ReactTestRenderer;
    act(() => {
      tree = TestRenderer.create(<FolderGridItem folder={{ ...folder, RecursiveItemCount: 11365 } as JellyfinItem} onPress={jest.fn()} index={0} />);
    });
    expect(tree.root.findByType(CardCornerTab).props.segments).toEqual([{ label }]);
    act(() => tree.unmount());
    __setLocaleForTests("en");
  });
  it("the base names a card in the accent at rest (white when the accent is too dark), in the ink on the accent when focused", () => {
    const standColours = (accent: string, focused: boolean) => {
      let tree!: TestRenderer.ReactTestRenderer;
      act(() => {
        tree = TestRenderer.create(
          <CardPaletteOverride.Provider value={cardPalette(accent)}>
            <CardStand name="Film" focused={focused} />
          </CardPaletteOverride.Provider>,
        );
      });
      const text = tree.root.findAll((n) => typeof n.type === "string" && n.props.children === "Film")[0];
      const base = tree.root.findAll((n) => n.props.testID === "card-stand" && typeof n.type === "string")[0];
      const result = { text: StyleSheet.flatten(text.props.style).color, base: StyleSheet.flatten(base.props.style).backgroundColor };
      act(() => tree.unmount());
      return result;
    };
    const bright = "#4F99FF";
    expect(isLowContrast(bright)).toBe(false);
    expect(standColours(bright, false)).toEqual({ text: bright, base: COLORS.BACKGROUND_DEEP });
    expect(standColours(bright, true)).toEqual({ text: cardPalette(bright).ink, base: bright });
    expect(isLowContrast(ACCENT)).toBe(true);
    expect(standColours(ACCENT, false).text).toBe(COLORS.TEXT_PRIMARY);
  });

  it("a badge is near-black glass at rest, the theme's deepened tint on focus; live is solid red", () => {
    expect(glassTintOf(<CardBadge segments={[{ label: 3 }]} />)).toBe(BADGE_GLASS_TINT);
    expect(glassTintOf(<CardBadge segments={[{ label: 3 }]} focused />)).toBe(glassTint(ACCENT, true));
    expect(colours(<CardBadge segments={[{ label: "LIVE" }]} tone="live" />)).toEqual(expect.arrayContaining([COLORS.DESTRUCTIVE_DEEP, COLORS.TEXT_PRIMARY]));
    expect(colours(<CardBadge segments={[{ label: "LIVE" }]} tone="live" focused />)).toContain(COLORS.DESTRUCTIVE_DEEP);
    expect(colours(<CardBadge segments={[{ label: 3 }]} />)).toContain(ACCENT);
    expect(colours(<CardBadge segments={[{ label: 3 }]} />)).not.toContain(COLORS.ACCENT);
    expect(colours(<CardBadge segments={[{ label: 3 }]} focused />)).toContain(COLORS.TEXT_PRIMARY);
  });

  it("a full base names the card in the ink, with no blend; a partial one blends the accent", () => {
    const nameOn = (progress: number) => {
      let tree!: TestRenderer.ReactTestRenderer;
      act(() => {
        tree = TestRenderer.create(
          <CardPaletteOverride.Provider value={palette}>
            <CardStand name="Film" focused={false} progress={progress} />
          </CardPaletteOverride.Provider>,
        );
      });
      const text = tree.root.findAll((n) => typeof n.type === "string" && n.props.children === "Film")[0];
      const row = tree.root.findAll((n) => typeof n.type === "string" && StyleSheet.flatten(n.props.style)?.flexDirection === "row")[0];
      const result = { color: StyleSheet.flatten(text.props.style).color, blend: StyleSheet.flatten(row.props.style).mixBlendMode };
      act(() => tree.unmount());
      return result;
    };
    expect(nameOn(1)).toEqual({ color: palette.ink, blend: undefined });
    expect(nameOn(0.4)).toEqual({ color: ACCENT, blend: "difference" });
  });

  it("a focused watched card's base goes dark with the name in the accent and no fill", () => {
    const bright = "#4F99FF";
    let tree!: TestRenderer.ReactTestRenderer;
    act(() => {
      tree = TestRenderer.create(
        <CardPaletteOverride.Provider value={cardPalette(bright)}>
          <CardStand name="Film" focused progress={1} />
        </CardPaletteOverride.Provider>,
      );
    });
    const base = tree.root.findAll((n) => n.props.testID === "card-stand" && typeof n.type === "string")[0];
    const text = tree.root.findAll((n) => typeof n.type === "string" && n.props.children === "Film")[0];
    expect(StyleSheet.flatten(base.props.style).backgroundColor).toBe(COLORS.BACKGROUND_DEEP);
    expect(StyleSheet.flatten(text.props.style).color).toBe(bright);
    expect(tree.root.findAll((n) => n.props.testID === "card-stand-fill")).toHaveLength(0);
    act(() => tree.unmount());
  });

  it("a focused card part way through keeps its fill", () => {
    let tree!: TestRenderer.ReactTestRenderer;
    act(() => {
      tree = TestRenderer.create(<CardStand name="Film" focused progress={0.4} />);
    });
    expect(tree.root.findAll((n) => n.props.testID === "card-stand-fill" && typeof n.type === "string")).toHaveLength(1);
    act(() => tree.unmount());
  });

  it("the fill sits in a layer with no padding, so its percentage spans the whole base", () => {
    let tree!: TestRenderer.ReactTestRenderer;
    act(() => {
      tree = TestRenderer.create(<CardStand name="Film" focused={false} progress={1} />);
    });
    let host = tree.root.findAll((n) => n.props.testID === "card-stand-fill" && typeof n.type === "string")[0].parent!;
    while (typeof host.type !== "string") host = host.parent!;
    const layer = StyleSheet.flatten(host.props.style);
    expect(layer).toMatchObject({ position: "absolute", left: 0, right: 0, top: 0, bottom: 0 });
    expect(layer.paddingHorizontal ?? layer.padding ?? 0).toBe(0);
    act(() => tree.unmount());
  });

  it("a scrolling name keeps the card's centre: the mark sits at the left edge and the name clears it on both sides", () => {
    let tree!: TestRenderer.ReactTestRenderer;
    act(() => {
      tree = TestRenderer.create(<CardStand name="Film" icon="heart" focused={false} scrolls />);
    });
    let lead = tree.root.findAll((n) => n.props.name === "heart")[0].parent!;
    while (typeof lead.type !== "string") lead = lead.parent!;
    expect(StyleSheet.flatten(lead.props.style)).toMatchObject({ position: "absolute", left: 0 });
    let slot = tree.root.findAll((n) => typeof n.type === "string" && n.props.children === "Film")[0].parent!;
    while (typeof slot.type !== "string" || StyleSheet.flatten(slot.props.style)?.flex !== 1) slot = slot.parent!;
    expect(StyleSheet.flatten(slot.props.style).marginHorizontal).toBeGreaterThan(0);
    act(() => tree.unmount());
  });

  it("a corner tab is cut from the card's colour and lettered in a readable accent", () => {
    const bright = "#4F99FF";
    let tree!: TestRenderer.ReactTestRenderer;
    act(() => {
      tree = TestRenderer.create(
        <CardPaletteOverride.Provider value={cardPalette(bright)}>
          <CardCornerTab segments={[{ label: "S01E05" }]} />
        </CardPaletteOverride.Provider>,
      );
    });
    const tab = tree.root.findAll((n) => n.props.testID === "card-corner-tab" && typeof n.type === "string")[0];
    expect(StyleSheet.flatten(tab.props.style).backgroundColor).toBe(COLORS.SURFACE);
    expect(StyleSheet.flatten(tab.findAll((n) => typeof n.type === "string" && n.props.children === "S01E05")[0].props.style).color).toBe(bright);
    act(() => tree.unmount());
  });

  it("a programme's corner tab is the live red with white lettering", () => {
    const drawn = colours(<CardCornerTab segments={[{ label: "NOW" }]} tone="live" />);
    expect(drawn).toEqual(expect.arrayContaining([COLORS.DESTRUCTIVE_DEEP, COLORS.TEXT_PRIMARY]));
    expect(drawn).not.toContain(ACCENT);
  });

  it("the base's progress fill and the folder loading bar fill in the theme", () => {
    const strip = colours(<CardStand name="Film" focused={false} progress={0.5} />);
    expect(strip).toContain(ACCENT);
    expect(strip).not.toContain(COLORS.ACCENT);
    const loading = colours(<FolderLoadingBar active title="Shows" />);
    expect(loading).toContain(ACCENT);
    expect(loading).not.toContain(COLORS.ACCENT);
  });

  it("an inert preview card takes no focus and no press", () => {
    let tree!: TestRenderer.ReactTestRenderer;
    act(() => {
      tree = TestRenderer.create(<VideoGridItem video={video} onPress={jest.fn()} index={0} inert />);
    });
    const touchable = tree.root.findAll((n) => n.props.isTVSelectable !== undefined)[0];
    expect(touchable.props.isTVSelectable).toBe(false);
    expect(touchable.props.disabled).toBe(true);
    act(() => tree.unmount());
  });
});
