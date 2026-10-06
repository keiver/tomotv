import React, { createContext, useEffect, useMemo, useState } from "react";
import { StyleSheet, useWindowDimensions, View } from "react-native";
import { Gesture, GestureDetector, GestureHandlerRootView, type GestureType } from "react-native-gesture-handler";
import Animated, { cancelAnimation, Easing, runOnJS, useAnimatedStyle, useSharedValue, withTiming } from "react-native-reanimated";

// The photo viewer's drag rule: a release moves on past this share of the width, or on a flick this fast (pt/s).
const COMMIT_FRACTION = 0.35;
const COMMIT_VELOCITY = 700;
const SETTLE_MS = 300;
/** Past either end the pages follow a third of the finger's travel. */
const EDGE_RESISTANCE = 1 / 3;

/** The pager's drag, for a scrollable child that must keep a horizontal drag starting on it. */
export const SiblingPagerGesture = createContext<GestureType | null>(null);

/** Where the pages sit for a drag: free toward a mounted neighbour, never past it, resisted past an end. */
export function dragOffset(start: number, translationX: number, width: number, canPrev: boolean, canNext: boolean): number {
  "worklet";
  const raw = start + translationX;
  if (raw < 0) return canNext ? Math.max(raw, -width) : raw * EDGE_RESISTANCE;
  return canPrev ? Math.min(raw, width) : raw * EDGE_RESISTANCE;
}

/** The page a release lands on, as a step from the shown one. A negative offset is the next page coming in. */
export function releaseStep(offset: number, velocityX: number, width: number, canPrev: boolean, canNext: boolean): -1 | 0 | 1 {
  "worklet";
  const step = offset < 0 ? 1 : offset > 0 ? -1 : 0;
  if (step === 0 || width <= 0 || (step === 1 && !canNext) || (step === -1 && !canPrev)) return 0;
  const onward = -velocityX * step;
  if (onward > COMMIT_VELOCITY) return step;
  if (onward < -COMMIT_VELOCITY) return 0;
  return Math.abs(offset) / width > COMMIT_FRACTION ? step : 0;
}

/** The pages kept mounted, relative to `origin`: the shown one and its neighbours that exist. */
export function pageWindow(center: number, origin: number, count: number): number[] {
  return [center - 1, center, center + 1].filter((rel) => origin + rel >= 0 && origin + rel < count);
}

interface SiblingPagerProps {
  /** Every page in order. */
  ids: readonly string[];
  /** The page the pager opens on. Pages are placed relative to it, so the list arriving later moves nothing. */
  initialId: string;
  renderPage: (id: string, active: boolean) => React.ReactNode;
  /** Touches on a page's empty area reach what is under the pager (iPad's dismissing dim). */
  passThrough?: boolean;
}

/**
 * Drag left or right to the neighbouring page. Three pages stay mounted, each at a fixed place
 * on one track; the drag and the settle move only the track, on the UI thread, and the shown
 * index flips there too, in the frame the slide ends. React re-windows afterwards, so a page
 * never moves under a commit and nothing remounts mid-swipe.
 */
export function SiblingPager({ ids, initialId, renderPage, passThrough }: SiblingPagerProps) {
  const { width: windowWidth } = useWindowDimensions();
  const [width, setWidth] = useState(windowWidth);
  const widthSV = useSharedValue(windowWidth);
  const origin = Math.max(0, ids.indexOf(initialId));
  const count = ids.length;
  const [center, setCenter] = useState(0);
  const centerSV = useSharedValue(0);
  const offset = useSharedValue(0);
  const dragStart = useSharedValue(0);
  // Whether the neighbour a drag would reveal is mounted. Cleared on the UI thread as a step lands,
  // set again once React has mounted the new window.
  const canPrev = useSharedValue(false);
  const canNext = useSharedValue(false);
  const hasPrev = origin + center - 1 >= 0;
  const hasNext = origin + center + 1 < count;
  useEffect(() => {
    canPrev.set(hasPrev);
    canNext.set(hasNext);
  }, [center, hasPrev, hasNext, canPrev, canNext]);

  useEffect(() => {
    widthSV.set(width);
  }, [width, widthSV]);

  const pan = useMemo(
    () =>
      Gesture.Pan()
        .enabled(count > 1)
        .activeOffsetX([-12, 12])
        .failOffsetY([-16, 16])
        .enableTrackpadTwoFingerGesture(true)
        .onStart(() => {
          "worklet";
          cancelAnimation(offset);
          dragStart.set(offset.get());
        })
        .onUpdate((event) => {
          "worklet";
          offset.set(dragOffset(dragStart.get(), event.translationX, widthSV.get(), canPrev.get(), canNext.get()));
        })
        .onEnd((event, success) => {
          "worklet";
          const pageWidth = widthSV.get();
          const step = success ? releaseStep(offset.get(), event.velocityX, pageWidth, canPrev.get(), canNext.get()) : 0;
          const target = -step * pageWidth;
          const remaining = pageWidth > 0 ? Math.abs(target - offset.get()) / pageWidth : 0;
          offset.set(
            withTiming(target, { duration: Math.max(120, SETTLE_MS * remaining), easing: Easing.out(Easing.cubic) }, (finished) => {
              if (!finished || step === 0) return;
              const next = centerSV.get() + step;
              centerSV.set(next);
              offset.set(0);
              canPrev.set(false);
              canNext.set(false);
              runOnJS(setCenter)(next);
            }),
          );
        }),
    [count, offset, dragStart, widthSV, centerSV, canPrev, canNext],
  );

  const trackStyle = useAnimatedStyle(() => ({ transform: [{ translateX: offset.get() - centerSV.get() * widthSV.get() }] }));
  const pointerEvents = passThrough ? "box-none" : "auto";

  return (
    <GestureHandlerRootView style={StyleSheet.absoluteFill} pointerEvents={pointerEvents} onLayout={(event) => setWidth(event.nativeEvent.layout.width)}>
      <SiblingPagerGesture.Provider value={pan}>
        <GestureDetector gesture={pan}>
          <Animated.View style={[StyleSheet.absoluteFill, trackStyle]} pointerEvents={pointerEvents}>
            {pageWindow(center, origin, count).map((rel) => {
              const id = ids[origin + rel];
              const active = rel === center;
              return (
                <View
                  key={id}
                  style={[styles.page, { left: rel * width, width }]}
                  pointerEvents={pointerEvents}
                  accessibilityElementsHidden={!active}
                  importantForAccessibility={active ? "auto" : "no-hide-descendants"}>
                  {renderPage(id, active)}
                </View>
              );
            })}
          </Animated.View>
        </GestureDetector>
      </SiblingPagerGesture.Provider>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  page: {
    position: "absolute",
    top: 0,
    bottom: 0,
  },
});
