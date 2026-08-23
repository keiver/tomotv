import { COLORS } from "@/constants/colors";
import { Ionicons } from "@expo/vector-icons";
import React from "react";
import { Platform, Pressable, StyleSheet, Text } from "react-native";
import Swipeable, { type SwipeableMethods } from "react-native-gesture-handler/ReanimatedSwipeable";
import Animated, { useAnimatedStyle, type SharedValue } from "react-native-reanimated";

const IS_TV = Platform.isTV;
const ACTION_WIDTH = IS_TV ? 140 : 96;

interface SwipeToRemoveProps {
  /** Named for the row, since a screen reader reaches the action with no row context. */
  label: string;
  onRemove: () => void;
  children: React.ReactNode;
}

/**
 * The action panel. Faded in by the swipe rather than hidden behind the row: the rows are
 * transparent so the card's inset shadow shows through, and a panel under one would show too.
 */
function RemoveAction({ progress, methods, label, onRemove }: { progress: SharedValue<number>; methods: SwipeableMethods; label: string; onRemove: () => void }) {
  const fade = useAnimatedStyle(() => ({ opacity: Math.min(1, progress.get()) }));

  return (
    <Animated.View style={[styles.action, fade]}>
      <Pressable
        style={styles.press}
        onPress={() => {
          methods.close();
          onRemove();
        }}
        accessibilityRole="button"
        accessibilityLabel={`Remove ${label}`}>
        <Ionicons name="trash" size={IS_TV ? 30 : 20} color={COLORS.TEXT_PRIMARY} />
        <Text style={styles.label}>Remove</Text>
      </Pressable>
    </Animated.View>
  );
}

/**
 * Drag a row left to uncover Remove. The same press long-press already offers, given an
 * affordance: a gesture nothing on screen names is a gesture most people never find.
 *
 * Inert on tvOS, which has no downloads and must not gain a view above its focusables.
 */
export function SwipeToRemove({ label, onRemove, children }: SwipeToRemoveProps) {
  if (IS_TV) return <>{children}</>;

  return (
    <Swipeable
      friction={2}
      rightThreshold={ACTION_WIDTH / 2}
      // No pull past the panel: the row is one of a stack inside a clipped card, and rubber
      // banding one of them reads as the card tearing.
      overshootRight={false}
      renderRightActions={(progress, _translation, methods) => <RemoveAction progress={progress} methods={methods} label={label} onRemove={onRemove} />}>
      {children}
    </Swipeable>
  );
}

const styles = StyleSheet.create({
  action: {
    width: ACTION_WIDTH,
    height: "100%",
    backgroundColor: COLORS.DESTRUCTIVE_DEEP,
  },
  press: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: IS_TV ? 6 : 4,
  },
  label: {
    color: COLORS.TEXT_PRIMARY,
    fontSize: IS_TV ? 20 : 13,
    fontWeight: "600",
  },
});
