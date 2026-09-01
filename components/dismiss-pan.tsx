import React, { useCallback, useMemo } from "react";
import { Platform, StyleSheet, View, type StyleProp, type ViewProps, type ViewStyle } from "react-native";
import { Gesture, GestureDetector, GestureHandlerRootView } from "react-native-gesture-handler";
import Animated, { runOnJS, useAnimatedStyle, useSharedValue, withTiming } from "react-native-reanimated";

/** How far down the drag has to travel to count as leaving, in points. */
const COMMIT_DISTANCE = 120;
/** Or how fast it has to be flicked, in points per second. */
const COMMIT_VELOCITY = 800;
/** The travel a flick still has to cover: velocity alone let a twitch past the 24pt activation leave. */
const FLICK_DISTANCE = 64;

/**
 * Whether a finished pan was somebody leaving.
 *
 * A worklet, and exported so the rule can be read and tested off the UI thread — it is the
 * whole gesture, and both halves of it were wrong.
 *
 * `success` is false when the handler left ACTIVE for CANCELLED or FAILED, which RNGH runs
 * this callback for just the same (useAnimatedGesture.ts). A second finger landing cancels
 * the pan, and so does UIKit claiming the touches when AVKit's presentation covers the root.
 * Neither is a release, and both arrive carrying the velocity of whatever movement was
 * underway.
 *
 * Velocity alone used to commit, so a twitch past the 24pt activation threshold left the
 * player: a flick has to have covered real ground as well as moved fast.
 */
export function leavingByPan(event: { translationY: number; velocityY: number }, success: boolean): boolean {
  "worklet";
  if (!success) return false;
  if (event.translationY > COMMIT_DISTANCE) return true;
  return event.velocityY > COMMIT_VELOCITY && event.translationY > FLICK_DISTANCE;
}

interface DismissPanProps {
  /** Leave: the player route's back, or the host ending its session. */
  onDismiss: () => void;
  /**
   * Double press on the surface. Wired only where the player is INLINE (the Mac): everywhere
   * else AVKit's presentation sits above this view and no press reaches it.
   */
  onDoubleTap?: () => void;
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
 * through to AVKit's scrubber.
 *
 * A presented view controller sits above the React Native root, so once one is up this stops
 * receiving touches. Not while one is still arriving, though: leaving there tears the session
 * down mid-presentation, which is why PlayerHost.endSession waits rather than trusting this.
 *
 * Inert on tvOS, which pops with Menu and must not gain a view above its focusables.
 */
export function DismissPan({ onDismiss, onDoubleTap, style, pointerEvents, children }: DismissPanProps) {
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
        .onEnd((event, success) => {
          "worklet";
          if (leavingByPan(event, success)) {
            runOnJS(dismiss)();
            return;
          }
          translateY.set(withTiming(0, { duration: 160 }));
        }),
    [dismiss, translateY],
  );

  // Race, not Simultaneous: the pan needs 24pt of travel, which a double press never has, so
  // the two can never both claim one interaction.
  const gesture = useMemo(() => {
    if (!onDoubleTap) return pan;
    const doubleTap = Gesture.Tap()
      .numberOfTaps(2)
      .maxDuration(280)
      .onEnd(() => {
        "worklet";
        runOnJS(onDoubleTap)();
      });
    return Gesture.Race(pan, doubleTap);
  }, [pan, onDoubleTap]);

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
      <GestureDetector gesture={gesture}>
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
