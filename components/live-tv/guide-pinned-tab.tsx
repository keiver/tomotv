import { GuidePinnedFillet } from "@/components/live-tv/guide-pinned-fillet";
import { useCardPalette } from "@/hooks/useCardPalette";
import { t } from "@/services/i18n";
import { THIS_DEVICE } from "@/utils/hostEnvironment";
import { Ionicons } from "@expo/vector-icons";
import React, { useMemo } from "react";
import { StyleSheet, Text, View } from "react-native";
import { Gesture, GestureDetector, GestureHandlerRootView, type GestureType } from "react-native-gesture-handler";
import { runOnJS } from "react-native-reanimated";

/** The band's edge and its tab, weighed against each platform's type: the Mac's denser and pointer-driven. */
const SHAPE =
  THIS_DEVICE === "Mac" ? { edge: 3, width: 60, height: 16, chevron: 15 } : THIS_DEVICE === "iPad" ? { edge: 4, width: 80, height: 22, chevron: 19 } : { edge: 4, width: 72, height: 20, chevron: 18 };
/** The pinned band's bottom edge, in the theme's accent. */
export const PINNED_EDGE = SHAPE.edge;
const FILLET = SHAPE.edge * 1.5;
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
  /** The channel's name beside the chevron. */
  name?: string | null;
}

/** A pull tab poured from the pinned band's bottom edge: a swipe or a tap changes the size, its chevron pointing the way it goes. */
export function GuidePinnedTab({ left, extended, swipe, onToggle, name }: GuidePinnedTabProps) {
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
      <GuidePinnedFillet side="left" radius={FILLET} color={accent} />
      <GuidePinnedFillet side="right" radius={FILLET} color={accent} />
      <GestureDetector gesture={gesture}>
        <View
          style={[styles.tab, name ? styles.named : null, { backgroundColor: accent }]}
          hitSlop={HOT}
          accessible
          accessibilityRole="button"
          accessibilityLabel={t(extended ? "liveTv.smallerPicture" : "liveTv.largerPicture")}
          onAccessibilityTap={onToggle}
          testID="guide-pinned-tab">
          <Ionicons name={extended ? "chevron-up" : "chevron-down"} size={SHAPE.chevron} color={onAccent} style={styles.chevron} />
          {name ? (
            <Text style={[styles.name, { color: onAccent }]} numberOfLines={1}>
              {name}
            </Text>
          ) : null}
        </View>
      </GestureDetector>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  seat: {
    position: "absolute",
    // 1pt into the band's edge, so the tab joins it with no seam.
    bottom: 1 - SHAPE.height,
    minWidth: SHAPE.width,
    maxWidth: "70%",
    height: SHAPE.height,
  },
  tab: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingBottom: 2,
    borderBottomLeftRadius: SHAPE.height / 2,
    borderBottomRightRadius: SHAPE.height / 2,
    borderCurve: "continuous",
  },
  // Wider, not taller: the tab hangs low over the first row.
  chevron: {
    transform: [{ scaleX: 1.25 }],
  },
  // Room for the chevron's drawn width, which its scale leaves out of the layout.
  named: {
    gap: 10,
    paddingHorizontal: 14,
  },
  name: {
    flexShrink: 1,
    fontSize: 12,
    fontWeight: "600",
  },
});
