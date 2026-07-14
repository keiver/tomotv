import { CARD_FOCUS, DESIGN, GRID, slotColumns, slotRatio, type SlotOrientation } from "@/constants/app";
import { getPosterUrl, hasPoster } from "@/services/jellyfinApi";
import { JellyfinVideoItem } from "@/types/jellyfin";
import { Ionicons } from "@expo/vector-icons";
import { BlurView } from "expo-blur";
import { Image } from "expo-image";
import React, { forwardRef, useCallback, useMemo, useState } from "react";
import { Platform, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { MarqueeText } from "./MarqueeText";

// Cache platform values at module level for better performance
const IS_TV = Platform.isTV;
const CARD_PADDING = IS_TV ? 16 : 8;
const POSTER_SIZE = IS_TV ? 300 : 200; // Optimized for memory

interface VideoGridItemProps {
  video: JellyfinVideoItem;
  onPress: (video: JellyfinVideoItem) => void;
  /** Optional long-press handler (e.g. to prompt removal). */
  onLongPress?: (video: JellyfinVideoItem) => void;
  index: number;
  onItemFocus?: (video: JellyfinVideoItem) => void;
  hasTVPreferredFocus?: boolean;
  nextFocusUp?: number;
  /** Resume progress as a 0–1 fraction. When set (> 0), renders a bottom progress bar. */
  progressPercent?: number;
  /** Fixed card width in px. When set, overrides the default grid-column width (used in horizontal rows). */
  cardWidth?: number;
  /** Slot shape of the grid this card lives in (drives card aspect ratio + column width). */
  slotOrientation?: SlotOrientation;
}

/**
 * VideoGridItem Component - Highly Optimized
 *
 * Performance optimizations:
 * - React.memo with custom comparison to prevent unnecessary re-renders
 * - Reduced poster image size (400px vs 600px)
 * - No animations for instant response
 * - Conditional image priority (first 10 only)
 * - No image transitions for instant display
 * - Platform values cached at module level
 */
const VideoGridItemComponent = forwardRef<React.ElementRef<typeof TouchableOpacity>, VideoGridItemProps>(function VideoGridItemComponent(
  { video, onPress, onLongPress, index, onItemFocus, hasTVPreferredFocus = false, nextFocusUp, progressPercent, cardWidth, slotOrientation = "portrait" },
  ref,
) {
  const [focused, setFocused] = useState(false);

  // Poster source with a STABLE cache key: keyed by item id + image tag + size,
  // independent of the api_key/token in the URL. This keeps the disk/memory cache
  // hot across reloads and token changes (no re-download, no flash), while still
  // invalidating when the server image actually changes (the tag is a content hash).
  const posterSource = useMemo(() => {
    if (!hasPoster(video)) return undefined;
    return {
      uri: getPosterUrl(video.Id, POSTER_SIZE),
      cacheKey: `${video.Id}-${video.ImageTags?.Primary}-${POSTER_SIZE}`,
    };
  }, [video]);

  const isFavorite = !!video.UserData?.IsFavorite;

  const slotIsLandscape = slotOrientation === "landscape";

  // The image fills the slot when their orientations match; otherwise it renders
  // uncropped (landscape image in a portrait slot → top band; portrait image in a
  // landscape slot → centered).
  const imageStyle = useMemo(() => {
    const ratio = video.PrimaryImageAspectRatio;
    const imageIsLandscape = ratio !== undefined && ratio >= 1;
    if (imageIsLandscape === slotIsLandscape) return styles.poster;
    if (imageIsLandscape) return [styles.posterTop, { aspectRatio: ratio }];
    return [styles.posterCenter, { aspectRatio: ratio ?? GRID.PORTRAIT_RATIO }];
  }, [video.PrimaryImageAspectRatio, slotIsLandscape]);

  // Focus handlers - no animations
  const handleFocus = useCallback(() => {
    setFocused(true);
    onItemFocus?.(video);
  }, [onItemFocus, video]);

  const handleBlur = useCallback(() => {
    setFocused(false);
  }, []);

  const handlePress = useCallback(() => {
    onPress(video);
  }, [onPress, video]);

  const handleLongPress = useCallback(() => {
    onLongPress?.(video);
  }, [onLongPress, video]);

  return (
    <TouchableOpacity
      ref={ref}
      onPress={handlePress}
      onLongPress={onLongPress ? handleLongPress : undefined}
      onFocus={handleFocus}
      onBlur={handleBlur}
      activeOpacity={0.95}
      isTVSelectable={true}
      hasTVPreferredFocus={hasTVPreferredFocus}
      nextFocusUp={nextFocusUp}
      accessible={true}
      accessibilityLabel={progressPercent != null && progressPercent > 0 ? `${video.Name || "Video"}, ${Math.round(Math.min(progressPercent, 1) * 100)} percent watched` : video.Name || "Video"}
      accessibilityRole="button"
      accessibilityHint="Double tap to play this video"
      style={[styles.container, cardWidth != null ? { width: cardWidth } : { width: `${100 / slotColumns(slotOrientation, IS_TV)}%` }]}>
      <View style={[styles.card, focused && styles.cardFocused]}>
        <View style={[styles.imageContainer, { aspectRatio: slotRatio(slotOrientation) }, slotIsLandscape && styles.imageContainerCenter]}>
          {posterSource ? (
            <Image
              source={posterSource}
              style={imageStyle}
              contentFit="cover"
              contentPosition="top center"
              transition={0}
              priority={index < 10 ? "high" : "normal"}
              cachePolicy="memory-disk" // Keep decoded posters in memory + disk so they don't re-decode/flash on reload
              recyclingKey={video.Id} // Helps with memory recycling
              accessible={true}
              accessibilityLabel={`${video.Name || "Video"} poster`}
            />
          ) : (
            <View style={styles.placeholderPoster}>
              <Text style={styles.placeholderText} numberOfLines={1}>
                {video?.Name || "Unknown"}
              </Text>
            </View>
          )}

          {/* Thin frosted title sliver at the very bottom */}
          {/* Focused: opaque gold bar (a backgroundColor on the BlurView composites
              with its dark tint and muddies the gold, killing text contrast) */}
          {posterSource &&
            (focused ? (
              <View style={[styles.infoOverlay, styles.infoOverlayFocused]}>
                <MarqueeText active={focused} style={StyleSheet.flatten([styles.infoValueTitle, styles.infoValueTitleFocused])}>
                  {video?.Name || "Unknown"}
                </MarqueeText>
              </View>
            ) : (
              <BlurView intensity={IS_TV ? 60 : 40} style={styles.infoOverlay} tint="dark">
                <MarqueeText active={focused} style={styles.infoValueTitle}>
                  {video?.Name || "Unknown"}
                </MarqueeText>
              </BlurView>
            ))}

          {/* Resume progress bar - only on Continue Watching cards */}
          {progressPercent != null && progressPercent > 0 && (
            <View style={[styles.progressTrack, focused && styles.progressTrackFocused]} pointerEvents="none">
              <View style={[styles.progressFill, focused && styles.progressFillFocused, { width: `${Math.min(progressPercent, 1) * 100}%` }]} />
            </View>
          )}

          {/* Border overlay - rendered on top to avoid gaps */}
          <View style={[styles.borderOverlay, focused && styles.borderOverlayFocused]} pointerEvents="none" />
        </View>
      </View>
    </TouchableOpacity>
  );
});

/**
 * Custom comparison function for React.memo
 * Only re-render when video.Id or index changes
 * Removed checks for RunTimeTicks and MediaStreams since we compute lazily now
 */
function arePropsEqual(prevProps: VideoGridItemProps, nextProps: VideoGridItemProps): boolean {
  return (
    prevProps.video.Id === nextProps.video.Id &&
    prevProps.video.Name === nextProps.video.Name &&
    prevProps.video.ImageTags?.Primary === nextProps.video.ImageTags?.Primary &&
    prevProps.video.PrimaryImageAspectRatio === nextProps.video.PrimaryImageAspectRatio &&
    prevProps.index === nextProps.index &&
    prevProps.onPress === nextProps.onPress &&
    prevProps.onLongPress === nextProps.onLongPress &&
    prevProps.onItemFocus === nextProps.onItemFocus &&
    prevProps.hasTVPreferredFocus === nextProps.hasTVPreferredFocus &&
    prevProps.nextFocusUp === nextProps.nextFocusUp &&
    prevProps.progressPercent === nextProps.progressPercent &&
    prevProps.cardWidth === nextProps.cardWidth &&
    prevProps.slotOrientation === nextProps.slotOrientation
  );
}

// Export memoized component
export const VideoGridItem = React.memo(VideoGridItemComponent, arePropsEqual);

const styles = StyleSheet.create({
  container: {
    // width is set inline (cardWidth px, or 100/columns% derived from the slot)
    padding: CARD_PADDING,
  },
  card: {
    borderRadius: DESIGN.BORDER_RADIUS_CARD,
    // Solid background so iOS derives the focus glow from the rounded rect
    // (a transparent background forces expensive per-pixel shadow tracing).
    // No overflow:hidden here — it would clip the glow; the image is already
    // clipped by imageContainer.
    backgroundColor: "#2C2C2E",
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
    backgroundColor: "#2C2C2E",
  },
  imageContainerCenter: {
    // Landscape slots center their content (so a portrait image is centered, not top-pinned).
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
  // Landscape image in a portrait slot: full width, natural height, pinned to the top.
  posterTop: {
    width: "100%",
  },
  // Portrait image in a landscape slot: full height, natural width, centered by the container.
  posterCenter: {
    height: "100%",
  },
  progressTrack: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    height: IS_TV ? 6 : 4,
    backgroundColor: "rgba(0, 0, 0, 0.5)",
    overflow: "hidden",
  },
  // Focused: colors invert — black fill over the gold, so the bar stays put
  // and stays readable on the gold title bar. The focused border is thicker
  // and draws over the bar, so nudge the bar up by the difference to keep the
  // same visible height as the unfocused state.
  progressTrackFocused: {
    backgroundColor: CARD_FOCUS.TITLE_BG_FOCUSED,
    bottom: CARD_FOCUS.BORDER_WIDTH_FOCUSED - CARD_FOCUS.BORDER_WIDTH,
  },
  progressFill: {
    height: "100%",
    backgroundColor: "#FFC312",
  },
  progressFillFocused: {
    backgroundColor: "#000000",
  },
  placeholderPoster: {
    width: "100%",
    height: "100%",
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "#2C2C2E", // Elevated card color - matches design system
  },
  placeholderText: {
    color: "#98989D",
    fontSize: 16,
    fontWeight: "500",
    width: "90%",
    textAlign: "center",
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
    borderBottomLeftRadius: 32,
    borderBottomRightRadius: 32,
  },
  infoOverlayFocused: {
    backgroundColor: CARD_FOCUS.TITLE_BG_FOCUSED,
  },
  infoValueTitle: {
    color: "#FFFFFF",
    fontSize: IS_TV ? 22 : 13,
    fontWeight: "700",
    textAlign: "center",
    width: "100%",
  },
  infoValueTitleFocused: {
    color: CARD_FOCUS.TITLE_TEXT_FOCUSED,
  },
});
