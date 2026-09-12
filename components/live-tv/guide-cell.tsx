import { DESIGN } from "@/constants/app";
import { COLORS } from "@/constants/colors";
import type { JellyfinProgram } from "@/types/jellyfin";
import { airingProgress, labelPin, NO_GUIDE_PREFIX, programCategory, programTimes, type ProgramCategory } from "@/utils/guide";
import { Ionicons } from "@expo/vector-icons";
import React, { useCallback, useState } from "react";
import { LayoutChangeEvent, Platform, Pressable, StyleSheet, Text, View } from "react-native";
import Animated, { SharedValue, useAnimatedStyle } from "react-native-reanimated";

const IS_TV = Platform.isTV;

const CATEGORY_COLORS: Record<ProgramCategory, string> = {
  sports: COLORS.SUCCESS,
  movie: COLORS.ACCENT_DEEP,
  news: COLORS.INFO,
  kids: COLORS.PLAYFUL,
};

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
  onFocus?: () => void;
  nextFocusUp?: number;
  hasTVPreferredFocus?: boolean;
}

/**
 * One program on the guide canvas. Focus is the gold fill with warm text, no scale (grid rule);
 * the airing cell carries a progress bar, a past one dims, a recording one wears the red dot.
 */
function GuideCellComponent({ program, left, width, height, nowMs, recording, scrollX, onPress, onLongPress, onFocus, nextFocusUp, hasTVPreferredFocus = false }: GuideCellProps) {
  const { startMs, endMs } = programTimes(program);
  const placeholder = !!program.Id?.startsWith(NO_GUIDE_PREFIX);
  const airing = !placeholder && startMs <= nowMs && nowMs < endMs;
  const past = endMs <= nowMs;
  const progress = airing ? airingProgress(startMs, endMs, nowMs) : 0;
  const category = programCategory(program);
  const [labelWidth, setLabelWidth] = useState(0);
  const handleLabelLayout = useCallback((event: LayoutChangeEvent) => setLabelWidth(event.nativeEvent.layout.width), []);
  const pinStyle = useAnimatedStyle(() => ({ transform: [{ translateX: labelPin(scrollX.value, left, width, labelWidth) }] }), [left, width, labelWidth]);

  return (
    <Pressable
      onPress={() => onPress(program)}
      onLongPress={() => onLongPress(program)}
      onFocus={onFocus}
      isTVSelectable
      hasTVPreferredFocus={hasTVPreferredFocus}
      nextFocusUp={nextFocusUp}
      tvParallaxProperties={{ enabled: false }}
      accessibilityRole="button"
      accessibilityLabel={program.EpisodeTitle ? `${program.Name}, ${program.EpisodeTitle}` : program.Name}
      style={({ focused }) => [styles.cell, { left, width, height }, past && styles.cellPast, focused && styles.cellFocused]}>
      {({ focused }) => (
        <>
          {category ? <View style={[styles.stripe, { backgroundColor: CATEGORY_COLORS[category] }]} /> : null}
          <Animated.View style={[styles.label, pinStyle]} onLayout={handleLabelLayout}>
            <View style={styles.titleRow}>
              {recording ? <View style={styles.recordingDot} testID="guide-cell-recording" /> : null}
              {recording === "series" ? <Ionicons name="repeat" size={IS_TV ? 20 : 13} color={COLORS.DESTRUCTIVE_SOFT} testID="guide-cell-series" /> : null}
              <Text style={[styles.title, focused && styles.titleFocused]} numberOfLines={1}>
                {program.Name}
              </Text>
            </View>
            {program.EpisodeTitle ? (
              <Text style={[styles.subtitle, focused && styles.subtitleFocused]} numberOfLines={1}>
                {program.EpisodeTitle}
              </Text>
            ) : null}
          </Animated.View>
          {airing ? (
            <View style={[styles.progressTrack, focused && styles.progressTrackFocused]} testID="guide-cell-progress">
              <View style={[styles.progressFill, focused && styles.progressFillFocused, { width: `${Math.round(progress * 100)}%` }]} />
            </View>
          ) : null}
        </>
      )}
    </Pressable>
  );
}

export const GuideCell = React.memo(GuideCellComponent);

const styles = StyleSheet.create({
  cell: {
    position: "absolute",
    top: 0,
    backgroundColor: COLORS.SURFACE,
    borderRadius: DESIGN.BORDER_RADIUS_MEDIUM,
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.12)",
    overflow: "hidden",
  },
  cellPast: {
    opacity: 0.55,
  },
  cellFocused: {
    backgroundColor: COLORS.ACCENT,
    borderColor: COLORS.ACCENT,
    opacity: 1,
  },
  stripe: {
    position: "absolute",
    left: 0,
    top: 0,
    bottom: 0,
    width: IS_TV ? 3 : 2,
  },
  label: {
    alignSelf: "flex-start",
    maxWidth: "100%",
    paddingLeft: IS_TV ? 18 : 10,
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
    fontWeight: "700",
    flexShrink: 1,
  },
  titleFocused: {
    color: COLORS.ON_ACCENT_WARM,
  },
  subtitle: {
    color: COLORS.TEXT_SECONDARY,
    fontSize: IS_TV ? 19 : 12,
  },
  subtitleFocused: {
    color: COLORS.ON_ACCENT_WARM,
    opacity: 0.8,
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
    height: IS_TV ? 4 : 3,
    backgroundColor: COLORS.SURFACE_SUNKEN,
  },
  progressTrackFocused: {
    backgroundColor: "rgba(0, 0, 0, 0.18)",
  },
  progressFill: {
    height: "100%",
    backgroundColor: COLORS.ACCENT,
  },
  progressFillFocused: {
    backgroundColor: COLORS.ON_ACCENT_WARM,
  },
});
