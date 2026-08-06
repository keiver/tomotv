import { CardBadge } from "@/components/card-badge";
import { CardNavProgress } from "@/components/card-nav-progress";
import { CARD_FOCUS, DESIGN, GRID, slotColumns, slotRatio, type SlotOrientation } from "@/constants/app";
import { useCardNavProgress } from "@/hooks/useCardNavProgress";
import { getFolderThumbnailUrl } from "@/services/jellyfinApi";
import { JellyfinItem } from "@/types/jellyfin";
import { BlurView } from "expo-blur";
import { Image } from "expo-image";
import { Ionicons } from "@expo/vector-icons";
import React, { forwardRef, useCallback, useMemo, useState } from "react";
import { Platform, StyleSheet, TouchableOpacity, View } from "react-native";
import { MarqueeText } from "./MarqueeText";

const IS_TV = Platform.isTV;
const CARD_PADDING = IS_TV ? 16 : 6;
const POSTER_SIZE = IS_TV ? 300 : 200;

interface FolderGridItemProps {
  folder: JellyfinItem;
  onPress: (folder: JellyfinItem) => void;
  index: number;
  onItemFocus?: (folder: JellyfinItem, index: number) => void;
  hasTVPreferredFocus?: boolean;
  /** Native node tag to focus when Up is pressed (top-row cards target the Filters button). */
  nextFocusUp?: number;
  /** Slot shape of the grid this card lives in (drives card aspect ratio + column width). */
  slotOrientation?: SlotOrientation;
  /** Live column count from the host grid (orientation-aware). Falls back to the static count. */
  numColumns?: number;
}

const FolderGridItemComponent = forwardRef<React.ElementRef<typeof TouchableOpacity>, FolderGridItemProps>(function FolderGridItemComponent(
  { folder, onPress, index, onItemFocus, hasTVPreferredFocus = false, nextFocusUp, slotOrientation = "portrait", numColumns },
  ref,
) {
  const [focused, setFocused] = useState(false);
  const { navigating, startNavProgress, resetNavProgress } = useCardNavProgress();

  // Stable cache key (id + image tag + size) keeps the disk/memory cache hot across
  // reloads and token changes — independent of the api_key in the URL.
  const thumbnailSource = useMemo(
    () => (folder.ImageTags?.Primary ? { uri: getFolderThumbnailUrl(folder.Id, POSTER_SIZE), cacheKey: `${folder.Id}-${folder.ImageTags.Primary}-${POSTER_SIZE}` } : undefined),
    [folder.Id, folder.ImageTags?.Primary],
  );

  const slotIsLandscape = slotOrientation === "landscape";

  // The art fills the slot when their orientations match; otherwise it renders
  // uncropped and centered in the slot (landscape art in a portrait slot →
  // centered band; portrait art in a landscape slot → centered column).
  const imageStyle = useMemo(() => {
    const ratio = folder.PrimaryImageAspectRatio;
    const imageIsLandscape = ratio !== undefined && ratio >= 1;
    if (imageIsLandscape === slotIsLandscape) return styles.poster;
    if (imageIsLandscape) return [styles.posterTop, { aspectRatio: ratio }];
    return [styles.posterCenter, { aspectRatio: ratio ?? GRID.PORTRAIT_RATIO }];
  }, [folder.PrimaryImageAspectRatio, slotIsLandscape]);

  const handleFocus = useCallback(() => {
    setFocused(true);
    onItemFocus?.(folder, index);
  }, [onItemFocus, folder, index]);

  const handleBlur = useCallback(() => {
    setFocused(false);
    resetNavProgress();
  }, [resetNavProgress]);

  const handlePress = useCallback(() => {
    startNavProgress();
    onPress(folder);
  }, [onPress, folder, startNavProgress]);

  const isFavorite = !!folder.UserData?.IsFavorite;

  // Recursive count when the server provides it; ChildCount (direct children) is the
  // fallback for types excluded from recursive counts (e.g. channel-sourced folders).
  // || (not ??) so a server-side 0 falls through instead of rendering a "0" badge.
  const itemCount = folder.RecursiveItemCount || folder.ChildCount;

  return (
    <TouchableOpacity
      ref={ref}
      onPress={handlePress}
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
      style={[styles.container, { width: `${100 / (numColumns ?? slotColumns(slotOrientation, IS_TV))}%` }]}
      accessibilityLabel={folder.Name || "Folder"}
      accessibilityRole="button"
      accessibilityHint={itemCount ? `Navigate to ${folder.Name} with ${itemCount} ${itemCount === 1 ? "item" : "items"}` : `Navigate to ${folder.Name}`}>
      <View style={[styles.card, focused && styles.cardFocused]}>
        <View style={[styles.imageContainer, { aspectRatio: slotRatio(slotOrientation) }]}>
          {thumbnailSource ? (
            <Image
              source={thumbnailSource}
              style={imageStyle}
              contentFit="cover"
              contentPosition="top center"
              transition={0}
              priority={index < 10 ? "high" : "normal"}
              cachePolicy="memory-disk"
              recyclingKey={folder.Id}
            />
          ) : (
            <View style={styles.placeholderPoster}>
              <Ionicons name="folder" size={IS_TV ? 80 : 50} color="#FFC312" />
            </View>
          )}

          {/* Item-count badge (top-left) */}
          {itemCount ? <CardBadge label={itemCount} /> : null}

          {/* Favorite heart (top-right) — driven by server UserData */}
          {isFavorite ? (
            <View style={styles.favoriteBadge} pointerEvents="none">
              <Ionicons name="heart" size={IS_TV ? 22 : 14} color="#FFC312" />
            </View>
          ) : null}

          {/* Frosted title sliver at the very bottom */}
          {/* Focused: opaque gold bar (a backgroundColor on the BlurView composites
              with its dark tint and muddies the gold, killing text contrast) */}
          {focused ? (
            <View style={[styles.infoOverlay, styles.infoOverlayFocused]}>
              <MarqueeText active={focused} style={StyleSheet.flatten([styles.folderName, styles.folderNameFocused])}>
                {folder.Name}
              </MarqueeText>
            </View>
          ) : (
            <BlurView intensity={IS_TV ? 60 : 40} style={styles.infoOverlay} tint="dark">
              <MarqueeText active={focused} style={styles.folderName}>
                {folder.Name}
              </MarqueeText>
            </BlurView>
          )}

          <View style={[styles.borderOverlay, focused && styles.borderOverlayFocused]} pointerEvents="none" />

          {/* Per-card feedback while the pressed card's destination loads:
              the title bar becomes a sweeping gold progress fill. */}
          <CardNavProgress active={navigating} title={folder.Name || "Folder"} />
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
    prev.onItemFocus === next.onItemFocus &&
    prev.hasTVPreferredFocus === next.hasTVPreferredFocus &&
    prev.nextFocusUp === next.nextFocusUp &&
    prev.slotOrientation === next.slotOrientation &&
    prev.numColumns === next.numColumns
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
    backgroundColor: "#1C1C1E",
  },
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
    backgroundColor: "#1C1C1E",
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
  // Landscape art in a portrait slot: full width, natural height, centered by the container.
  posterTop: {
    width: "100%",
  },
  // Portrait art in a landscape slot: full height, centered by the container.
  posterCenter: {
    height: "100%",
  },
  placeholderPoster: {
    width: "100%",
    height: "100%",
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "#1C1C1E",
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
  folderName: {
    color: "#FFFFFF",
    fontSize: IS_TV ? 22 : 13,
    fontWeight: "700",
    textAlign: "center",
  },
  folderNameFocused: {
    color: CARD_FOCUS.TITLE_TEXT_FOCUSED,
  },
});
