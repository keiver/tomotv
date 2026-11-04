import { useCardPalette } from "@/hooks/useCardPalette";
import { Ionicons } from "@expo/vector-icons";
import React from "react";
import { StyleSheet, View } from "react-native";

interface GuideGripProps {
  /** The circle's diameter. */
  size: number;
  arrowSize: number;
}

/**
 * The column's resize handle: a solid accent disc holding a nested left/right arrow pair. Solid, not glass, so it reads the
 * same over a live picture as over the dark rows; a dark ring and a shadow lift it off a bright picture.
 */
export function GuideGrip({ size, arrowSize }: GuideGripProps) {
  const { accent, onAccent } = useCardPalette();
  return (
    <View style={[styles.disc, { width: size, height: size, borderRadius: size / 2, backgroundColor: accent }]}>
      <Ionicons name="chevron-back" size={arrowSize} color={onAccent} style={styles.nestLeft} />
      <Ionicons name="chevron-forward" size={arrowSize} color={onAccent} style={styles.nestRight} />
    </View>
  );
}

const styles = StyleSheet.create({
  disc: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "rgba(0, 0, 0, 0.35)",
    shadowColor: "#000000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.5,
    shadowRadius: 6,
  },
  // Ionicons chevrons carry side bearing; pulling them in nests the pair at the circle's centre.
  nestLeft: {
    marginRight: -3,
  },
  nestRight: {
    marginLeft: -3,
  },
});
