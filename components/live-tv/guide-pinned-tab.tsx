import { useCardPalette } from "@/hooks/useCardPalette";
import { t } from "@/services/i18n";
import { Ionicons } from "@expo/vector-icons";
import React, { useMemo } from "react";
import { StyleSheet, View } from "react-native";
import { Gesture, GestureDetector, GestureHandlerRootView, type GestureType } from "react-native-gesture-handler";
import { runOnJS } from "react-native-reanimated";

const TAB_WIDTH = 72;
const TAB_HEIGHT = 20;
/** The touch area reaches this far past the tab on every side. */
const HOT = 20;

interface GuidePinnedTabProps {
  /** The tab's left edge, from the band's left: under the start of the name on the larger picture. */
  left: number;
  /** The larger picture: the chevron points up, the way back. */
  extended: boolean;
  /** The band's swipe between sizes. */
  swipe: GestureType;
  /** A tap on the tab: the other size. */
  onToggle: () => void;
}

/** A pull tab hanging from the pinned band's bottom edge: a swipe or a tap changes the size, its chevron pointing the way it goes. */
export function GuidePinnedTab({ left, extended, swipe, onToggle }: GuidePinnedTabProps) {
  const { accent, onAccent } = useCardPalette();
  const gesture = useMemo(
    () =>
      Gesture.Race(
        swipe,
        Gesture.Tap().onEnd((_event, success) => {
          "worklet";
          if (success) runOnJS(onToggle)();
        }),
      ),
    [swipe, onToggle],
  );
  return (
    // Placed by the root view's own style: its default is flex 1.
    <GestureHandlerRootView style={[styles.seat, { left }]}>
      <GestureDetector gesture={gesture}>
        <View
          style={[styles.tab, { backgroundColor: accent }]}
          hitSlop={HOT}
          accessible
          accessibilityRole="button"
          accessibilityLabel={t(extended ? "liveTv.smallerPicture" : "liveTv.largerPicture")}
          onAccessibilityTap={onToggle}
          testID="guide-pinned-tab">
          <Ionicons name={extended ? "chevron-up" : "chevron-down"} size={18} color={onAccent} style={styles.chevron} />
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
    paddingHorizontal: 16,
    paddingBottom: 2,
    borderBottomLeftRadius: TAB_HEIGHT / 2,
    borderBottomRightRadius: TAB_HEIGHT / 2,
  },
  // Wider, not taller: the tab hangs low over the first row.
  chevron: {
    transform: [{ scaleX: 1.6 }],
  },
});
