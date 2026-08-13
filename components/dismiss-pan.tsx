import React, { useCallback, useMemo } from "react";
import { Platform, StyleSheet, View, type StyleProp, type ViewProps, type ViewStyle } from "react-native";
import { Gesture, GestureDetector, GestureHandlerRootView } from "react-native-gesture-handler";
import Animated, { runOnJS, useAnimatedStyle, useSharedValue, withTiming } from "react-native-reanimated";

/** How far down the drag has to travel to count as leaving, in points. */
const COMMIT_DISTANCE = 120;
/** Or how fast it has to be flicked, in points per second. */
const COMMIT_VELOCITY = 800;

interface DismissPanProps {
  /** Leave: the player route's back, or the host ending its session. */
  onDismiss: () => void;
  style?: StyleProp<ViewStyle>;
  pointerEvents?: ViewProps["pointerEvents"];
  children: React.ReactNode;
}

/**
 * Drag down to leave.
 *
 * The phone's way out of a surface that carries no chrome of its own. The player host's stage
 * and the route's loading canvas both cover the whole app with no header, no back item, and no
 * pop gesture that can reach the navigator underneath — so when AVKit's presented player is not
 * on screen there is nothing left to leave by. Vertical intent only; a horizontal drag falls
 * through to AVKit's scrubber, and while the presentation IS up this cannot fire at all, since
 * the presented view controller sits above the React Native root.
 *
 * Inert on tvOS, which pops with Menu and must not gain a view above its focusables.
 */
export function DismissPan({ onDismiss, style, pointerEvents, children }: DismissPanProps) {
  const translateY = useSharedValue(0);

  const dismiss = useCallback(() => {
    translateY.set(0);
    onDismiss();
  }, [onDismiss, translateY]);

  const pan = useMemo(
    () =>
      Gesture.Pan()
        .activeOffsetY(24)
        .failOffsetX([-20, 20])
        .onUpdate((event) => {
          "worklet";
          translateY.set(Math.max(0, event.translationY));
        })
        .onEnd((event) => {
          "worklet";
          if (event.translationY > COMMIT_DISTANCE || event.velocityY > COMMIT_VELOCITY) {
            runOnJS(dismiss)();
            return;
          }
          translateY.set(withTiming(0, { duration: 160 }));
        }),
    [dismiss, translateY],
  );

  const dragStyle = useAnimatedStyle(() => ({ transform: [{ translateY: translateY.get() }] }));

  if (Platform.isTV) {
    return (
      <View style={style} pointerEvents={pointerEvents}>
        {children}
      </View>
    );
  }

  return (
    <GestureHandlerRootView style={style} pointerEvents={pointerEvents}>
      <GestureDetector gesture={pan}>
        <Animated.View style={[styles.fill, dragStyle]}>{children}</Animated.View>
      </GestureDetector>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  fill: {
    flex: 1,
  },
});
