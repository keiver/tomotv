import { DESIGN } from "@/constants/app";
import { COLORS } from "@/constants/colors";
import type { JellyfinProgram } from "@/types/jellyfin";
import { airingProgress, labelPin, NO_GUIDE_PREFIX, programTimes } from "@/utils/guide";
import { Ionicons } from "@expo/vector-icons";
import React, { useCallback, useState } from "react";
import { findNodeHandle, LayoutChangeEvent, Platform, Pressable, StyleSheet, Text, View } from "react-native";
import Animated, { SharedValue, useAnimatedStyle } from "react-native-reanimated";

const IS_TV = Platform.isTV;
/** The grid's line, the same the ruler and the channel column draw. */
export const GRID_LINE = "rgba(255, 255, 255, 0.14)";

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

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
 * line, no scale (grid rule); the airing cell carries a progress bar, a past one dims its text.
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
  const placeholder = !!program.Id?.startsWith(NO_GUIDE_PREFIX);
  const airing = !placeholder && startMs <= nowMs && nowMs < endMs;
  const past = endMs <= nowMs;
  const progress = airing ? airingProgress(startMs, endMs, nowMs) : 0;
  const [labelWidth, setLabelWidth] = useState(0);
  const [focused, setFocused] = useState(false);
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
    onFocus?.(program);
  }, [onFocus, program]);
  const handleBlur = useCallback(() => setFocused(false), []);
  const press = useCallback(() => onPress(program), [onPress, program]);
  const longPress = useCallback(() => onLongPress(program), [onLongPress, program]);

  return (
    <Pressable isTVSelectable={false} onPress={press} onLongPress={longPress} style={[styles.cell, { left, width, height }, focused && styles.cellFocused]}>
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
      </AnimatedPressable>
      {airing ? (
        <View style={styles.progressTrack} testID="guide-cell-progress">
          <View style={[styles.progressFill, { width: `${Math.round(progress * 100)}%` }]} />
        </View>
      ) : null}
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
  cellFocused: {
    borderWidth: 1,
    borderColor: COLORS.ACCENT,
  },
  // Full cell height so a vertical move reveals the whole row; only as wide as its text.
  label: {
    alignSelf: "flex-start",
    height: "100%",
    maxWidth: "100%",
    paddingLeft: IS_TV ? 16 : 10,
    paddingRight: IS_TV ? 14 : 8,
    paddingTop: IS_TV ? 14 : 8,
    gap: IS_TV ? 4 : 2,
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
  progressTrack: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    height: IS_TV ? 3 : 2,
    backgroundColor: "transparent",
  },
  // The LIVE badge's red: gold here would blend into the focus line.
  progressFill: {
    height: "100%",
    backgroundColor: COLORS.DESTRUCTIVE_DEEP,
  },
});
