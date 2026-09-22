import { DESIGN } from "@/constants/app";
import { COLORS } from "@/constants/colors";
import type { JellyfinProgram } from "@/types/jellyfin";
import { formatClock, labelPin, programCategory, programTimes } from "@/utils/guide";
import { getPosterUrl } from "@/services/jellyfinApi";
import { Image } from "expo-image";
import { Ionicons } from "@expo/vector-icons";
import React, { useCallback, useState } from "react";
import { findNodeHandle, LayoutChangeEvent, Platform, Pressable, StyleSheet, Text, View } from "react-native";
import Animated, { SharedValue, useAnimatedStyle, useSharedValue, withTiming } from "react-native-reanimated";

const IS_TV = Platform.isTV;
/** The grid's line, the same the ruler and the channel column draw. */
export const GRID_LINE = "rgba(255, 255, 255, 0.14)";

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);
/** The art fades into the cell across its whole width, so the text reads over it. */
const ART_FADE = "linear-gradient(to right, " + COLORS.SURFACE + " 0%, rgba(44, 44, 46, 0) 100%)";
const ART_ZOOM = 1.08;
/** Rides under the label and past its right edge, so the text reads over art on a narrow cell. */
const TEXT_SCRIM = "linear-gradient(to right, rgba(44, 44, 46, 0.97) 0%, rgba(44, 44, 46, 0.85) 55%, rgba(44, 44, 46, 0.45) 80%, rgba(44, 44, 46, 0) 100%)";

export type RecordingMark = "single" | "series" | null;

interface GuideCellProps {
  program: JellyfinProgram;
  left: number;
  width: number;
  height: number;
  nowMs: number;
  recording: RecordingMark;
  /** The canvas's horizontal offset; the label rides it so it stays on the visible edge. */
  scrollX: SharedValue<number>;
  onPress: (program: JellyfinProgram) => void;
  onLongPress: (program: JellyfinProgram) => void;
  onFocus?: (program: JellyfinProgram) => void;
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
  onPress,
  onLongPress,
  onFocus,
  onHandle,
  nextFocusUp,
  nextFocusDown,
  hasTVPreferredFocus = false,
}: GuideCellProps) {
  const { startMs, endMs } = programTimes(program);
  // One line under the titles: the slot, then whatever the guide source filled in.
  const meta = [`${formatClock(startMs)} – ${formatClock(endMs)}`, programCategory(program), program.OfficialRating, program.Genres?.[0]].filter(Boolean).join("  ·  ");
  const art = program.Id && program.ImageTags?.Primary ? getPosterUrl(program.Id, height * 2) : null;
  // The art box is the picture's own shape at the cell's height, so cover fills it without a crop;
  // only a cell narrower than that cuts it, at the cell's left edge.
  const artWidth = Math.round(height * (program.PrimaryImageAspectRatio || 16 / 9));
  const past = endMs <= nowMs;
  const [labelWidth, setLabelWidth] = useState(0);
  const [focused, setFocused] = useState(false);
  // Focus zooms the art, not the cell: a cell can be wider than the screen, and scaling it would move its visible edge.
  const artZoom = useSharedValue(1);
  const artZoomStyle = useAnimatedStyle(() => ({ transform: [{ scale: artZoom.value }] }));
  const handleLabelLayout = useCallback((event: LayoutChangeEvent) => setLabelWidth(event.nativeEvent.layout.width), []);
  const pinStyle = useAnimatedStyle(() => ({ transform: [{ translateX: labelPin(scrollX.value, left, width, labelWidth) }] }), [left, width, labelWidth]);
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
    artZoom.set(withTiming(ART_ZOOM, { duration: 220 }));
    onFocus?.(program);
  }, [onFocus, program, artZoom]);
  const handleBlur = useCallback(() => {
    setFocused(false);
    artZoom.set(withTiming(1, { duration: 220 }));
  }, [artZoom]);
  const press = useCallback(() => onPress(program), [onPress, program]);
  const longPress = useCallback(() => onLongPress(program), [onLongPress, program]);

  return (
    <Pressable isTVSelectable={false} onPress={press} onLongPress={longPress} style={[styles.cell, { left, width, height }]}>
      {/* Bled in from the right, under the text, full height in its own shape. */}
      {art ? (
        <View style={[styles.art, { width: artWidth }]} pointerEvents="none" testID="guide-cell-art">
          <Animated.View style={[styles.artImage, artZoomStyle]}>
            <Image source={{ uri: art }} style={styles.artImage} contentFit="cover" transition={150} />
          </Animated.View>
          <View style={styles.artFade} />
        </View>
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
        accessibilityLabel={program.EpisodeTitle ? `${program.Name}, ${program.EpisodeTitle}` : program.Name}
        style={[styles.label, pinStyle]}>
        <View style={[styles.textScrim, focused && styles.textScrimFocused]} pointerEvents="none" />
        <View style={styles.text}>
          <View style={styles.titleRow}>
            {recording ? <View style={styles.recordingDot} testID="guide-cell-recording" /> : null}
            {recording === "series" ? <Ionicons name="repeat" size={IS_TV ? 20 : 13} color={COLORS.DESTRUCTIVE_SOFT} testID="guide-cell-series" /> : null}
            <Text style={[styles.title, past && styles.textPast]} numberOfLines={1}>
              {program.Name}
            </Text>
          </View>
          {program.EpisodeTitle ? (
            <Text style={[styles.subtitle, past && styles.textPast]} numberOfLines={1}>
              {program.EpisodeTitle}
            </Text>
          ) : null}
          <Text style={[styles.meta, past && styles.textPast]} numberOfLines={1}>
            {meta}
          </Text>
        </View>
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
    overflow: "hidden",
  },
  // Drawn inside the cell, not as its border: a border would take a pixel off the content box and nudge the label.
  focusRing: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    borderWidth: IS_TV ? 2 : 1,
    borderColor: COLORS.ACCENT,
  },
  // Clips the zoom to the box, so the picture grows within its edges and stays under the fade.
  art: {
    position: "absolute",
    top: 0,
    right: 0,
    bottom: 0,
    overflow: "hidden",
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
    paddingLeft: IS_TV ? 16 : 10,
    paddingRight: IS_TV ? 14 : 8,
    paddingTop: IS_TV ? 14 : 8,
  },
  text: {
    gap: IS_TV ? 4 : 2,
  },
  textScrim: {
    position: "absolute",
    top: 0,
    bottom: 0,
    left: 0,
    right: IS_TV ? -110 : -55,
    experimental_backgroundImage: TEXT_SCRIM,
  },
  // Focused only: steps back by the ring's width, since the ring draws below the label. At rest the
  // scrim runs to the cell's edges, so no art shows through above or below it.
  textScrimFocused: {
    top: IS_TV ? 2 : 1,
    bottom: IS_TV ? 2 : 1,
    left: IS_TV ? 2 : 1,
  },
  meta: {
    color: COLORS.TEXT_TERTIARY,
    fontSize: IS_TV ? 17 : 11,
  },
  titleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: IS_TV ? 8 : 5,
  },
  title: {
    color: COLORS.TEXT_PRIMARY,
    fontSize: IS_TV ? 24 : 14,
    fontWeight: "600",
    flexShrink: 1,
  },
  subtitle: {
    color: COLORS.TEXT_SECONDARY,
    fontSize: IS_TV ? 19 : 12,
  },
  textPast: {
    opacity: 0.5,
  },
  recordingDot: {
    width: IS_TV ? 12 : 8,
    height: IS_TV ? 12 : 8,
    borderRadius: DESIGN.BORDER_RADIUS_ROUND,
    backgroundColor: COLORS.DESTRUCTIVE,
  },
});
