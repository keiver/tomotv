import { MARK_HEIGHT, MARK_WIDTH } from "@/components/settings/styles";
import { ORIGINAL_INDEX } from "@/services/adaptiveQuality";
import { Platform, StyleSheet, View } from "react-native";

const IS_TV = Platform.isTV;

/** Real (transcodable) presets — the Original sentinel is not a ladder rung. */
const RUNGS = ORIGINAL_INDEX;

const GAP = IS_TV ? 3 : 2;
const BAR_WIDTH = (MARK_WIDTH - GAP * (RUNGS - 1)) / RUNGS;
const BAR_RADIUS = IS_TV ? 2 : 1.5;

// Rung one stands at 3/8 of the box, so it reads as a bar rather than a dot.
const SHORTEST = 0.375;

const DIM = 0.28;

interface LinkLadderProps {
  /** Presets the measured connection carries, from carriedRungs. */
  carried: number;
  /** The row's ink — gold at rest, the fill's ink once the row goes gold. */
  color: string;
}

/**
 * The Auto row's leading mark: one bar per preset rung, bar n lit when the
 * connection carries that preset. It states in a glance what the row's
 * subtitle states in words, off the same carriedRungs call.
 */
export function LinkLadder({ carried, color }: LinkLadderProps) {
  return (
    <View style={styles.ladder} accessibilityElementsHidden>
      {Array.from({ length: RUNGS }, (_, i) => (
        <View
          key={i}
          style={[
            styles.bar,
            {
              height: MARK_HEIGHT * (SHORTEST + ((1 - SHORTEST) * i) / (RUNGS - 1)),
              backgroundColor: color,
              opacity: i < carried ? 1 : DIM,
            },
          ]}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  // Pinned to the tallest bar, so the mark's height does not depend on which
  // rungs happen to be lit.
  ladder: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: GAP,
    width: MARK_WIDTH,
    height: MARK_HEIGHT,
  },
  bar: {
    width: BAR_WIDTH,
    borderRadius: BAR_RADIUS,
  },
});
