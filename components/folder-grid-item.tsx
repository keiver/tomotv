import { CardBadge } from "@/components/card-badge";
import { CardNavProgress } from "@/components/card-nav-progress";
import { CardScrim } from "@/components/card-scrim";
import { CARD_DEPTH, CARD_FOCUS, cardSlotRatio, DESIGN, slotColumns, type SlotOrientation } from "@/constants/app";
import { COLORS } from "@/constants/colors";
import { useCardNavProgress } from "@/hooks/useCardNavProgress";
import { useViewItemCount } from "@/hooks/useViewItemCount";
import { getFolderThumbnailUrl } from "@/services/jellyfinApi";
import { JellyfinItem } from "@/types/jellyfin";
import { backkeyProbe } from "@/utils/backkeyProbe";
import { Image } from "expo-image";
import { Ionicons } from "@expo/vector-icons";
import React, { forwardRef, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Platform, StyleSheet, TouchableOpacity, View } from "react-native";
import { MarqueeText } from "./MarqueeText";

const IS_TV = Platform.isTV;
const CARD_PADDING = IS_TV ? 16 : 6;
const POSTER_SIZE = IS_TV ? 300 : 200;

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
  const [focused, setFocused] = useState(false);
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

  const handleFocus = useCallback(() => {
    wasFocusedRef.current = true;
    if (IS_TV) backkeyProbe("card native focus", { id: folder.Id, name: folder.Name });
    setFocused(true);
    onItemFocus?.(folder, index);
  }, [onItemFocus, folder, index]);

  const handleBlur = useCallback(() => {
    wasFocusedRef.current = false;
    if (IS_TV) backkeyProbe("card blur", { id: folder.Id, name: folder.Name });
    setFocused(false);
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

  const isFavorite = !!folder.UserData?.IsFavorite;

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
              <Image
                source={thumbnailSource}
                style={styles.poster}
                contentFit="cover"
                contentPosition="top center"
                transition={0}
                priority={index < 10 ? "high" : "normal"}
                cachePolicy="memory-disk"
                recyclingKey={folder.Id}
              />
              <CardScrim />
            </>
          ) : (
            <View style={styles.placeholderPoster}>
              <Ionicons name="folder-outline" size={IS_TV ? 90 : 56} color="rgba(255, 255, 255, 0.45)" />
            </View>
          )}

          {/* Item-count badge (top-left) */}
          {itemCount != null ? <CardBadge label={itemCount} /> : countLoading ? <CardBadge loading /> : null}

          {/* Favorite heart (top-right) — driven by server UserData */}
          {isFavorite ? (
            <View style={styles.favoriteBadge} pointerEvents="none">
              <Ionicons name="heart" size={IS_TV ? 22 : 14} color={COLORS.ACCENT} />
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
    prev.folder.UserData?.IsFavorite === next.folder.UserData?.IsFavorite &&
    prev.folder.ImageTags?.Primary === next.folder.ImageTags?.Primary &&
    prev.folder.PrimaryImageAspectRatio === next.folder.PrimaryImageAspectRatio &&
    prev.index === next.index &&
    prev.onPress === next.onPress &&
    prev.onLongPress === next.onLongPress &&
    prev.onItemFocus === next.onItemFocus &&
    prev.onItemBlur === next.onItemBlur &&
    prev.onFocusedGone === next.onFocusedGone &&
    prev.hasTVPreferredFocus === next.hasTVPreferredFocus &&
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
  // Favorite heart chip (top-right). Dark translucent disc keeps the gold heart legible over any art.
  favoriteBadge: {
    position: "absolute",
    top: IS_TV ? 16 : 10,
    right: IS_TV ? 16 : 10,
    width: IS_TV ? 40 : 26,
    height: IS_TV ? 40 : 26,
    borderRadius: IS_TV ? 20 : 13,
    backgroundColor: "rgba(0, 0, 0, 0.45)",
    justifyContent: "center",
    alignItems: "center",
  },
  // Thin frosted sliver at the very bottom showing just the title.
  infoOverlay: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    paddingVertical: IS_TV ? 10 : 6,
    paddingHorizontal: IS_TV ? 16 : 12,
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
    fontSize: IS_TV ? 22 : 13,
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
