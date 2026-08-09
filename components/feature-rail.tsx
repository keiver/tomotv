import { Ionicons } from "@expo/vector-icons";
import { useState } from "react";
import { StyleSheet, Text, View } from "react-native";

type IoniconName = keyof typeof Ionicons.glyphMap;

export interface FeatureItem {
  icon: IoniconName;
  label: string;
  tvOnly?: boolean;
}

interface FeatureRailProps {
  features: FeatureItem[];
}

// Cells flex between these bounds: the row packs as many columns as fit at the
// minimum, then the survivors grow to fill the measured width edge to edge.
const MIN_CELL_WIDTH = 76;
const CELL_GAP = 12;

/**
 * FeatureRail — phone-only feature index for the Help screen. The section
 * label lives with the caller, on the page's shared left line above the rail.
 *
 * Bare cells on the page canvas (no card, no background, no scrolling): the
 * grid measures its own width, fits as many columns as the minimum cell size
 * allows, and stretches the cells to span the full line — left-aligned rows
 * with no leftover right gutter on any device. Large glyphs fill the cell,
 * small labels sit at the bottom edge; labels wrap naturally, never ellipsized.
 */
export function FeatureRail({ features }: FeatureRailProps) {
  const [railWidth, setRailWidth] = useState(0);

  const columns = railWidth > 0 ? Math.max(1, Math.floor((railWidth + CELL_GAP) / (MIN_CELL_WIDTH + CELL_GAP))) : 0;
  const cellWidth = columns > 0 ? (railWidth - CELL_GAP * (columns - 1)) / columns : MIN_CELL_WIDTH;

  return (
    <View style={styles.rail} onLayout={(e) => setRailWidth(e.nativeEvent.layout.width)}>
      {columns > 0 &&
        features.map((f) => (
          <View key={f.label} style={[styles.item, { width: cellWidth }]}>
            <View style={styles.iconZone}>
              <Ionicons name={f.icon} size={48} color="#FFC312" />
            </View>
            <Text style={styles.label}>{f.label}</Text>
          </View>
        ))}
    </View>
  );
}

const styles = StyleSheet.create({
  // The page's scroll gap owns the spacing rhythm, not the section's own margin.
  // No horizontal padding: the page's shared side padding is the gutter, and the
  // measured width is then exactly the space the columns divide.
  rail: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "flex-start",
    gap: CELL_GAP,
    paddingVertical: 8,
  },
  // Fixed-height column (width computed from the measured line): the glyph fills
  // the upper zone, the label hugs the bottom edge regardless of how many lines
  // it wraps to.
  item: {
    height: 112,
    alignItems: "center",
    justifyContent: "space-between",
  },
  iconZone: {
    flex: 1,
    justifyContent: "center",
  },
  label: {
    fontSize: 11,
    fontWeight: "600",
    color: "#A1A1A6",
    textAlign: "center",
    lineHeight: 14,
  },
});
