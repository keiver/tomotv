/**
 * Every card surface draws in the chosen theme's colour: the focus ring, glow and title bar, the
 * resume fill and title, the badges, the press sweep, the now-playing bar and the folder loading bar.
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
import { FolderGridItem } from "@/components/folder-grid-item";
import { FolderLoadingBar } from "@/components/folder-loading-bar";
import { glassTint } from "@/components/glass-button";
import { GlassSurface } from "@/components/glass-surface";
import { NowPlayingTitleBar } from "@/components/now-playing-title-bar";
import { VideoGridItem } from "@/components/video-grid-item";
import { COLORS } from "@/constants/colors";
import { CardPaletteOverride } from "@/hooks/useCardPalette";
import { cardPalette } from "@/services/cardTheme";
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
  it("a focused video card rings, glows, fills its title bar and inks its title in the theme", () => {
    const drawn = colours(<VideoGridItem video={video} onPress={jest.fn()} index={0} highlighted />);
    expect(drawn.filter((c) => c === ACCENT).length).toBeGreaterThanOrEqual(4);
    expect(drawn).toContain(palette.ink);
    expect(drawn).not.toContain(COLORS.ACCENT);
  });

  it("a resting resume card fills its progress and inks its title and badge in the theme", () => {
    const drawn = colours(<VideoGridItem video={video} onPress={jest.fn()} index={0} progressPercent={0.4} />);
    expect(drawn).toContain(ACCENT);
    expect(drawn).not.toContain(COLORS.ACCENT);
  });

  it("a focused folder card and its count badge take the theme", () => {
    const drawn = colours(<FolderGridItem folder={folder} onPress={jest.fn()} index={0} highlighted />);
    expect(drawn.filter((c) => c === ACCENT).length).toBeGreaterThanOrEqual(4);
    expect(drawn).toContain(palette.ink);
    expect(drawn).not.toContain(COLORS.ACCENT);
  });

  it("a folder's count badge is the bare number", () => {
    let tree!: TestRenderer.ReactTestRenderer;
    act(() => {
      tree = TestRenderer.create(
        <CardPaletteOverride.Provider value={palette}>
          <FolderGridItem folder={folder} onPress={jest.fn()} index={0} />
        </CardPaletteOverride.Provider>,
      );
    });
    expect(tree.root.findByType(CardBadge).props.segments).toEqual([{ label: 3 }]);
    act(() => tree.unmount());
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

  it("the now-playing bar and the folder loading bar sweep in the theme", () => {
    const playing = colours(<NowPlayingTitleBar video={video} focused={false} kind="video" progressPercent={0.5} playing />);
    expect(playing).toContain(ACCENT);
    expect(playing).not.toContain(COLORS.ACCENT);
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
