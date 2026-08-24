import { Ionicons } from "@expo/vector-icons";
import { Platform, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

const IS_TV = Platform.isTV;

// Display size, not an icon size: a couch reads it as a shape, a hand as a mark.
const MARK_SIZE = IS_TV ? 300 : 140;

// Floor, not an addition to the safe-area inset, so tvOS overscan wins where it is larger and
// every other platform gets exactly this.
const MARK_EDGE_GAP = IS_TV ? 40 : 16;

/**
 * The funnel set huge and faint in the bottom-right of the Filters panel. Ambient only: it never
 * takes focus or touch.
 *
 * CALLER CONSTRAINT: render this BEFORE any focusable sibling. Siblings paint in order, and on
 * tvOS a view drawn above a focusable occludes it, and pointerEvents cannot opt out.
 */
export function FiltersGhostMark() {
  const insets = useSafeAreaInsets();

  return (
    <View
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[styles.wrap, { bottom: Math.max(insets.bottom, MARK_EDGE_GAP), right: Math.max(insets.right, MARK_EDGE_GAP) }]}>
      <Ionicons name="funnel" size={MARK_SIZE} style={styles.mark} allowFontScaling={false} />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: "absolute",
  },
  // Engraved: the fill is barely there, and a light edge falling down-right off it is what the
  // eye reads as cut into the surface.
  mark: {
    color: "rgba(255, 195, 18, 0.03)",
    textShadowColor: "rgba(255, 255, 255, 0.08)",
    textShadowOffset: { width: 2, height: 2 },
    textShadowRadius: 4,
  },
});
