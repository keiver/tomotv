import { ROW_PADDING_V } from "@/components/settings/styles";
import { StyleSheet, View } from "react-native";

/** True while rows remain below a capped list's visible window. */
export function hasMoreBelow(offset: number, viewport: number | undefined, content: number): boolean {
  return viewport != null && offset + viewport < content - 1;
}

/** Index of the last whole row showing in a capped list of equal-height rows. */
export function lastVisibleRow(offset: number, viewport: number, rowHeight: number): number {
  return Math.round((offset + viewport) / rowHeight) - 1;
}

/** A flat, wide chevron in the row's bottom padding. Drawn inside the row: tvOS lets an overlay occlude focusables. */
export function MoreBelowHint({ visible, color }: { visible: boolean; color: string }) {
  return (
    <View pointerEvents="none" style={[styles.foot, { opacity: visible ? 0.86 : 0 }]} collapsable={false}>
      <View style={styles.chevron} collapsable={false}>
        <View style={[styles.arm, styles.left, { backgroundColor: color }]} />
        <View style={[styles.arm, styles.right, { backgroundColor: color }]} />
      </View>
    </View>
  );
}

const ARM = 22;
const STROKE = 4;

const styles = StyleSheet.create({
  // Spans the row's bottom padding, below the content box it is positioned in.
  foot: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: -ROW_PADDING_V,
    height: ROW_PADDING_V,
    alignItems: "center",
    justifyContent: "center",
  },
  chevron: {
    flexDirection: "row",
    alignItems: "center",
  },
  arm: {
    width: ARM,
    height: STROKE,
    borderRadius: STROKE / 2,
  },
  // The arms overlap by a stroke so the joint stays closed.
  left: {
    marginRight: -STROKE / 2,
    transform: [{ rotate: "14deg" }],
  },
  right: {
    marginLeft: -STROKE / 2,
    transform: [{ rotate: "-14deg" }],
  },
});
