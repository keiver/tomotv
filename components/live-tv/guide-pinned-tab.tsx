import { useCardPalette } from "@/hooks/useCardPalette";
import { Ionicons } from "@expo/vector-icons";
import React from "react";
import { StyleSheet, View } from "react-native";
import { GestureDetector, GestureHandlerRootView, type GestureType } from "react-native-gesture-handler";

const TAB_WIDTH = 56;
const TAB_HEIGHT = 14;

interface GuidePinnedTabProps {
  /** The tab's left edge, from the band's left: under the start of the name on the larger picture. */
  left: number;
  /** The larger picture: the chevron points up, the way back. */
  extended: boolean;
  /** The band's swipe between sizes. */
  swipe: GestureType;
}

/** A pull tab hanging from the pinned band's bottom edge: the handle for its swipe, pointing the way it goes. */
export function GuidePinnedTab({ left, extended, swipe }: GuidePinnedTabProps) {
  const { accent, onAccent } = useCardPalette();
  return (
    // Placed by the root view's own style: its default is flex 1.
    <GestureHandlerRootView style={[styles.seat, { left }]}>
      <GestureDetector gesture={swipe}>
        <View style={[styles.tab, { backgroundColor: accent }]} testID="guide-pinned-tab">
          <Ionicons name={extended ? "chevron-up" : "chevron-down"} size={15} color={onAccent} />
        </View>
      </GestureDetector>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  seat: {
    position: "absolute",
    // 1pt into the band's edge, so the tab joins it with no seam.
    bottom: 1 - TAB_HEIGHT,
    width: TAB_WIDTH,
    height: TAB_HEIGHT,
  },
  tab: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    borderBottomLeftRadius: TAB_HEIGHT / 2,
    borderBottomRightRadius: TAB_HEIGHT / 2,
  },
});
