import { useCallback, useMemo } from "react";
import { useWindowDimensions } from "react-native";
import { Gesture, type GestureStateChangeEvent, type GestureUpdateEvent, type PanGestureHandlerEventPayload, type PinchGestureHandlerEventPayload } from "react-native-gesture-handler";
import { runOnJS, useAnimatedStyle, useReducedMotion, useSharedValue, withSpring, withTiming } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

// Pan must travel this far straight down before it claims the touch — taps and AVKit's
// horizontal transport scrub never reach it.
const PAN_ACTIVATE_DISTANCE = 28;
const PAN_FAIL_X = 24;
// Release thresholds: past a third of the screen, or flung.
const PAN_DISMISS_VELOCITY = 800;
// Pinch released below this scale closes the player.
const PINCH_DISMISS_SCALE = 0.75;
const SPRING = { damping: 18, stiffness: 220 };

/**
 * Drag-down / pinch-in dismissal for the phone player, Photos-app style. Everything runs as UI
 * worklets over transform+opacity only — no React re-renders while dragging, and the AVPlayer
 * layer moves on the GPU.
 *
 * The caller attaches the gesture on phone only and spreads the animated style on the screen
 * root. Gestures are invisible to VoiceOver, so the caller must also provide an assistive path
 * (onAccessibilityEscape → the same onDismiss).
 *
 * Honors Reduce Motion: the exit plays as an instant cut instead of a slide/shrink.
 */
export function usePlayerDismissGesture(onDismiss: () => void) {
  const { height: windowHeight, width: windowWidth } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const reducedMotion = useReducedMotion();

  const translateY = useSharedValue(0);
  const panScale = useSharedValue(1);
  const pinchScale = useSharedValue(1);
  const opacity = useSharedValue(1);
  // AVKit's expanded volume slider is a vertical drag pinned to the top-right; a dismiss pan
  // starting there would fight it, so those pans run inert (activation can't be revoked).
  const inertPan = useSharedValue(false);
  // Once an exit animation is running, later gesture events must not restyle the screen.
  const dismissing = useSharedValue(false);

  const onPanStart = useCallback(
    (event: GestureStateChangeEvent<PanGestureHandlerEventPayload>) => {
      "worklet";
      inertPan.set(event.absoluteY < insets.top + 120 && event.absoluteX > windowWidth - 96);
    },
    [inertPan, insets.top, windowWidth],
  );

  const onPanUpdate = useCallback(
    (event: GestureUpdateEvent<PanGestureHandlerEventPayload>) => {
      "worklet";
      if (inertPan.get() || dismissing.get()) return;
      const drag = Math.max(0, event.translationY);
      translateY.set(drag);
      panScale.set(1 - Math.min(drag / windowHeight, 0.12));
    },
    [inertPan, dismissing, translateY, panScale, windowHeight],
  );

  const onPanEnd = useCallback(
    (event: GestureStateChangeEvent<PanGestureHandlerEventPayload>) => {
      "worklet";
      if (inertPan.get() || dismissing.get()) return;
      if (event.translationY > windowHeight / 3 || event.velocityY > PAN_DISMISS_VELOCITY) {
        dismissing.set(true);
        translateY.set(
          withTiming(windowHeight, { duration: reducedMotion ? 0 : 220 }, (finished) => {
            if (finished) runOnJS(onDismiss)();
          }),
        );
      }
    },
    [inertPan, dismissing, translateY, windowHeight, reducedMotion, onDismiss],
  );

  // onEnd only fires on a clean release; a CANCELLED/FAILED pan (system gesture, incoming call,
  // a native view claiming the touch) would strand the screen mid-drag. onFinalize fires on
  // every termination path, so the snap back to identity lives here.
  const onPanFinalize = useCallback(() => {
    "worklet";
    inertPan.set(false);
    if (dismissing.get()) return;
    translateY.set(withSpring(0, SPRING));
    panScale.set(withSpring(1, SPRING));
  }, [inertPan, dismissing, translateY, panScale]);

  const onPinchUpdate = useCallback(
    (event: GestureUpdateEvent<PinchGestureHandlerEventPayload>) => {
      "worklet";
      if (dismissing.get()) return;
      // Shrink only — growing past 1 does nothing, it's not a zoom feature.
      pinchScale.set(Math.min(1, event.scale));
    },
    [dismissing, pinchScale],
  );

  const onPinchEnd = useCallback(
    (event: GestureStateChangeEvent<PinchGestureHandlerEventPayload>) => {
      "worklet";
      if (dismissing.get()) return;
      if (event.scale < PINCH_DISMISS_SCALE) {
        dismissing.set(true);
        pinchScale.set(withTiming(0.35, { duration: reducedMotion ? 0 : 200 }));
        opacity.set(
          withTiming(0, { duration: reducedMotion ? 0 : 200 }, (finished) => {
            if (finished) runOnJS(onDismiss)();
          }),
        );
      }
    },
    [dismissing, pinchScale, opacity, reducedMotion, onDismiss],
  );

  // Same guarantee as the pan: any non-dismissing termination snaps back to full size.
  const onPinchFinalize = useCallback(() => {
    "worklet";
    if (dismissing.get()) return;
    pinchScale.set(withSpring(1, SPRING));
    opacity.set(1);
  }, [dismissing, pinchScale, opacity]);

  const dismissGesture = useMemo(
    () =>
      Gesture.Simultaneous(
        Gesture.Pan()
          .activeOffsetY(PAN_ACTIVATE_DISTANCE)
          .failOffsetY(-PAN_ACTIVATE_DISTANCE)
          .failOffsetX([-PAN_FAIL_X, PAN_FAIL_X])
          .onStart(onPanStart)
          .onUpdate(onPanUpdate)
          .onEnd(onPanEnd)
          .onFinalize(onPanFinalize),
        Gesture.Pinch().onUpdate(onPinchUpdate).onEnd(onPinchEnd).onFinalize(onPinchFinalize),
      ),
    [onPanStart, onPanUpdate, onPanEnd, onPanFinalize, onPinchUpdate, onPinchEnd, onPinchFinalize],
  );

  const dismissAnimatedStyle = useAnimatedStyle(() => {
    const dragFade = 1 - Math.min(translateY.value / (windowHeight * 1.15), 0.35);
    return {
      opacity: opacity.value * dragFade,
      transform: [{ translateY: translateY.value }, { scale: panScale.value * pinchScale.value }],
    };
  });

  return { dismissGesture, dismissAnimatedStyle };
}
