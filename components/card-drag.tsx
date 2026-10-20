import { leavingByPan } from "@/components/dismiss-pan";
import React, { createContext, useContext, useEffect, useMemo } from "react";
import { ScrollView, StyleSheet, useWindowDimensions, type ScrollViewProps } from "react-native";
import { Gesture, GestureDetector, GestureHandlerRootView, type GestureType } from "react-native-gesture-handler";
import Animated, { runOnJS, scrollTo, useAnimatedRef, useAnimatedScrollHandler, useAnimatedStyle, useSharedValue, withTiming, type SharedValue } from "react-native-reanimated";

/** How long a committed drag takes the card off the screen. */
const LEAVE_MS = 200;
/** The player's settle back (dismiss-pan.tsx). */
const SETTLE_MS = 160;

interface CardDrag {
  pan: GestureType;
  /** How far down the card is dragged. */
  offset: SharedValue<number>;
  /** The shown page's scroll offset: the card follows the finger only while it is 0. */
  scrollY: SharedValue<number>;
}

const CardDragContext = createContext<CardDrag | null>(null);

/** Where the card sits for a drag: the finger's travel since the scroll last stood off its top, never above its rest. */
export function cardOffset(translationY: number, anchor: number): number {
  "worklet";
  return Math.max(0, translationY - anchor);
}

/** Drag the card down to close it, on the player's rule (leavingByPan); a drag short of it settles back. */
export function CardDragView({ onDismiss, children }: { onDismiss: () => void; children: React.ReactNode }) {
  const { height } = useWindowDimensions();
  const offset = useSharedValue(0);
  const scrollY = useSharedValue(0);
  // The finger's travel when the scroll last stood off its top, so the card starts under the finger.
  const anchor = useSharedValue(0);
  const pan = useMemo(
    () =>
      Gesture.Pan()
        .activeOffsetY(24)
        .failOffsetX([-20, 20])
        .onStart(() => {
          "worklet";
          anchor.set(0);
        })
        .onUpdate((event) => {
          "worklet";
          if (scrollY.get() > 0) anchor.set(event.translationY);
          else offset.set(cardOffset(event.translationY, anchor.get()));
        })
        .onEnd((event, success) => {
          "worklet";
          if (leavingByPan({ translationY: event.translationY - anchor.get(), velocityY: event.velocityY }, success)) {
            offset.set(
              withTiming(height, { duration: LEAVE_MS }, (finished) => {
                if (finished) runOnJS(onDismiss)();
              }),
            );
            return;
          }
          offset.set(withTiming(0, { duration: SETTLE_MS }));
        }),
    [anchor, height, offset, onDismiss, scrollY],
  );
  const drag = useMemo(() => ({ pan, offset, scrollY }), [pan, offset, scrollY]);
  const dragStyle = useAnimatedStyle(() => ({ transform: [{ translateY: offset.get() }] }));
  // Box-none down to the card, so a tap beside it still reaches the dismissing dim.
  return (
    <CardDragContext.Provider value={drag}>
      <GestureHandlerRootView style={StyleSheet.absoluteFill} pointerEvents="box-none">
        <GestureDetector gesture={pan}>
          <Animated.View style={[StyleSheet.absoluteFill, dragStyle]} pointerEvents="box-none">
            {children}
          </Animated.View>
        </GestureDetector>
      </GestureHandlerRootView>
    </CardDragContext.Provider>
  );
}

/** A scroll inside a draggable card: at its top a drag down moves the card, and the scroll holds still until the card is back. Elsewhere a plain ScrollView. */
export function CardDragScroll({ active, ...props }: ScrollViewProps & { active: boolean }) {
  const drag = useContext(CardDragContext);
  const ref = useAnimatedRef<Animated.ScrollView>();
  // This page's own offset, handed to the drag while it is the shown page.
  const own = useSharedValue(0);
  const offset = drag?.offset;
  const scrollY = drag?.scrollY;
  const onScroll = useAnimatedScrollHandler(
    (event) => {
      "worklet";
      if (!offset || !scrollY) return;
      if (offset.get() > 0) {
        scrollTo(ref, 0, 0, false);
        own.set(0);
      } else own.set(event.contentOffset.y);
      if (active) scrollY.set(own.get());
    },
    [active, offset, scrollY],
  );
  useEffect(() => {
    if (active) scrollY?.set(own.get());
  }, [active, own, scrollY]);
  const gesture = useMemo(() => (drag ? Gesture.Native().simultaneousWithExternalGesture(drag.pan) : null), [drag]);
  if (!gesture) return <ScrollView {...props} />;
  return (
    <GestureDetector gesture={gesture}>
      <Animated.ScrollView ref={ref} {...props} bounces={false} onScroll={onScroll} scrollEventThrottle={16} />
    </GestureDetector>
  );
}
