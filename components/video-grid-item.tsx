import { type BadgeSegment, CARD_BADGE_INSET, CardBadge, showsFavoriteHeart } from "@/components/card-badge";
import { CardCornerNotch } from "@/components/card-corner-notch";
import { CardNavProgress } from "@/components/card-nav-progress";
import { CardStand } from "@/components/card-stand";
import { LevelBars } from "@/components/level-bars";
import { LiveClip } from "@/components/live-tv/live-clip";
import { LiveFreshnessBadge } from "@/components/live-tv/live-freshness-badge";
import { CARD_CHROME, CARD_DEPTH, CARD_FOCUS, cardPosterHeight, cardSlotRatio, DESIGN, GRID, RAISED_EDGE, slotColumns, STAND_HEIGHT, STAND_ROW_ROOM, type SlotOrientation } from "@/constants/app";
import { COLORS } from "@/constants/colors";
import { useCardNavProgress } from "@/hooks/useCardNavProgress";
import { useCardPalette } from "@/hooks/useCardPalette";
import { useCardZoom } from "@/hooks/useCardZoom";
import { useItemPoster } from "@/hooks/useItemPoster";
import { useMinuteClock } from "@/hooks/useMinuteClock";
import { useIsNowPlaying, useNowPlayingVideo, useOpenNowPlaying } from "@/hooks/useNowPlaying";
import { useNowPlayingProgress } from "@/hooks/useNowPlayingProgress";
import { t } from "@/services/i18n";
import { showsChannelLogo } from "@/services/itemArtwork";
import { isAudioItem, isBook } from "@/services/jellyfinApi";
import { LIVE_FRAME_TRANSITION_MS, type LiveFrame } from "@/services/liveFrames";
import { JellyfinVideoItem } from "@/types/jellyfin";
import { cleanLabel } from "@/utils/cleanLabel";
import { formatClock, formatDayLabel } from "@/utils/guide";
import { liveFrameBox, livePictureAspect, rememberLivePictureAspect } from "@/utils/liveFrameFit";
import { formatIndexBadge } from "@/utils/seasonEpisode";
import { Ionicons } from "@expo/vector-icons";
import { Image, type ImageLoadEventData } from "expo-image";
import React, { forwardRef, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { PixelRatio, Platform, StyleSheet, TouchableOpacity, View } from "react-native";

// Cache platform values at module level for better performance
const IS_TV = Platform.isTV;
const CARD_PADDING = IS_TV ? 16 : 8;
const BACKDROP_BLUR = IS_TV ? 24 : 16;

/** Badge pill contents: "S01E05" alone, or the disc (when past the first) beside the track. */
export function indexBadgeSegments(video: JellyfinVideoItem, nowMs: number = Date.now(), recording = false): BadgeSegment[] | null {
  // A channel's mark is the freshness badge, keyed to its own pictures, never a pill from here.
  if (video.Type === "TvChannel") return null;
  // A programme from search: NOW while it airs, when it starts before then, nothing once it ended. LIVE stays the
  // picture's claim. Recording, REC takes NOW's place and a scheduled start wears the camera.
  if (video.Type === "Program") {
    const startMs = Date.parse(video.StartDate ?? "");
    if (Number.isNaN(startMs)) return null;
    if (startMs <= nowMs) return Date.parse(video.EndDate ?? "") > nowMs ? [{ label: t(recording ? "liveTv.rec" : "liveTv.now") }] : null;
    const label = `${formatDayLabel(startMs, nowMs, { today: t("liveTv.today"), tomorrow: t("liveTv.tomorrow") })} ${formatClock(startMs)}`;
    return [recording ? { icon: "videocam", label } : { label }];
  }
  const segments: BadgeSegment[] = [];
  const badge = formatIndexBadge(video);
  if (badge !== null) {
    if (badge.kind !== "track") segments.push({ label: badge.label });
    else if (badge.disc !== null) segments.push({ icon: "disc", label: badge.disc }, { icon: "musical-note", label: badge.label });
    else segments.push({ icon: "musical-note", label: badge.label });
  }
  return segments.length > 0 ? segments : null;
}

/** Watched, as the title bar marks it; music stays out (every full listen marks a track played, which is noise, not state) and live cards never hold it. */
export function isWatched(video: Pick<JellyfinVideoItem, "Type" | "UserData">): boolean {
  return !!video.UserData?.Played && video.Type !== "Audio" && video.Type !== "TvChannel" && video.Type !== "Program";
}

/** A programme card names its episode after the show, and never the channel: a show named for its channel gives way to the episode. */
export function programCardTitle(video: Pick<JellyfinVideoItem, "Name" | "EpisodeTitle" | "ChannelName">): string {
  const show = cleanLabel(video.Name);
  const episode = cleanLabel(video.EpisodeTitle);
  return episode && show === cleanLabel(video.ChannelName) ? episode : joinTitle(show, episode);
}

/** "Lead - Detail", or the lead alone when the detail is missing or repeats it. */
export function joinTitle(lead: string, detail: string): string {
  return detail && detail !== lead ? `${lead} - ${detail}` : lead;
}

interface VideoGridItemProps {
  video: JellyfinVideoItem;
  onPress: (video: JellyfinVideoItem) => void;
  /** Optional long-press handler (e.g. to prompt removal). */
  onLongPress?: (video: JellyfinVideoItem) => void;
  index: number;
  onItemFocus?: (video: JellyfinVideoItem, index: number) => void;
  /** TV: focus left this card (grid focus bookkeeping; see library-grid's recovery). */
  onItemBlur?: (video: JellyfinVideoItem) => void;
  /** TV: this card unmounted while it held focus: its native view died under the viewer. */
  onFocusedGone?: () => void;
  hasTVPreferredFocus?: boolean;
  /** Wear the focus treatment with no touch on it, how the phone marks the "Show In Folder" target. */
  highlighted?: boolean;
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
  /** A mark drawn at the title's left end, where the now-playing bars sit; the placeholder face too. On a channel, inline before its name. */
  titleIcon?: keyof typeof Ionicons.glyphMap;
  /** Channel cards: title the card by the channel's name, never the airing programme. */
  hideAiring?: boolean;
  /** Channel cards: the latest frame of the channel; it fills the slot and the logo becomes a corner mark. */
  liveFrame?: { uri: string; cacheKey: string };
  /** Channel cards: the channel's preview clip file, looped over the frame while the card holds focus. */
  liveClip?: LiveFrame;
  /** Channel cards: plays the clip without the card's own focus, as when its guide row holds focus. */
  clipActive?: boolean;
  /** Channel cards: the frame wears the freshness badge; off, it is a still with no live mark. */
  liveMark?: boolean;
  /** Channel cards: the health check concluded down; the art dims and the corner badge says Offline. */
  offline?: boolean;
  /** Channel and programme cards: a timer covers it; REC takes LIVE's place, a scheduled programme's time wears the camera. */
  recording?: boolean;
  /** Guide channel cards: a 16:9 slot with no title bar, name or bottom wash over the live picture. */
  liveCard?: boolean;
  /** Live cards on the channel wall: the name sits on a stand under the card, led by the title mark. */
  stand?: boolean;
  /** Square corners, for a card that sits flush among the guide's square program cells. */
  square?: boolean;
  /** No resting depth shadow, for hosts that clip it; the focus glow stays. */
  flat?: boolean;
  /** Overrides the card's padding, for hosts that size the slot themselves. */
  inset?: { vertical: number; horizontal: number };
  /** Drawn only, never focused or pressed: the theme editor's preview. */
  inert?: boolean;
  /** A bundled picture (a require'd module) in place of the item's own: the theme editor's preview. */
  poster?: number;
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
    onItemBlur,
    onFocusedGone,
    hasTVPreferredFocus = false,
    highlighted = false,
    nextFocusUp,
    nextFocusDown,
    progressPercent,
    cardWidth,
    cardHeight,
    fitArtwork = false,
    slotOrientation = "portrait",
    numColumns,
    titleIcon,
    hideAiring = false,
    liveFrame,
    liveClip,
    clipActive = false,
    liveMark = true,
    offline = false,
    recording = false,
    liveCard = false,
    stand = false,
    square = false,
    flat = false,
    inset,
    inert = false,
    poster,
  },
  ref,
) {
  const palette = useCardPalette();
  const [pressFocused, setPressFocused] = useState(false);
  // Touch has no focus engine, so a card can only be marked from the outside.
  const focused = pressFocused || highlighted;
  // The playing track's card is marked, and select brings its native player back. Video stays
  // TV only: the re-push with adopt is the PiP restore path there.
  const nowPlayingAudio = useIsNowPlaying(video.Id);
  const nowPlayingVideo = useNowPlayingVideo(IS_TV ? video.Id : null);
  const nowPlaying = nowPlayingAudio || nowPlayingVideo.active;
  const openNowPlaying = useOpenNowPlaying();
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

  // The server poster, or the keyframe the engine makes for a card the server left blank.
  const posterSource = useItemPoster(video, cardPosterHeight(cardHeight, IS_TV, PixelRatio.get()), { deferWhileVideo: true });

  // Keyed on the parse inputs, not the item object: annotation passes rebuild
  // item objects without touching these fields, and must not re-parse every card.
  // A programme's badge follows the clock: it goes live at its start and clears at its end.
  const clockMs = useMinuteClock(video.Type === "Program");
  const badgeSegments = useMemo(
    () => indexBadgeSegments(video, clockMs || Date.now(), recording),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [video.Name, video.Path, video.IndexNumber, video.ParentIndexNumber, video.Type, video.StartDate, video.EndDate, video.UserData?.Played, clockMs, recording],
  );
  const isChannel = video.Type === "TvChannel";
  const logoPoster = showsChannelLogo(video) && !liveFrame;
  const airingName = isChannel && !hideAiring ? video.CurrentProgram?.Name?.trim() : undefined;
  // A channel card names what is on: the logo and the badge already say which channel.
  const videoName = cleanLabel(video.Name);
  const leadingMark = isChannel ? undefined : titleIcon;
  const cardTitle = cleanLabel(airingName) || (video.Type === "Program" ? programCardTitle(video) || t("common.unknown") : videoName || t("common.unknown"));

  // The card's slot ratio, shared with the row packer so rendered and allocated widths agree. The art
  // cover-fills the slot, except a live picture liveFrameBox keeps whole.
  const cardRatio = liveCard
    ? GRID.LIVE_RATIO
    : cardWidth != null && cardHeight != null
      ? (cardWidth - 2 * CARD_PADDING) / (cardHeight - 2 * CARD_PADDING)
      : cardSlotRatio(fitArtwork, video.PrimaryImageAspectRatio, slotOrientation);
  // The live picture's own shape, remembered per channel so a remounted card starts in place.
  const [pictureAspect, setPictureAspect] = useState(() => (liveCard ? livePictureAspect(video.Id) : undefined));
  const handleLiveFrameLoad = useCallback(
    ({ source }: ImageLoadEventData) => {
      if (source.width <= 0 || source.height <= 0) return;
      rememberLivePictureAspect(video.Id, source.width / source.height);
      setPictureAspect(source.width / source.height);
    },
    [video.Id],
  );
  const liveBox = liveCard && liveFrame ? liveFrameBox(pictureAspect, cardRatio) : null;
  const standed = liveCard && stand;
  const offlinePill = offline && !standed;

  // Focus handlers - no animations
  const handleFocus = useCallback(() => {
    wasFocusedRef.current = true;
    setPressFocused(true);
    onItemFocus?.(video, index);
  }, [onItemFocus, video, index]);

  const handleBlur = useCallback(() => {
    wasFocusedRef.current = false;
    setPressFocused(false);
    onItemBlur?.(video);
    resetNavProgress();
  }, [resetNavProgress, onItemBlur, video]);

  const handlePress = useCallback(() => {
    if (nowPlayingAudio || nowPlayingVideo.active) {
      openNowPlaying(video, nowPlayingAudio ? "audio" : "video");
      return;
    }
    startNavProgress();
    onPress(video);
  }, [onPress, video, startNavProgress, nowPlayingAudio, nowPlayingVideo.active, openNowPlaying]);

  const handleLongPress = useCallback(() => {
    onLongPress?.(video);
  }, [onLongPress, video]);

  // Any card GIVEN a progress value is a resume card and fills its base, even at 0 (a just-started
  // video whose position hasn't synced yet).
  const hasProgress = progressPercent != null;
  const watchedPercent = hasProgress ? Math.round(Math.min(Math.max(progressPercent, 0), 1) * 100) : 0;
  const nowPlayingProgress = useNowPlayingProgress(video, nowPlayingAudio ? "audio" : nowPlayingVideo.active ? "video" : null, progressPercent, nowPlayingVideo.playing);
  const standProgress = nowPlaying ? nowPlayingProgress.fraction : hasProgress ? watchedPercent / 100 : isWatched(video) ? 1 : null;
  // A logo card has no picture to age: NOW when the title names the airing programme, else the channel and its number.
  const logoTab = isChannel && !liveCard && !offlinePill && !recording && !liveFrame;
  const channelNow = logoTab && !!airingName;
  const channelNumber = video.ChannelNumber?.trim();
  const channelTab = channelNumber ? t("liveTv.channelNumber").replace("{number}", channelNumber) : t("liveTv.channel");
  const artBadge = channelNow ? [{ label: t("liveTv.now") }] : logoTab ? [{ label: channelTab }] : isChannel ? null : badgeSegments;
  const zoom = useCardZoom();
  // One mark before the name: the playing bars, else a passed icon, else the favorite heart (a channel's is passed in).
  const nameIcon = leadingMark ?? (isChannel ? titleIcon : showsFavoriteHeart(video) ? "heart" : undefined);
  const metaMark = nowPlaying
    ? (color: string) => <LevelBars size={(IS_TV ? 19 : 14) * zoom} playing={nowPlayingProgress.playing} color={color} />
    : nameIcon
      ? (color: string) => <Ionicons name={nameIcon} size={(IS_TV ? 18 : 13) * zoom} color={color} />
      : undefined;
  const depth = [styles.depth, flat && styles.cardFlat, focused && [styles.cardFocused, { shadowColor: palette.accent }]];
  const posterImage = (
    <Image
      source={liveFrame ?? poster ?? posterSource}
      style={[styles.poster, liveBox, logoPoster && styles.posterLogo, offline && styles.posterOffline]}
      onLoad={liveCard && liveFrame ? handleLiveFrameLoad : undefined}
      contentFit={logoPoster ? "contain" : "cover"}
      // A newer grab's frame fades in; at rest the card holds still.
      transition={liveFrame ? LIVE_FRAME_TRANSITION_MS : 0}
      priority={index < 10 ? "high" : "normal"}
      // A live frame is a local file a later grab replaces; nothing to keep on disk.
      cachePolicy={liveFrame ? "none" : "memory-disk"}
      recyclingKey={video.Id} // Helps with memory recycling
      accessible={true}
      accessibilityLabel={t("a11y.poster").replace("{name}", videoName || t("a11y.video"))}
    />
  );

  return (
    <TouchableOpacity
      ref={ref}
      onPress={handlePress}
      onLongPress={onLongPress ? handleLongPress : undefined}
      onFocus={handleFocus}
      onBlur={handleBlur}
      // Touch: a held press shows the same focus treatment the TV focus engine drives
      // (accent border, glow, accent base). TV keeps onFocus/onBlur only.
      onPressIn={IS_TV ? undefined : handleFocus}
      onPressOut={IS_TV ? undefined : handleBlur}
      activeOpacity={0.95}
      isTVSelectable={!inert}
      disabled={inert}
      hasTVPreferredFocus={hasTVPreferredFocus}
      nextFocusUp={nextFocusUp}
      nextFocusDown={nextFocusDown}
      accessible={!inert}
      // The card is ONE element to assistive tech (accessible flattens the
      // subtree): name as the label, watched progress or offline as the VALUE; screen
      // readers announce "Name, 42% watched, button" and re-announce the value
      // if it changes, without the name/percent fused into one string.
      accessibilityLabel={airingName ? cardTitle : videoName || t("a11y.video")}
      accessibilityValue={
        hasProgress ? { min: 0, max: 100, now: watchedPercent, text: t("a11y.percentWatched").replace("{percent}", String(watchedPercent)) } : offline ? { text: t("liveTv.offline") } : undefined
      }
      accessibilityRole="button"
      accessibilityHint={IS_TV ? (hasProgress ? t("a11y.pressToResume") : t("a11y.pressToPlay")) : hasProgress ? t("a11y.doubleTapResume") : t("a11y.doubleTapPlay")}
      style={[
        styles.container,
        cardWidth != null
          ? { width: cardWidth }
          : cardHeight != null
            ? { width: (cardHeight - 2 * CARD_PADDING) * cardRatio + 2 * CARD_PADDING }
            : { width: `${100 / (numColumns ?? slotColumns(slotOrientation, IS_TV))}%` },
        inset && { paddingVertical: inset.vertical, paddingHorizontal: inset.horizontal },
      ]}>
      <View style={[styles.card, IS_TV ? null : depth, square && styles.square, !liveCard && styles.cardOverhang]}>
        {/* TV: a solid layer behind the picture carries the depth, so the card stays clear for its base. */}
        {IS_TV ? <View style={[styles.depthLayer, depth, square && styles.square, !liveCard && !focused && styles.depthLayerArt]} pointerEvents="none" /> : null}
        <View style={[styles.imageContainer, { aspectRatio: cardRatio }, square && styles.square, (standed || !liveCard) && styles.squareBottom]}>
          {liveFrame || poster || posterSource ? (
            <>
              {liveBox ? (
                <>
                  <Image
                    source={liveFrame}
                    style={StyleSheet.absoluteFill}
                    contentFit="cover"
                    blurRadius={BACKDROP_BLUR}
                    transition={LIVE_FRAME_TRANSITION_MS}
                    cachePolicy="none"
                    recyclingKey={`${video.Id}-backdrop`}
                    accessible={false}
                  />
                  <View style={styles.backdropDim} pointerEvents="none" />
                </>
              ) : null}
              {posterImage}
              {(focused || clipActive) && liveFrame && liveClip ? <LiveClip clip={liveClip} style={liveBox ?? undefined} /> : null}
            </>
          ) : (
            // No artwork: a glyph for the item's kind on the dark card fill. The title
            // lives in the line under the card, same as postered cards.
            <View style={styles.placeholderPoster}>
              <Ionicons
                name={isChannel ? "tv-outline" : (titleIcon ?? (isAudioItem(video) ? "musical-note-outline" : isBook(video) ? "book-outline" : "tv-outline"))}
                size={IS_TV ? 90 : 56}
                color="rgba(255, 255, 255, 0.45)"
              />
            </View>
          )}

          {/* A live card names nothing over its picture; the bars alone mark it playing. */}
          {nowPlaying && liveCard ? (
            <View style={styles.liveNowPlaying} pointerEvents="none">
              <LevelBars size={IS_TV ? 20 : 12} playing={nowPlayingProgress.playing} />
            </View>
          ) : null}

          {offlinePill || (isChannel && (recording || (liveFrame ? liveMark : liveCard && airingName))) ? (
            <View style={[styles.indexBadge, liveCard && styles.indexBadgeChannel]} pointerEvents="none">
              {offlinePill ? (
                // A fact pill, not a broadcast mark: red stays for LIVE and REC.
                <CardBadge segments={[{ icon: "cloud-offline" }]} focused={focused} />
              ) : isChannel && recording ? (
                <CardBadge segments={[{ label: t("liveTv.rec") }]} focused={focused} tone="live" />
              ) : isChannel && liveFrame ? (
                <LiveFreshnessBadge channelId={video.Id} />
              ) : isChannel ? (
                <CardBadge segments={[{ label: t("liveTv.now") }]} focused={focused} tone="live" />
              ) : null}
            </View>
          ) : null}
          {artBadge && !offlinePill ? <CardCornerNotch segments={artBadge} tone={video.Type === "Program" || channelNow ? "live" : "plain"} focused={focused} /> : null}
          {/* The lit edge, on top so the art sits under it */}
          <View style={[styles.borderOverlay, focused && styles.borderOverlayFocused, square && styles.square, (standed || !liveCard) && styles.squareBottom]} pointerEvents="none" />
        </View>
        {/* Inside the card, under the picture's slot: the glow wraps both and the picture keeps its size. */}
        {standed ? (
          <View>
            <CardStand name={cardTitle} icon={titleIcon} focused={focused} offline={offline} liveChannelId={liveFrame && liveMark ? video.Id : undefined} />
            {navBarVisible ? <CardNavProgress active={navigating} title={cardTitle} stand baseColor={CARD_CHROME} /> : null}
          </View>
        ) : null}
        {/* Rendered regardless of poster: a posterless placeholder card still owes the user its progress. */}
        {liveCard ? null : (
          <View>
            <CardStand name={cardTitle} focused={focused} mark={metaMark} progress={standProgress} scrolls />
            {navBarVisible ? <CardNavProgress active={navigating} title={cardTitle} startFraction={hasProgress ? watchedPercent / 100 : undefined} stand baseColor={CARD_CHROME} /> : null}
          </View>
        )}
        {focused ? <View style={[styles.focusRing, { borderColor: palette.accent }, square && styles.square]} pointerEvents="none" /> : null}
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
    // Every input to the index badge; a same-Id refetch can fill them in (Path because
    // the tag can come from the filename, Type because it picks tag vs track number).
    prevProps.video.IndexNumber === nextProps.video.IndexNumber &&
    prevProps.video.ParentIndexNumber === nextProps.video.ParentIndexNumber &&
    prevProps.video.Path === nextProps.video.Path &&
    prevProps.video.Type === nextProps.video.Type &&
    // Played drives the watched segment; annotation passes flip it on same-Id items.
    prevProps.video.UserData?.Played === nextProps.video.UserData?.Played &&
    prevProps.video.UserData?.IsFavorite === nextProps.video.UserData?.IsFavorite &&
    prevProps.video.CurrentProgram?.Name === nextProps.video.CurrentProgram?.Name &&
    prevProps.index === nextProps.index &&
    prevProps.onPress === nextProps.onPress &&
    prevProps.onLongPress === nextProps.onLongPress &&
    prevProps.onItemFocus === nextProps.onItemFocus &&
    prevProps.onItemBlur === nextProps.onItemBlur &&
    prevProps.onFocusedGone === nextProps.onFocusedGone &&
    prevProps.hasTVPreferredFocus === nextProps.hasTVPreferredFocus &&
    prevProps.highlighted === nextProps.highlighted &&
    prevProps.nextFocusUp === nextProps.nextFocusUp &&
    prevProps.nextFocusDown === nextProps.nextFocusDown &&
    prevProps.progressPercent === nextProps.progressPercent &&
    prevProps.cardWidth === nextProps.cardWidth &&
    prevProps.cardHeight === nextProps.cardHeight &&
    prevProps.fitArtwork === nextProps.fitArtwork &&
    prevProps.slotOrientation === nextProps.slotOrientation &&
    prevProps.numColumns === nextProps.numColumns &&
    prevProps.titleIcon === nextProps.titleIcon &&
    prevProps.hideAiring === nextProps.hideAiring &&
    prevProps.liveFrame?.cacheKey === nextProps.liveFrame?.cacheKey &&
    prevProps.liveClip?.uri === nextProps.liveClip?.uri &&
    prevProps.clipActive === nextProps.clipActive &&
    prevProps.liveMark === nextProps.liveMark &&
    prevProps.offline === nextProps.offline &&
    prevProps.recording === nextProps.recording &&
    prevProps.liveCard === nextProps.liveCard &&
    prevProps.stand === nextProps.stand &&
    prevProps.square === nextProps.square &&
    prevProps.flat === nextProps.flat &&
    prevProps.inset?.vertical === nextProps.inset?.vertical &&
    prevProps.inset?.horizontal === nextProps.inset?.horizontal &&
    prevProps.inert === nextProps.inert &&
    prevProps.poster === nextProps.poster
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
  },
  depth: {
    borderRadius: DESIGN.BORDER_RADIUS_CARD,
    // Solid background so iOS derives the focus glow from the rounded rect
    // (a transparent background forces expensive per-pixel shadow tracing).
    // No overflow:hidden here: it would clip the glow; the image is already
    // clipped by imageContainer.
    backgroundColor: COLORS.SURFACE_SUNKEN,
    shadowColor: CARD_DEPTH.SHADOW_COLOR,
    shadowOffset: IS_TV ? CARD_DEPTH.SHADOW_OFFSET.tv : CARD_DEPTH.SHADOW_OFFSET.phone,
    shadowOpacity: CARD_DEPTH.SHADOW_OPACITY,
    shadowRadius: IS_TV ? CARD_DEPTH.SHADOW_RADIUS.tv : CARD_DEPTH.SHADOW_RADIUS.phone,
    elevation: CARD_DEPTH.ELEVATION,
  },
  cardFlat: {
    shadowOpacity: 0,
    elevation: 0,
  },
  depthLayer: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
  // At rest the layer stops at the art, leaving the base over the canvas.
  depthLayerArt: {
    bottom: STAND_HEIGHT,
  },
  // Overrides every resting shadow prop: a leftover depth offset would smear the glow downward.
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
    boxShadow: "none",
  },
  focusRing: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    borderRadius: DESIGN.BORDER_RADIUS_CARD,
    borderWidth: CARD_FOCUS.BORDER_WIDTH_FOCUSED,
  },
  poster: {
    width: "100%",
    height: "100%",
  },
  // A channel logo is a mark, not a picture: whole and centred, clear of the badges and the title bar.
  posterLogo: {
    width: "70%",
    height: "50%",
    alignSelf: "center",
  },
  posterOffline: {
    opacity: 0.4,
  },
  // Anchors the index pill to the top-left corner of the card.
  indexBadge: {
    position: "absolute",
    top: CARD_BADGE_INSET,
    left: CARD_BADGE_INSET,
    right: CARD_BADGE_INSET,
    flexDirection: "row",
    alignItems: "center",
    gap: IS_TV ? 8 : 5,
  },
  // A channel's mark tucks into the corner, off the channel's own logo.
  indexBadgeChannel: {
    top: CARD_BADGE_INSET - 2,
    left: CARD_BADGE_INSET - 2,
  },
  square: {
    borderRadius: 0,
  },
  squareBottom: {
    borderBottomLeftRadius: 0,
    borderBottomRightRadius: 0,
  },
  // Where rows keep no room for it (TV), the base hangs into the card's own bottom padding and the row's.
  cardOverhang: {
    marginBottom: STAND_ROW_ROOM - STAND_HEIGHT,
  },
  // Holds the blurred fill behind a whole picture under the sharp one.
  backdropDim: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: "rgba(0, 0, 0, 0.35)",
  },
  placeholderPoster: {
    width: "100%",
    height: "100%",
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: COLORS.SURFACE, // Elevated card color - matches design system
  },
  liveNowPlaying: {
    position: "absolute",
    left: CARD_BADGE_INSET,
    bottom: CARD_BADGE_INSET,
  },
});
