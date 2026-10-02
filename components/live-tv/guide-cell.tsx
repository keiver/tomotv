import { GuideFocusReel } from "@/components/live-tv/guide-focus-reel";
import { useGuideChannelFocus } from "@/hooks/useGuideChannelFocus";
import { GuideCellQuietLine } from "@/components/live-tv/guide-cell-quiet-line";
import { DESIGN } from "@/constants/app";
import { COLORS } from "@/constants/colors";
import type { JellyfinProgram } from "@/types/jellyfin";
import { cleanLabel } from "@/utils/cleanLabel";
import { pinOffset, pinRightOffset } from "@/components/live-tv/guide-pin";
import { formatClock, guideMetrics, programCategory, programTimes, standInChannelId, TICK_MINUTES } from "@/utils/guide";
import { serverPoster } from "@/services/itemArtwork";
import { liveFrameReel, subscribeLiveFrame } from "@/services/liveFrames";
import { t } from "@/services/i18n";
import { Image } from "expo-image";
import { Ionicons } from "@expo/vector-icons";
import React, { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { findNodeHandle, LayoutChangeEvent, Platform, Pressable, Animated as RNAnimated, StyleSheet, Text, useAnimatedValue, View } from "react-native";
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from "react-native-reanimated";

const IS_TV = Platform.isTV;
const NO_INFO = /^\s*no info(rmation)?( available)?\s*$/i;
/** The grid's line, the same the ruler and the channel column draw. */
export const GRID_LINE = "rgba(255, 255, 255, 0.14)";

const AnimatedPressable = RNAnimated.createAnimatedComponent(Pressable);
/** The first half hour of a cell is text alone: the art is clipped out of it, so a short cell shows none. */
const PX_PER_MINUTE = guideMetrics(IS_TV).pxPerMinute;
const ART_START = PX_PER_MINUTE * TICK_MINUTES;
/** The art fades into the cell across its whole width, so the text reads over it. */
const ART_FADE = "linear-gradient(to right, " + COLORS.BACKGROUND + " 0%, rgba(20, 20, 20, 0) 100%)";
/** Darkens the floor up to the art's edge, so the fade's black never starts on a line. */
const ART_LEAD = "linear-gradient(to right, rgba(20, 20, 20, 0) 0%, " + COLORS.BACKGROUND + " 100%)";
/** A deeper black than the art's fade, so a scrimmed label still reads apart from the neighbouring cell's floor. */
const SCRIM_FADE = "linear-gradient(to right, " + COLORS.BACKGROUND_DEEP + " 0%, rgba(13, 13, 15, 0) 100%)";
/** The poster steps back while the channel's grabbed frames show over it. */
const ART_UNDER_REEL_OPACITY = 0.12;
const TEXT_SHADOW = { textShadowColor: "rgba(0, 0, 0, 0.8)", textShadowOffset: { width: 0, height: 1 }, textShadowRadius: IS_TV ? 4 : 3 } as const;
/** The corner box: one line, a sliver of padding, its bottom rule. */
const SEEN_LINE = IS_TV ? 16 : 10;
const SEEN_PAD = IS_TV ? 2 : 1;
const SEEN_BOX_HEIGHT = SEEN_LINE + 2 * SEEN_PAD + 1;
const LABEL_PAD_LEFT = IS_TV ? 16 : 10;
const LABEL_PAD_RIGHT = IS_TV ? 14 : 8;
const RING_WIDTH = IS_TV ? 2 : 1;
export type RecordingMark = "single" | "series" | null;

interface GuideCellProps {
  program: JellyfinProgram;
  left: number;
  width: number;
  height: number;
  nowMs: number;
  recording: RecordingMark;
  /** The canvas's native-driven horizontal offset; the label rides it so it stays on the visible edge. */
  scrollX: RNAnimated.Value;
  viewportWidth?: number;
  /** The poster loads only while this holds; the canvas sets it for the cells in view once scrolling settles. */
  showArt?: boolean;
  onPress: (program: JellyfinProgram) => void;
  onLongPress: (program: JellyfinProgram) => void;
  onFocus?: (program: JellyfinProgram) => void;
  onBlur?: (program: JellyfinProgram) => void;
  /** Reports the native node, so a neighbouring row can name this cell as its focus target. */
  onHandle?: (programId: string, handle: number | undefined) => void;
  nextFocusUp?: number;
  nextFocusDown?: number;
  hasTVPreferredFocus?: boolean;
}

/**
 * One program on the guide canvas. The label is the focusable, not the cell: a cell can be wider
 * than the screen, and the focus engine moves and scrolls by the focused frame. Focus is a gold
 * wash, no scale (grid rule); a past cell dims its text.
 */
function GuideCellComponent({
  program,
  left,
  width,
  height,
  nowMs,
  recording,
  scrollX,
  viewportWidth,
  showArt = true,
  onPress,
  onLongPress,
  onFocus,
  onBlur,
  onHandle,
  nextFocusUp,
  nextFocusDown,
  hasTVPreferredFocus = false,
}: GuideCellProps) {
  const { startMs, endMs } = programTimes(program);
  const programName = cleanLabel(program.Name);
  const episodeTitle = cleanLabel(program.EpisodeTitle);
  // The stand-in of a channel without listings: a quiet band, one dim line, no slot times.
  const standInChannel = standInChannelId(program.Id);
  const standIn = standInChannel !== null;
  // The reel also unrolls while the row's channel card holds focus over in the column.
  const cardFocused = useGuideChannelFocus(standInChannel ?? program.ChannelId);
  // One line under the titles: the slot, then whatever the guide source filled in.
  // A guide's "no info available" placeholder gets no slot of its own.
  const meta = [`${formatClock(startMs)} – ${formatClock(endMs)}`, programCategory(program), program.OfficialRating, program.Genres?.[0]].filter((part) => part && !NO_INFO.test(part)).join("  ·  ");
  const art = showArt && program.Id && program.ImageTags?.Primary ? serverPoster(program.Id, program.ImageTags.Primary, height * 2) : undefined;
  // The art box is the picture's own shape at the cell's height, cut down to what fits past the
  // text; the picture keeps its right end, and the fade spans the box so the bleed starts at its edge.
  const artWidth = Math.min(Math.round(height * (program.PrimaryImageAspectRatio || 16 / 9)), Math.max(0, width - ART_START));
  const artShown = art !== undefined && artWidth > 0;
  const artLead = Math.min(artWidth, width - artWidth);
  const past = endMs <= nowMs;
  // A node, not state: a measured width that re-rendered the cell doubled every mount.
  const labelWidth = useAnimatedValue(0);
  const [focused, setFocused] = useState(false);
  const reelChannel = !standIn && program.ChannelId && startMs <= nowMs && nowMs < endMs ? program.ChannelId : null;
  const seenChannel = standInChannel ?? reelChannel;
  const subscribeReel = useCallback((listener: () => void) => (seenChannel ? subscribeLiveFrame(seenChannel, listener) : () => undefined), [seenChannel]);
  // When this device grabbed the shown frames, 0 while none show; the guide carries no such time.
  const readReel = useCallback(() => {
    const reel = seenChannel ? liveFrameReel(seenChannel) : undefined;
    return reel && reel.frames.length > 0 ? reel.at : 0;
  }, [seenChannel]);
  const seenAt = useSyncExternalStore(subscribeReel, readReel);
  const reelShown = seenAt > 0;
  const [seenLead, seenTail] = t("liveTv.lastSeen").split("{time}");
  const artOpacity = useSharedValue(1);
  useEffect(() => {
    artOpacity.set(withTiming(reelShown ? ART_UNDER_REEL_OPACITY : 1, { duration: 200 }));
  }, [artOpacity, reelShown]);
  const artStyle = useAnimatedStyle(() => ({ opacity: artOpacity.value }));
  const handleLabelLayout = useCallback((event: LayoutChangeEvent) => labelWidth.setValue(event.nativeEvent.layout.width), [labelWidth]);
  const pinStyle = useMemo(() => ({ transform: [{ translateX: pinOffset(scrollX, left, width, labelWidth) }] }), [scrollX, left, width, labelWidth]);
  const seenPinStyle = useMemo(() => (viewportWidth ? { transform: [{ translateX: pinRightOffset(scrollX, left, width, viewportWidth) }] } : undefined), [scrollX, left, width, viewportWidth]);
  const programId = program.Id;
  const handleRef = useCallback(
    (node: View | null) => {
      if (!IS_TV || !onHandle || !programId) return;
      onHandle(programId, node ? (findNodeHandle(node) ?? undefined) : undefined);
    },
    [onHandle, programId],
  );
  const handleFocus = useCallback(() => {
    setFocused(true);
    onFocus?.(program);
  }, [onFocus, program]);
  const handleBlur = useCallback(() => {
    setFocused(false);
    onBlur?.(program);
  }, [onBlur, program]);
  const press = useCallback(() => onPress(program), [onPress, program]);
  const longPress = useCallback(() => onLongPress(program), [onLongPress, program]);

  return (
    <Pressable isTVSelectable={false} onPress={press} onLongPress={longPress} style={[styles.cell, standIn && styles.cellQuiet, { left, width, height }]}>
      {/* Bled in from the right, full height in its own shape, kept out of the first half hour. */}
      {artShown ? (
        <Animated.View style={[styles.art, { width: artWidth }, artStyle]} pointerEvents="none" testID="guide-cell-art">
          <View style={[styles.artLead, { width: artLead }]} testID="guide-cell-art-lead" />
          <View style={styles.artClip}>
            <Image source={art} style={styles.artImage} contentFit="cover" contentPosition="right" transition={150} />
            <View style={styles.artFade} />
          </View>
        </Animated.View>
      ) : null}
      {/* Any row wears its reel whenever a burst exists, resting faded and brightening on the row's
          focus. A programme gets the compact strip only while it airs: history under a future slot would lie. */}
      {standInChannel ? (
        <View style={styles.reelClip} pointerEvents="none">
          <GuideFocusReel channelId={standInChannel} left={left} width={width} cellHeight={height} scrollX={scrollX} viewportWidth={viewportWidth} active={focused || cardFocused} />
        </View>
      ) : reelChannel ? (
        <View style={styles.reelClip} pointerEvents="none">
          <GuideFocusReel channelId={reelChannel} left={left} width={width} cellHeight={height} scrollX={scrollX} viewportWidth={viewportWidth} active={focused || cardFocused} compact />
        </View>
      ) : null}
      {/* A box set into the cell's top right corner, the cell's own edges closing it: when this device grabbed the frames.
          A cell running past the screen holds it on the screen's right edge. */}
      {reelShown ? (
        <RNAnimated.View style={[styles.seenBox, seenPinStyle]} pointerEvents="none" testID="guide-cell-seen">
          <Text style={styles.seenText} numberOfLines={1}>
            {seenLead}
            {seenTail === undefined ? null : <Text style={styles.seenTime}>{formatClock(seenAt)}</Text>}
            {seenTail}
          </Text>
        </RNAnimated.View>
      ) : null}
      {/* Before the label in the tree, so it never sits over the focusable (tvOS occlusion). */}
      {focused ? <View style={styles.focusRing} pointerEvents="none" /> : null}
      <AnimatedPressable
        ref={handleRef}
        onPress={press}
        onLongPress={longPress}
        onFocus={handleFocus}
        onBlur={handleBlur}
        onLayout={handleLabelLayout}
        isTVSelectable
        hasTVPreferredFocus={hasTVPreferredFocus}
        nextFocusUp={nextFocusUp}
        nextFocusDown={nextFocusDown}
        tvParallaxProperties={{ enabled: false }}
        accessibilityRole="button"
        accessibilityLabel={episodeTitle ? `${programName}, ${episodeTitle}` : programName}
        style={[styles.label, pinStyle]}>
        {/* Full height behind the pinned text, so a cell scrolled down to its tail never sets it on the poster.
            Off under grabbed frames: the poster is already faded and the reel strip runs under the label. */}
        {artShown && !reelShown ? (
          <View style={[styles.scrim, focused && styles.scrimFocused]} pointerEvents="none" testID="guide-cell-scrim">
            <View style={[styles.scrimTail, { width }]} testID="guide-cell-scrim-tail" />
          </View>
        ) : null}
        {standInChannel ? (
          <GuideCellQuietLine channelId={standInChannel} programName={programName} episodeTitle={episodeTitle} focused={focused} />
        ) : (
          <View style={styles.text}>
            <View style={styles.titleRow}>
              {recording ? <View style={styles.recordingDot} testID="guide-cell-recording" /> : null}
              {recording === "series" ? <Ionicons name="repeat" size={IS_TV ? 20 : 13} color={COLORS.DESTRUCTIVE_SOFT} testID="guide-cell-series" /> : null}
              <Text style={[styles.title, past && styles.textPast]} numberOfLines={1}>
                {programName}
              </Text>
            </View>
            {episodeTitle ? (
              <Text style={[styles.subtitle, past && styles.textPast]} numberOfLines={1}>
                {episodeTitle}
              </Text>
            ) : null}
            <Text style={[styles.meta, past && styles.textPast]} numberOfLines={1}>
              {meta}
            </Text>
          </View>
        )}
      </AnimatedPressable>
    </Pressable>
  );
}

export const GuideCell = React.memo(GuideCellComponent);

const styles = StyleSheet.create({
  // The right line is the cell's own; the bottom line is the row's, in the 1px strip below the
  // cell, so the focus guide nextFocusDown places there has it to itself.
  cell: {
    position: "absolute",
    top: 0,
    backgroundColor: COLORS.SURFACE,
    borderRightWidth: 1,
    borderColor: GRID_LINE,
  },
  // Its own view, not the cell's border (that would nudge the label), spanning both grid lines so it
  // meets the ruler's marks; the cell leaves it unclipped for the previous cell's line.
  focusRing: {
    position: "absolute",
    top: 0,
    left: -1,
    right: -1,
    bottom: 0,
    borderWidth: RING_WIDTH,
    borderColor: COLORS.ACCENT,
  },
  art: {
    position: "absolute",
    top: 0,
    right: 0,
    bottom: 0,
  },
  artClip: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    overflow: "hidden",
  },
  artLead: {
    position: "absolute",
    top: 0,
    bottom: 0,
    right: "100%",
    experimental_backgroundImage: ART_LEAD,
  },
  artImage: {
    width: "100%",
    height: "100%",
  },
  artFade: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    experimental_backgroundImage: ART_FADE,
  },
  // Full cell height so a vertical move reveals the whole row; only as wide as its text.
  label: {
    alignSelf: "flex-start",
    height: "100%",
    maxWidth: "100%",
    paddingLeft: LABEL_PAD_LEFT,
    paddingRight: LABEL_PAD_RIGHT,
    // The same band above the title on every row, with or without the corner box, so the text lines up.
    paddingTop: Math.round(((SEEN_BOX_HEIGHT + (IS_TV ? 6 : 3)) * 2) / 3),
  },
  text: {
    gap: IS_TV ? 4 : 2,
  },
  // Black under the label, trailing off across a cell's width.
  scrim: {
    position: "absolute",
    top: 0,
    bottom: 0,
    left: RING_WIDTH - 1,
    right: 0,
    backgroundColor: COLORS.BACKGROUND_DEEP,
  },
  // The ring sits behind the label: the scrim clears its top and bottom lines.
  scrimFocused: {
    top: RING_WIDTH,
    bottom: RING_WIDTH,
  },
  scrimTail: {
    position: "absolute",
    top: 0,
    bottom: 0,
    left: "100%",
    experimental_backgroundImage: SCRIM_FADE,
  },
  meta: {
    color: COLORS.TEXT_TERTIARY,
    fontSize: IS_TV ? 17 : 10,
    ...TEXT_SHADOW,
  },
  // Flush in the corner: the cell's top edge and its right line are its other two sides.
  seenBox: {
    position: "absolute",
    top: 0,
    right: 0,
    paddingHorizontal: IS_TV ? 8 : 5,
    paddingVertical: SEEN_PAD,
    borderBottomWidth: 1,
    borderLeftWidth: 1,
    borderColor: GRID_LINE,
    backgroundColor: COLORS.SURFACE_SUNKEN,
  },
  seenText: {
    color: COLORS.TEXT_SECONDARY,
    fontSize: IS_TV ? 13 : 8,
    lineHeight: SEEN_LINE,
    fontWeight: "600",
    letterSpacing: IS_TV ? 0.8 : 0.4,
    textTransform: "uppercase",
  },
  // The ruler's now label ink.
  seenTime: {
    color: COLORS.ACCENT,
  },
  titleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: IS_TV ? 8 : 5,
  },
  title: {
    color: COLORS.TEXT_PRIMARY,
    fontSize: IS_TV ? 24 : 13,
    fontWeight: "600",
    flexShrink: 1,
    ...TEXT_SHADOW,
  },
  subtitle: {
    color: COLORS.TEXT_SECONDARY,
    fontSize: IS_TV ? 19 : 11,
    ...TEXT_SHADOW,
  },
  textPast: {
    opacity: 0.5,
  },
  cellQuiet: {
    backgroundColor: COLORS.SURFACE_SUNKEN,
  },
  reelClip: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    overflow: "hidden",
  },
  recordingDot: {
    width: IS_TV ? 12 : 8,
    height: IS_TV ? 12 : 8,
    borderRadius: DESIGN.BORDER_RADIUS_ROUND,
    backgroundColor: COLORS.DESTRUCTIVE,
  },
});
