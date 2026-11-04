import { useCardPalette } from "@/hooks/useCardPalette";
import { Ionicons } from "@expo/vector-icons";
import React from "react";
import { StyleSheet, View } from "react-native";
import { GestureDetector, GestureHandlerRootView, type GestureType } from "react-native-gesture-handler";

const TAB_WIDTH = 44;
const TAB_HEIGHT = 14;

interface GuidePinnedTabProps {
  /** The tab's centre, from the band's left. */
  centerX: number;
  /** The larger picture: the chevron points up, the way back. */
  extended: boolean;
  /** The band's swipe between sizes. */
  swipe: GestureType;
}

/** A pull tab hanging from the pinned band's bottom edge: the handle for its swipe, pointing the way it goes. */
export function GuidePinnedTab({ centerX, extended, swipe }: GuidePinnedTabProps) {
  const { accent, onAccent } = useCardPalette();
  return (
    // Placed by the root view's own style: its default is flex 1.
    <GestureHandlerRootView style={[styles.seat, { left: centerX - TAB_WIDTH / 2 }]}>
      <GestureDetector gesture={swipe}>
        <View style={[styles.tab, { backgroundColor: accent }]} testID="guide-pinned-tab">
          <Ionicons name={extended ? "chevron-up" : "chevron-down"} size={12} color={onAccent} />
        </View>
      </GestureDetector>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  seat: {
    position: "absolute",
    bottom: -TAB_HEIGHT,
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
