import { CARD_BADGE_INSET, CardBadge } from "@/components/card-badge";
import { CardNavProgress } from "@/components/card-nav-progress";
import { CardCornerScrim, CardScrim } from "@/components/card-scrim";
import { CARD_DEPTH, CARD_FOCUS, cardSlotRatio, DESIGN, GRID, slotColumns, type SlotOrientation } from "@/constants/app";
import { COLORS } from "@/constants/colors";
import { useCardNavProgress } from "@/hooks/useCardNavProgress";
import { useViewItemCount } from "@/hooks/useViewItemCount";
import { getFolderThumbnailUrl } from "@/services/jellyfinApi";
import { JellyfinItem } from "@/types/jellyfin";
import { backkeyProbe } from "@/utils/backkeyProbe";
import { Image } from "expo-image";
import { Ionicons } from "@expo/vector-icons";
import React, { forwardRef, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Dimensions, Platform, StyleSheet, TouchableOpacity, View } from "react-native";
import { MarqueeText } from "./MarqueeText";

const IS_TV = Platform.isTV;
// Tablet type off the physical short side, read once. The title is pure chrome and feeds
// no layout math, so it needs no window subscription and cannot desync the row packer.
const SCREEN = Dimensions.get("screen");
const IS_TABLET = !IS_TV && Math.min(SCREEN.width, SCREEN.height) >= GRID.PHONE_WIDE_MIN_WIDTH;
const TITLE_SIZE = IS_TV ? 22 : IS_TABLET ? 15 : 13;
const CARD_PADDING = IS_TV ? 16 : 8;
const POSTER_SIZE = IS_TV ? 300 : 200;

// The badge counts a different thing in every folder kind, and the number alone says which
// one about as well as a bare track number does. Kinds outside this table fall back to Folder.
const COUNT_ICONS: Record<string, keyof typeof Ionicons.glyphMap> = {
  Series: "tv",
  Season: "tv",
  MusicAlbum: "disc",
  MusicArtist: "musical-notes",
  PhotoAlbum: "images",
  BoxSet: "film",
  Playlist: "list",
};

interface FolderGridItemProps {
  folder: JellyfinItem;
  onPress: (folder: JellyfinItem) => void;
  /** Optional long-press handler (e.g. the card context menu). */
  onLongPress?: (folder: JellyfinItem) => void;
  index: number;
  onItemFocus?: (folder: JellyfinItem, index: number) => void;
  /** TV: focus left this card (grid focus bookkeeping — see library-grid's recovery). */
  onItemBlur?: (folder: JellyfinItem) => void;
  /** TV: this card unmounted while it held focus — its native view died under the viewer. */
  onFocusedGone?: () => void;
  hasTVPreferredFocus?: boolean;
  /** Wear the focus treatment with no touch on it, how the phone marks the "Show In Folder" target. */
  highlighted?: boolean;
  /** Native node tag to focus when Up is pressed (top-row cards target the Filters button). */
  nextFocusUp?: number;
  /** Down target for a card stranded above a partial last row (see library-grid.tsx). */
  nextFocusDown?: number;
  /** Slot shape of the grid this card lives in (drives card aspect ratio + column width). */
  slotOrientation?: SlotOrientation;
  /** Live column count from the host grid (orientation-aware). Falls back to the static count. */
  numColumns?: number;
  /** Fixed pixel width (horizontal shelves); overrides the percentage column width. */
  cardWidth?: number;
  /**
   * Fixed card height in px (horizontal shelves): the card derives its own width from its slot
   * ratio, so mixed-shape cards share one row height. Ignored when cardWidth is set.
   */
  cardHeight?: number;
  /**
   * Snap the card's slot to the artwork's own shape (poster / square / wide) and cover-fill it,
   * instead of letterboxing mismatched art in a fixed slot. Shelf rows only.
   */
  fitArtwork?: boolean;
}

const FolderGridItemComponent = forwardRef<React.ElementRef<typeof TouchableOpacity>, FolderGridItemProps>(function FolderGridItemComponent(
  {
    folder,
    onPress,
    onLongPress,
    index,
    onItemFocus,
    onItemBlur,
    onFocusedGone,
    hasTVPreferredFocus = false,
    highlighted = false,
    nextFocusUp,
    nextFocusDown,
    slotOrientation = "portrait",
    numColumns,
    cardWidth,
    cardHeight,
    fitArtwork = false,
  },
  ref,
) {
  const [pressFocused, setPressFocused] = useState(false);
  // Touch has no focus engine, so a card can only be marked from the outside.
  const focused = pressFocused || highlighted;
  const { navigating, visible: navBarVisible, startNavProgress, resetNavProgress } = useCardNavProgress();
  // Unmounting while focused destroys the native view UIKit is focused on; report it so the
  // grid can re-anchor (a changed listing re-keys packed rows and remounts their cards).
  const wasFocusedRef = useRef(false);
  const onFocusedGoneRef = useRef(onFocusedGone);
  useEffect(() => {
    onFocusedGoneRef.current = onFocusedGone;
  }, [onFocusedGone]);
  useEffect(
    () => () => {
      if (wasFocusedRef.current) {
        backkeyProbe("focused card UNMOUNTED", { id: folder.Id, name: folder.Name });
        onFocusedGoneRef.current?.();
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  // Stable cache key (id + image tag + size) keeps the disk/memory cache hot across
  // reloads and token changes — independent of the ApiKey in the URL.
  const thumbnailSource = useMemo(
    () => (folder.ImageTags?.Primary ? { uri: getFolderThumbnailUrl(folder.Id, POSTER_SIZE), cacheKey: `${folder.Id}-${folder.ImageTags.Primary}-${POSTER_SIZE}` } : undefined),
    [folder.Id, folder.ImageTags?.Primary],
  );

  // The card's slot ratio (see cardSlotRatio — shared with the row packer so rendered and
  // allocated widths agree). The art always cover-fills the slot — a crop beats a letterbox.
  const cardRatio = cardSlotRatio(fitArtwork, folder.PrimaryImageAspectRatio, slotOrientation);

  const countIcon = COUNT_ICONS[folder.Type] ?? "folder";

  const handleFocus = useCallback(() => {
    wasFocusedRef.current = true;
    if (IS_TV) backkeyProbe("card native focus", { id: folder.Id, name: folder.Name });
    setPressFocused(true);
    onItemFocus?.(folder, index);
  }, [onItemFocus, folder, index]);

  const handleBlur = useCallback(() => {
    wasFocusedRef.current = false;
    if (IS_TV) backkeyProbe("card blur", { id: folder.Id, name: folder.Name });
    setPressFocused(false);
    onItemBlur?.(folder);
    resetNavProgress();
  }, [resetNavProgress, onItemBlur, folder]);

  const handlePress = useCallback(() => {
    startNavProgress();
    onPress(folder);
  }, [onPress, folder, startNavProgress]);

  const handleLongPress = useCallback(() => {
    onLongPress?.(folder);
  }, [onLongPress, folder]);

  // Recursive count when the server provides it; ChildCount (direct children) is the
  // fallback for types excluded from recursive counts (e.g. channel-sourced folders),
  // where the server reports a recursive 0 despite real children. A resolved 0 still
  // renders as a "0" badge. Library views carry no inline count — theirs streams in
  // lazily (badge shows the box spinner meanwhile).
  const { count: lazyCount, loading: countLoading } = useViewItemCount(folder);
  const itemCount = (folder.RecursiveItemCount || (folder.ChildCount ?? folder.RecursiveItemCount)) ?? lazyCount;

  return (
    <TouchableOpacity
      ref={ref}
      onPress={handlePress}
      onLongPress={onLongPress ? handleLongPress : undefined}
      onFocus={handleFocus}
      onBlur={handleBlur}
      // Touch: a held press shows the same focus treatment the TV focus engine drives
      // (gold border, glow, gold title bar). TV keeps onFocus/onBlur only.
      onPressIn={IS_TV ? undefined : handleFocus}
      onPressOut={IS_TV ? undefined : handleBlur}
      activeOpacity={0.95}
      isTVSelectable={true}
      hasTVPreferredFocus={hasTVPreferredFocus}
      nextFocusUp={nextFocusUp}
      nextFocusDown={nextFocusDown}
      style={[
        styles.container,
        cardWidth != null
          ? { width: cardWidth }
          : cardHeight != null
            ? { width: (cardHeight - 2 * CARD_PADDING) * cardRatio + 2 * CARD_PADDING }
            : { width: `${100 / (numColumns ?? slotColumns(slotOrientation, IS_TV))}%` },
      ]}
      accessibilityLabel={folder.Name || "Folder"}
      accessibilityRole="button"
      accessibilityHint={itemCount != null ? `Navigate to ${folder.Name} with ${itemCount} ${itemCount === 1 ? "item" : "items"}` : `Navigate to ${folder.Name}`}>
      <View style={[styles.card, focused && styles.cardFocused]}>
        <View style={[styles.imageContainer, { aspectRatio: cardRatio }]}>
          {thumbnailSource ? (
            <>
              <Image source={thumbnailSource} style={styles.poster} contentFit="cover" transition={0} priority={index < 10 ? "high" : "normal"} cachePolicy="memory-disk" recyclingKey={folder.Id} />
              <CardScrim />
              {focused && (itemCount != null || countLoading) ? <CardCornerScrim /> : null}
            </>
          ) : (
            <View style={styles.placeholderPoster}>
              <Ionicons name="folder-outline" size={IS_TV ? 90 : 56} color="rgba(255, 255, 255, 0.45)" />
            </View>
          )}

          {/* Item-count badge (top-left), iconed by what it counts */}
          {itemCount != null || countLoading ? (
            <View style={styles.countBadge} pointerEvents="none">
              {itemCount != null ? <CardBadge segments={[{ icon: countIcon, label: itemCount }]} focused={focused} /> : <CardBadge segments={[{ icon: countIcon }]} loading focused={focused} />}
            </View>
          ) : null}

          {/* Opaque dark title bar at the very bottom — same treatment as the video cards.
              Focused: opaque gold bar */}
          {focused ? (
            <View style={[styles.infoOverlay, styles.infoOverlayFocused]}>
              <MarqueeText active={focused} style={StyleSheet.flatten([styles.folderName, styles.folderNameFocused])}>
                {folder.Name}
              </MarqueeText>
            </View>
          ) : (
            <View style={[styles.infoOverlay, styles.infoOverlayDark]}>
              <MarqueeText active={focused} style={StyleSheet.flatten([styles.folderName, styles.folderNameGold])}>
                {folder.Name}
              </MarqueeText>
            </View>
          )}

          <View style={[styles.borderOverlay, focused && styles.borderOverlayFocused]} pointerEvents="none" />

          {/* Per-card feedback while the pressed card's destination loads:
              the title bar becomes a sweeping gold progress fill. Mounted only
              around a press (visible lingers past the handoff fade) — idle
              cards carry no overlay. */}
          {navBarVisible ? <CardNavProgress active={navigating} title={folder.Name || "Folder"} /> : null}
        </View>
      </View>
    </TouchableOpacity>
  );
});

function arePropsEqual(prev: FolderGridItemProps, next: FolderGridItemProps): boolean {
  return (
    prev.folder.Id === next.folder.Id &&
    prev.folder.Name === next.folder.Name &&
    prev.folder.ChildCount === next.folder.ChildCount &&
    prev.folder.RecursiveItemCount === next.folder.RecursiveItemCount &&
    prev.folder.ImageTags?.Primary === next.folder.ImageTags?.Primary &&
    prev.folder.PrimaryImageAspectRatio === next.folder.PrimaryImageAspectRatio &&
    prev.index === next.index &&
    prev.onPress === next.onPress &&
    prev.onLongPress === next.onLongPress &&
    prev.onItemFocus === next.onItemFocus &&
    prev.onItemBlur === next.onItemBlur &&
    prev.onFocusedGone === next.onFocusedGone &&
    prev.hasTVPreferredFocus === next.hasTVPreferredFocus &&
    prev.highlighted === next.highlighted &&
    prev.nextFocusUp === next.nextFocusUp &&
    prev.nextFocusDown === next.nextFocusDown &&
    prev.slotOrientation === next.slotOrientation &&
    prev.numColumns === next.numColumns &&
    prev.cardWidth === next.cardWidth &&
    prev.cardHeight === next.cardHeight &&
    prev.fitArtwork === next.fitArtwork
  );
}

export const FolderGridItem = React.memo(FolderGridItemComponent, arePropsEqual);

const styles = StyleSheet.create({
  container: {
    // width is set inline (100/columns% derived from the slot orientation)
    padding: CARD_PADDING,
  },
  card: {
    borderRadius: DESIGN.BORDER_RADIUS_CARD,
    // Solid background so iOS derives the focus glow from the rounded rect
    // (a transparent background forces expensive per-pixel shadow tracing).
    // No overflow:hidden here — it would clip the glow; the image is already
    // clipped by imageContainer.
    backgroundColor: COLORS.SURFACE_SUNKEN,
    shadowColor: CARD_DEPTH.SHADOW_COLOR,
    shadowOffset: IS_TV ? CARD_DEPTH.SHADOW_OFFSET.tv : CARD_DEPTH.SHADOW_OFFSET.phone,
    shadowOpacity: CARD_DEPTH.SHADOW_OPACITY,
    shadowRadius: IS_TV ? CARD_DEPTH.SHADOW_RADIUS.tv : CARD_DEPTH.SHADOW_RADIUS.phone,
    elevation: CARD_DEPTH.ELEVATION,
  },
  // Overrides every resting shadow prop — a leftover depth offset would smear the glow downward.
  cardFocused: {
    shadowColor: CARD_FOCUS.GLOW_COLOR,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: CARD_FOCUS.GLOW_OPACITY,
    shadowRadius: IS_TV ? CARD_FOCUS.GLOW_RADIUS.tv : CARD_FOCUS.GLOW_RADIUS.phone,
    elevation: CARD_FOCUS.GLOW_ELEVATION,
  },
  imageContainer: {
    width: "100%",
    // aspectRatio set inline from the slot orientation (portrait 2:3 / landscape 16:9)
    borderRadius: DESIGN.BORDER_RADIUS_CARD,
    overflow: "hidden",
    backgroundColor: COLORS.SURFACE_SUNKEN,
    // Center an orientation-mismatched image in the slot (no-op when it fills it).
    justifyContent: "center",
    alignItems: "center",
  },
  borderOverlay: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    borderRadius: DESIGN.BORDER_RADIUS_CARD,
    borderWidth: CARD_FOCUS.BORDER_WIDTH,
    borderColor: CARD_FOCUS.BORDER_COLOR,
  },
  borderOverlayFocused: {
    borderWidth: CARD_FOCUS.BORDER_WIDTH_FOCUSED,
    borderColor: CARD_FOCUS.BORDER_COLOR_FOCUSED,
  },
  poster: {
    width: "100%",
    height: "100%",
  },
  // Raised off the card colour, unlike the artwork cards' fill. At #1C1C1E on a #141414 canvas the
  // imageless card read as a hole in the grid rather than as something you can open, which it is.
  placeholderPoster: {
    width: "100%",
    height: "100%",
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: COLORS.SURFACE_RAISED,
    padding: IS_TV ? 20 : 12,
  },
  countBadge: {
    position: "absolute",
    top: CARD_BADGE_INSET,
    left: CARD_BADGE_INSET,
  },
  // Thin frosted sliver at the very bottom showing just the title.
  infoOverlay: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    paddingVertical: IS_TV ? 10 : 8,
    paddingHorizontal: IS_TV ? 16 : 14,
    overflow: "hidden",
    justifyContent: "center",
    alignItems: "center",
    borderBottomLeftRadius: DESIGN.BORDER_RADIUS_CARD,
    borderBottomRightRadius: DESIGN.BORDER_RADIUS_CARD,
  },
  infoOverlayFocused: {
    backgroundColor: CARD_FOCUS.TITLE_BG_FOCUSED,
  },
  // Resting bar: fully opaque so the title's contrast never depends on the art.
  infoOverlayDark: {
    backgroundColor: COLORS.SURFACE_SUNKEN,
  },
  // Flush left on phone: touch has no marquee (MarqueeText only scrolls on TV focus), so long
  // library names always ellipsize, and a ragged tail reads better from a fixed left edge.
  folderName: {
    color: COLORS.TEXT_PRIMARY,
    fontSize: TITLE_SIZE,
    fontWeight: "700",
    textAlign: IS_TV ? "center" : "left",
    width: "100%",
  },
  folderNameFocused: {
    color: CARD_FOCUS.TITLE_TEXT_FOCUSED,
  },
  folderNameGold: {
    color: COLORS.ACCENT,
  },
});
