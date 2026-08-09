import { Ionicons } from "@expo/vector-icons";
import { ScrollView, StyleSheet, Text, View } from "react-native";

import { settingsStyles } from "@/components/settings/styles";

type IoniconName = keyof typeof Ionicons.glyphMap;

export interface FeatureItem {
  icon: IoniconName;
  label: string;
  tvOnly?: boolean;
}

interface FeatureRailProps {
  features: FeatureItem[];
}

/**
 * FeatureRail — phone-only exploratory shelf for the Help screen. The section
 * label lives with the caller, on the page's shared left line above the card.
 *
 * A standard settings section card (rounded, in-content width) holding one
 * horizontal row: large bare glyphs fill the cell, small labels sit at the
 * bottom edge. The card's overflow clipping ends the row at the rounded
 * corners — the cut-off neighbor is the scroll affordance. Labels wrap
 * naturally, never ellipsized.
 */
export function FeatureRail({ features }: FeatureRailProps) {
  return (
    <View style={[settingsStyles.section, styles.card]}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.rail}>
        {features.map((f) => (
          <View key={f.label} style={styles.item}>
            <View style={styles.iconZone}>
              <Ionicons name={f.icon} size={48} color="#FFC312" />
            </View>
            <Text style={styles.label}>{f.label}</Text>
          </View>
        ))}
      </ScrollView>
      {/* Sunken lip, same overlay the settings section cards use — last child so it
          draws above the row; its radius already matches the card's corners. */}
      <View style={settingsStyles.sectionInnerShadow} />
    </View>
  );
}

const styles = StyleSheet.create({
  // The page's scroll gap owns the spacing rhythm, not the section's own margin.
  // Roomier than the base section's 10: the row sits clear of the sunken lip.
  card: {
    marginBottom: 0,
    padding: 16,
    // The icon zone's flex slack pads the top of each cell; the bottom-anchored
    // labels sit right on the edge, so the card compensates below.
    paddingBottom: 28,
  },
  rail: {
    gap: 12,
    paddingHorizontal: 8,
    paddingVertical: 2,
    alignItems: "stretch",
  },
  // Fixed-height column: the glyph fills the upper zone, the label hugs the
  // bottom edge regardless of how many lines it wraps to.
  item: {
    width: 92,
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
