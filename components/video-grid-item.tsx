import { CardBadge } from "@/components/card-badge";
import { CardNavProgress } from "@/components/card-nav-progress";
import { CardScrim } from "@/components/card-scrim";
import { CARD_FOCUS, cardSlotRatio, DESIGN, slotColumns, type SlotOrientation } from "@/constants/app";
import { useCardNavProgress } from "@/hooks/useCardNavProgress";
import { getPosterUrl, hasPoster, isAudioItem, isPhoto } from "@/services/jellyfinApi";
import { JellyfinVideoItem } from "@/types/jellyfin";
import { formatSeasonEpisode } from "@/utils/seasonEpisode";
import { Ionicons } from "@expo/vector-icons";
import { Image } from "expo-image";
import React, { forwardRef, useCallback, useMemo, useState } from "react";
import { Platform, StyleSheet, TouchableOpacity, View } from "react-native";
import { MarqueeText } from "./MarqueeText";

// Cache platform values at module level for better performance
const IS_TV = Platform.isTV;
const CARD_PADDING = IS_TV ? 16 : 6;
// The title bar's own padding, and how far past the card's bottom edge the bar hangs. The
// overhang is clipped by the image container, and it is what puts the bar's fill UNDER the
// card's border instead of level with it — flush, the border painted a lighter band across the
// bar's last 2pt that read as a gap beneath the title.
const BAR_PADDING_V = IS_TV ? 10 : 6;
const BAR_DROP = 2;
const POSTER_SIZE = IS_TV ? 300 : 200; // Optimized for memory

interface VideoGridItemProps {
  video: JellyfinVideoItem;
  onPress: (video: JellyfinVideoItem) => void;
  /** Optional long-press handler (e.g. to prompt removal). */
  onLongPress?: (video: JellyfinVideoItem) => void;
  index: number;
  onItemFocus?: (video: JellyfinVideoItem, index: number) => void;
  hasTVPreferredFocus?: boolean;
  nextFocusUp?: number;
  /** Down target for a card stranded above a partial last row (see library-grid.tsx). */
  nextFocusDown?: number;
  /** Resume progress as a 0–1 fraction. When set (> 0), renders a bottom progress bar. */
  progressPercent?: number;
  /** Fixed card width in px. When set, overrides the default grid-column width (used in horizontal rows). */
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
  /** Slot shape of the grid this card lives in (drives card aspect ratio + column width). */
  slotOrientation?: SlotOrientation;
  /** Live column count from the host grid (orientation-aware). Falls back to the static count. */
  numColumns?: number;
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
  {
    video,
    onPress,
    onLongPress,
    index,
    onItemFocus,
    hasTVPreferredFocus = false,
    nextFocusUp,
    nextFocusDown,
    progressPercent,
    cardWidth,
    cardHeight,
    fitArtwork = false,
    slotOrientation = "portrait",
    numColumns,
  },
  ref,
) {
  const [focused, setFocused] = useState(false);
  const { navigating, visible: navBarVisible, startNavProgress, resetNavProgress } = useCardNavProgress();

  // Poster source with a STABLE cache key: keyed by item id + image tag + size,
  // independent of the ApiKey/token in the URL. This keeps the disk/memory cache
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
  const isPlayed = !!video.UserData?.Played;

  // Keyed on the parse inputs, not the item object: annotation passes rebuild
  // item objects without touching these fields, and must not re-parse every card.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const seasonEpisode = useMemo(() => formatSeasonEpisode(video), [video.Name, video.Path, video.IndexNumber, video.ParentIndexNumber, video.Type]);

  // The card's slot ratio (see cardSlotRatio — shared with the row packer so rendered and
  // allocated widths agree). The art always cover-fills the slot — a crop beats a letterbox.
  const cardRatio = cardSlotRatio(fitArtwork, video.PrimaryImageAspectRatio, slotOrientation);

  // Focus handlers - no animations
  const handleFocus = useCallback(() => {
    setFocused(true);
    onItemFocus?.(video, index);
  }, [onItemFocus, video, index]);

  const handleBlur = useCallback(() => {
    setFocused(false);
    resetNavProgress();
  }, [resetNavProgress]);

  const handlePress = useCallback(() => {
    startNavProgress();
    onPress(video);
  }, [onPress, video, startNavProgress]);

  const handleLongPress = useCallback(() => {
    onLongPress?.(video);
  }, [onLongPress, video]);

  // Any card GIVEN a progress value is a resume card and shows the bar — even
  // at 0 (a just-started video whose position hasn't synced yet). The fill is
  // floored at 5% below so "just starting" is always visible; grids that pass
  // no progressPercent are unaffected.
  const hasProgress = progressPercent != null;
  const watchedPercent = hasProgress ? Math.round(Math.min(Math.max(progressPercent, 0), 1) * 100) : 0;

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
      accessible={true}
      // The card is ONE element to assistive tech (accessible flattens the
      // subtree): name as the label, watched progress as the VALUE — screen
      // readers announce "Name, 42% watched, button" and re-announce the value
      // if it changes, without the name/percent fused into one string.
      accessibilityLabel={video.Name || "Video"}
      accessibilityValue={hasProgress ? { min: 0, max: 100, now: watchedPercent, text: `${watchedPercent}% watched` } : undefined}
      accessibilityRole="button"
      accessibilityHint={IS_TV ? (hasProgress ? "Press to resume playback" : "Press to play") : hasProgress ? "Double tap to resume playback" : "Double tap to play this video"}
      style={[
        styles.container,
        cardWidth != null
          ? { width: cardWidth }
          : cardHeight != null
            ? { width: (cardHeight - 2 * CARD_PADDING) * cardRatio + 2 * CARD_PADDING }
            : { width: `${100 / (numColumns ?? slotColumns(slotOrientation, IS_TV))}%` },
      ]}>
      <View style={[styles.card, focused && styles.cardFocused]}>
        <View style={[styles.imageContainer, { aspectRatio: cardRatio }]}>
          {posterSource ? (
            <>
              <Image
                source={posterSource}
                style={styles.poster}
                contentFit="cover"
                contentPosition="top center"
                transition={0}
                priority={index < 10 ? "high" : "normal"}
                cachePolicy="memory-disk" // Keep decoded posters in memory + disk so they don't re-decode/flash on reload
                recyclingKey={video.Id} // Helps with memory recycling
                accessible={true}
                accessibilityLabel={`${video.Name || "Video"} poster`}
              />
              <CardScrim />
            </>
          ) : (
            // No artwork: the brand face (layer-front) on the dark card fill,
            // same mark the Top Shelf placeholder uses. The title lives in the
            // bottom bar (always rendered), same as postered cards.
            <View style={styles.placeholderPoster}>
              <Image source={require("@/assets/brand/layer-front.png")} style={styles.placeholderFace} contentFit="cover" transition={0} />
            </View>
          )}

          {/* Opaque dark title bar at the very bottom — one treatment for every card */}
          {/* Progress cards (Continue Watching): the title bar IS the progress
              indicator — a gold fill behind the title marks the watched
              fraction (floored at 5% so a barely-started video still shows).
              Rendered regardless of poster: a posterless placeholder card
              still owes the user its progress. The bar is identical in both
              focus states; border/glow/marquee do the identifying. The gold
              title composites with difference blending, so it self-inverts to
              black exactly where the fill passes under it and stays gold over
              the dark remainder — the old manual white→black focus switch,
              now per-pixel and automatic. */}
          {hasProgress ? (
            // Opaque bar, not a BlurView: the poster tinting through a blur
            // feeds the difference blend a variable backdrop, so the title
            // color would drift with the artwork. Two fixed inputs (solid
            // dark, solid gold) give exactly two fixed outputs.
            //
            // The whole bar is decorative to assistive tech: the card element
            // already announces the name (label) and progress (value), so the
            // visual duplicate is hidden to avoid double-reading.
            <View style={[styles.infoOverlay, styles.infoOverlayDark]} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
              <View style={[styles.infoProgressFill, { width: `${Math.max(watchedPercent, 5)}%` }]} pointerEvents="none" />
              <View style={styles.infoTitleBlend}>
                <MarqueeText active={focused} style={StyleSheet.flatten([styles.infoValueTitle, styles.infoValueTitleGold])}>
                  {video?.Name || "Unknown"}
                </MarqueeText>
              </View>
            </View>
          ) : // Focused: opaque gold bar
          focused ? (
            <View style={[styles.infoOverlay, styles.infoOverlayFocused]}>
              <MarqueeText active={focused} style={StyleSheet.flatten([styles.infoValueTitle, styles.infoValueTitleFocused])}>
                {video?.Name || "Unknown"}
              </MarqueeText>
            </View>
          ) : (
            <View style={[styles.infoOverlay, styles.infoOverlayDark]}>
              <MarqueeText active={focused} style={StyleSheet.flatten([styles.infoValueTitle, styles.infoValueTitleGold])}>
                {video?.Name || "Unknown"}
              </MarqueeText>
            </View>
          )}

          {/* Season/episode tag (top-left) — server metadata or parsed from the name/filename.
              Without one, the badge carries the media kind instead: audio, photo, or video. */}
          {seasonEpisode ? <CardBadge label={seasonEpisode} /> : <CardBadge icon={isAudioItem(video) ? "musical-notes" : isPhoto(video) ? "image" : "film"} />}

          {/* Top-right chips: watched checkmark, then the favorite heart (rightmost, its
              usual corner spot). Both from server UserData plus the session overrides. */}
          {isPlayed || isFavorite ? (
            <View style={styles.topRightBadges} pointerEvents="none">
              {isPlayed ? (
                <View style={styles.badgeDisc}>
                  <Ionicons name="checkmark" size={IS_TV ? 22 : 14} color="#34C759" />
                </View>
              ) : null}
              {isFavorite ? (
                <View style={styles.badgeDisc}>
                  <Ionicons name="heart" size={IS_TV ? 22 : 14} color="#FFC312" />
                </View>
              ) : null}
            </View>
          ) : null}

          {/* Border overlay - rendered on top to avoid gaps */}
          <View style={[styles.borderOverlay, focused && styles.borderOverlayFocused]} pointerEvents="none" />

          {/* Per-card feedback while the pressed card's destination loads:
              the title bar becomes a sweeping gold progress fill. Resume
              cards start the sweep from their watched fraction. Mounted only
              around a press (visible lingers past the handoff fade) — idle
              cards carry no overlay. */}
          {navBarVisible ? <CardNavProgress active={navigating} title={video?.Name || "Unknown"} startFraction={hasProgress ? watchedPercent / 100 : undefined} /> : null}
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
    // Favorite state drives the heart overlay AND the long-press toggle label. Without it the memo
    // bails on a same-Id refetch, keeping a stale UserData that makes the alert always say "Mark as".
    prevProps.video.UserData?.IsFavorite === nextProps.video.UserData?.IsFavorite &&
    // Played drives the checkmark chip; annotation passes flip it on same-Id items.
    prevProps.video.UserData?.Played === nextProps.video.UserData?.Played &&
    // Season/episode drive the top-left tag; a same-Id refetch can fill them in
    // (Path included: the tag can come from the filename).
    prevProps.video.IndexNumber === nextProps.video.IndexNumber &&
    prevProps.video.ParentIndexNumber === nextProps.video.ParentIndexNumber &&
    prevProps.video.Path === nextProps.video.Path &&
    prevProps.index === nextProps.index &&
    prevProps.onPress === nextProps.onPress &&
    prevProps.onLongPress === nextProps.onLongPress &&
    prevProps.onItemFocus === nextProps.onItemFocus &&
    prevProps.hasTVPreferredFocus === nextProps.hasTVPreferredFocus &&
    prevProps.nextFocusUp === nextProps.nextFocusUp &&
    prevProps.nextFocusDown === nextProps.nextFocusDown &&
    prevProps.progressPercent === nextProps.progressPercent &&
    prevProps.cardWidth === nextProps.cardWidth &&
    prevProps.cardHeight === nextProps.cardHeight &&
    prevProps.fitArtwork === nextProps.fitArtwork &&
    prevProps.slotOrientation === nextProps.slotOrientation &&
    prevProps.numColumns === nextProps.numColumns
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
  // Anchors the status chips to the top-right corner of the card.
  topRightBadges: {
    position: "absolute",
    top: IS_TV ? 16 : 10,
    right: IS_TV ? 16 : 10,
    flexDirection: "row",
    gap: IS_TV ? 8 : 5,
    alignItems: "center",
  },
  // Shared chip disc (checkmark, heart). Dark translucent so the glyph stays legible over any poster.
  badgeDisc: {
    width: IS_TV ? 40 : 26,
    height: IS_TV ? 40 : 26,
    borderRadius: IS_TV ? 20 : 13,
    backgroundColor: "rgba(0, 0, 0, 0.45)",
    justifyContent: "center",
    alignItems: "center",
  },
  // The watched fraction, drawn as the title bar's own background: a solid
  // gold fill spanning `width` percent of the bar, clipped by the bar's
  // rounded bottom corners (infoOverlay has overflow: hidden). Full gold in
  // both focus states — the difference-blended title keeps itself legible
  // over it, so no dimming is needed.
  //
  // minWidth clears the rounded bottom-left corner: the 32px TV radius clips
  // anything narrower into an invisible curved wedge, which made a
  // just-started video (5% ≈ 20px) look like it had no progress at all.
  infoProgressFill: {
    position: "absolute",
    top: 0,
    bottom: 0,
    left: 0,
    minWidth: DESIGN.BORDER_RADIUS_CARD + (IS_TV ? 20 : 12),
    backgroundColor: "#FFC312",
  },
  placeholderPoster: {
    width: "100%",
    height: "100%",
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "#2C2C2E", // Elevated card color - matches design system
  },
  placeholderFace: {
    width: "100%",
    height: "100%",
  },
  // Thin frosted sliver at the very bottom showing just the title.
  infoOverlay: {
    position: "absolute",
    bottom: -BAR_DROP,
    left: 0,
    right: 0,
    // The drop is added back as bottom padding: the clipped overhang would otherwise take it out
    // of the visible band and leave the title sitting low in the bar. Grown at the bottom, not
    // split evenly, since that is the end the clip eats.
    paddingTop: BAR_PADDING_V,
    paddingBottom: BAR_PADDING_V + BAR_DROP,
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
  // Resting bar, every card: fully opaque so the title's contrast never depends
  // on the poster, and the CW difference-blended title sees a constant backdrop
  // (difference(gold, this) reads gold; difference(gold, fill) is black).
  infoOverlayDark: {
    backgroundColor: "#1C1C1E",
  },
  // Flush left on phone: touch has no marquee (MarqueeText only scrolls on TV focus), so long
  // names always ellipsize, and a ragged tail reads better from a fixed left edge than centred.
  infoValueTitle: {
    color: "#FFFFFF",
    fontSize: IS_TV ? 22 : 13,
    fontWeight: "700",
    textAlign: IS_TV ? "center" : "left",
    width: "100%",
  },
  infoValueTitleFocused: {
    color: CARD_FOCUS.TITLE_TEXT_FOCUSED,
  },
  // Gold resting title. On progress cards it runs through a difference blend:
  // difference(gold, gold fill) cancels to black; difference(gold, dark bar)
  // stays gold — the text inverts per-pixel at the fill edge, whatever
  // fraction of it the fill covers, including mid-marquee.
  infoValueTitleGold: {
    color: "#FFC312",
  },
  infoTitleBlend: {
    width: "100%",
    mixBlendMode: "difference",
  },
});
