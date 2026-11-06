import { RecordingPulse } from "@/components/live-tv/recording-pulse";
import { COLORS } from "@/constants/colors";
import React from "react";
import { StyleSheet, Text, View, type ViewStyle } from "react-native";

/** Over a playing channel's picture while a recording runs: Recording now, or Playing the recording, with a pulsing dot. */
export function PinnedRecordingMark({ text, style }: { text: string; style?: ViewStyle }) {
  return (
    <View style={[styles.mark, style]} pointerEvents="none" testID="guide-pinned-mark">
      <RecordingPulse active>
        <View style={styles.markDot} />
      </RecordingPulse>
      <Text style={styles.markText} numberOfLines={1}>
        {text}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  mark: {
    position: "absolute",
    maxWidth: "90%",
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 8,
    backgroundColor: "rgba(0, 0, 0, 0.65)",
  },
  markDot: {
    width: 7,
    height: 7,
    borderRadius: 3.5,
    backgroundColor: COLORS.DESTRUCTIVE,
  },
  markText: {
    flexShrink: 1,
    color: COLORS.TEXT_PRIMARY,
    fontSize: 11,
    fontWeight: "600",
  },
});
