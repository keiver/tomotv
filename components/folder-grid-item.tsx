import { CARD_BADGE_INSET, CardBadge, showsFavoriteHeart } from "@/components/card-badge";
import { CardMetaLine } from "@/components/card-meta-line";
import { CardPressBurst, CardPressFlash } from "@/components/card-press-burst";
import { PosterCollage } from "@/components/poster-collage";
import { CARD_DEPTH, CARD_FOCUS, cardSlotRatio, DESIGN, RAISED_EDGE, slotColumns, type SlotOrientation } from "@/constants/app";
import { COLORS } from "@/constants/colors";
import { useCardNavProgress } from "@/hooks/useCardNavProgress";
import { useCardPalette } from "@/hooks/useCardPalette";
import { useFolderPreview } from "@/hooks/useFolderPreview";
import { useViewItemCount } from "@/hooks/useViewItemCount";
import { folderPosterSource } from "@/services/itemArtwork";
import { t } from "@/services/i18n";
import { cleanLabel } from "@/utils/cleanLabel";
import { JellyfinItem } from "@/types/jellyfin";
import { Image } from "expo-image";
import { Ionicons } from "@expo/vector-icons";
import React, { forwardRef, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Platform, StyleSheet, TouchableOpacity, View } from "react-native";

const IS_TV = Platform.isTV;
const CARD_PADDING = IS_TV ? 16 : 8;
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
  /** The Live TV view while the server records a channel: a REC pill in the top-right corner. */
  recording?: boolean;
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
    recording = false,
  },
  ref,
) {
  const palette = useCardPalette();
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
        onFocusedGoneRef.current?.();
      }
    },

    [],
  );

  // What the server gives the folder. With nothing, the card shows a collage of its first videos.
  const thumbnailSource = useMemo(() => folderPosterSource(folder, POSTER_SIZE), [folder]);
  const preview = useFolderPreview(folder, !thumbnailSource);

  // The card's slot ratio (see cardSlotRatio — shared with the row packer so rendered and
  // allocated widths agree). The art always cover-fills the slot — a crop beats a letterbox.
  const cardRatio = cardSlotRatio(fitArtwork, folder.PrimaryImageAspectRatio, slotOrientation);

  const folderName = cleanLabel(folder.Name);
  const favorite = showsFavoriteHeart(folder);

  // The Live TV view counts channels, and its empty face is a set, not a folder.
  const isLiveTv = folder.CollectionType === "livetv";

  const handleFocus = useCallback(() => {
    wasFocusedRef.current = true;
    setPressFocused(true);
    onItemFocus?.(folder, index);
  }, [onItemFocus, folder, index]);

  const handleBlur = useCallback(() => {
    wasFocusedRef.current = false;
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
  // shows as 0. Library views carry no inline count: theirs streams in lazily, and the
  // line names the folder alone until it lands.
  const { count: lazyCount } = useViewItemCount(folder);
  const itemCount = (folder.RecursiveItemCount || (folder.ChildCount ?? folder.RecursiveItemCount)) ?? lazyCount;
  const metaText = itemCount != null ? `${itemCount} · ${folderName}` : folderName;
  // The heart, then the monitor glyph that names the count, lead the line.
  const metaLead =
    favorite || itemCount != null
      ? (color: string, size: number) => (
          <>
            {favorite ? (
              <>
                <Ionicons name="heart" size={size} color={color} />{" "}
              </>
            ) : null}
            {itemCount != null ? (
              <>
                <Ionicons name="desktop-outline" size={size} color={color} />{" "}
              </>
            ) : null}
          </>
        )
      : undefined;

  return (
    <TouchableOpacity
      ref={ref}
      onPress={handlePress}
      onLongPress={onLongPress ? handleLongPress : undefined}
      onFocus={handleFocus}
      onBlur={handleBlur}
      // Touch: a held press shows the same focus treatment the TV focus engine drives
      // (gold border, glow, brighter line). TV keeps onFocus/onBlur only.
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
      accessibilityLabel={folderName || t("a11y.folder")}
      accessibilityRole="button"
      accessibilityHint={
        itemCount != null
          ? (itemCount === 1 ? t("a11y.folderItemOne") : t("a11y.folderItemMany")).replace("{name}", folderName).replace("{count}", String(itemCount))
          : t("a11y.folderNav").replace("{name}", folderName)
      }>
      <View style={[styles.card, focused && [styles.cardFocused, { shadowColor: palette.accent }]]}>
        <View style={[styles.imageContainer, { aspectRatio: cardRatio }]}>
          {thumbnailSource ? (
            <Image source={thumbnailSource} style={styles.poster} contentFit="cover" transition={0} priority={index < 10 ? "high" : "normal"} cachePolicy="memory-disk" recyclingKey={folder.Id} />
          ) : preview.length > 0 ? (
            <PosterCollage items={preview} height={POSTER_SIZE} deferWhileVideo />
          ) : (
            <View style={styles.placeholderPoster}>
              <Ionicons name={isLiveTv ? "tv-outline" : "folder-outline"} size={IS_TV ? 90 : 56} color="rgba(255, 255, 255, 0.45)" />
            </View>
          )}

          {navBarVisible ? <CardPressFlash active={navigating} /> : null}

          {recording ? (
            <View style={styles.recBadge} pointerEvents="none">
              <CardBadge segments={[{ icon: "videocam-outline", label: t("liveTv.rec") }]} focused={focused} tone="live" />
            </View>
          ) : null}

          <View style={[styles.borderOverlay, focused && [styles.borderOverlayFocused, { borderColor: palette.accent }]]} pointerEvents="none" />
        </View>
        {/* Mounted only around a press (visible lingers past the arrival burst); idle cards carry none. */}
        {navBarVisible ? <CardPressBurst active={navigating} /> : null}
        <CardMetaLine text={metaText || t("a11y.folder")} focused={focused} centered={IS_TV} lead={metaLead} />
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
    prev.folder.SeriesId === next.folder.SeriesId &&
    prev.folder.SeriesPrimaryImageTag === next.folder.SeriesPrimaryImageTag &&
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
    prev.recording === next.recording &&
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
  // The glow's colour is the theme's, set inline.
  cardFocused: {
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
    boxShadow: RAISED_EDGE,
  },
  // An inset shadow paints inside the border, so under the gold ring it reads as a second one.
  borderOverlayFocused: {
    borderWidth: CARD_FOCUS.BORDER_WIDTH_FOCUSED,
    boxShadow: "none",
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
  recBadge: {
    position: "absolute",
    top: CARD_BADGE_INSET,
    right: CARD_BADGE_INSET,
  },
  // Opaque sliver at the very bottom showing just the title.
});
