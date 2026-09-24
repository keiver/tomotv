import { TINT_REST } from "@/components/glass-button";
import { GlassSurface } from "@/components/glass-surface";
import { COLORS } from "@/constants/colors";
import { Ionicons } from "@expo/vector-icons";
import React from "react";
import { StyleSheet } from "react-native";

interface GuideGripProps {
  /** The circle's diameter. */
  size: number;
  arrowSize: number;
}

/** The column's resize handle: a gold glass circle holding a nested left/right arrow pair. */
export function GuideGrip({ size, arrowSize }: GuideGripProps) {
  return (
    <GlassSurface style={[styles.glass, { width: size, height: size }]} radius={size / 2} tintColor={TINT_REST} interactive>
      <Ionicons name="chevron-back" size={arrowSize} color={COLORS.ACCENT} style={styles.nestLeft} />
      <Ionicons name="chevron-forward" size={arrowSize} color={COLORS.ACCENT} style={styles.nestRight} />
    </GlassSurface>
  );
}

const styles = StyleSheet.create({
  // Shape comes from GlassSurface's radius: a borderRadius or overflow here masks the material.
  glass: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
  },
  // Ionicons chevrons carry side bearing; pulling them in nests the pair at the circle's centre.
  nestLeft: {
    marginRight: -3,
  },
  nestRight: {
    marginLeft: -3,
  },
});
