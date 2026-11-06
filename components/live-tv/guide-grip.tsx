import { CONTROL_TINT } from "@/components/glass-icon-button";
import { GlassSurface } from "@/components/glass-surface";
import { useCardPalette } from "@/hooks/useCardPalette";
import { Ionicons } from "@expo/vector-icons";
import React from "react";
import { StyleSheet, View } from "react-native";

/** The grip's diameter, shared with the pinned band's buttons on the picture so the two read as one set. */
export const GRIP_SIZE = 42;

interface GuideGripProps {
  /** The circle's diameter. */
  size: number;
  arrowSize: number;
}

/**
 * The column's resize handle: a nested left/right arrow pair in the accent on the same glass as the pinned band's
 * buttons, with a shadow to lift it off a bright picture.
 */
export function GuideGrip({ size, arrowSize }: GuideGripProps) {
  const { accent } = useCardPalette();
  return (
    <View style={[styles.lift, { borderRadius: size / 2 }]}>
      <GlassSurface style={[styles.disc, { width: size, height: size }]} radius={size / 2} tintColor={CONTROL_TINT}>
        <Ionicons name="chevron-back" size={arrowSize} color={accent} style={styles.nestLeft} />
        <Ionicons name="chevron-forward" size={arrowSize} color={accent} style={styles.nestRight} />
      </GlassSurface>
    </View>
  );
}

const styles = StyleSheet.create({
  lift: {
    shadowColor: "#000000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.5,
    shadowRadius: 6,
  },
  disc: {
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
