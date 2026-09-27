import React, { useCallback, useEffect } from "react";
import { type LayoutChangeEvent, StyleSheet, View } from "react-native";
import Animated, { cancelAnimation, Easing, useAnimatedStyle, useSharedValue, withRepeat, withTiming } from "react-native-reanimated";

/** An accent band, soft on both flanks; the cells' frosted floors let it glow through. */
const SCAN_WASH = "linear-gradient(90deg, rgba(255, 195, 18, 0) 0%, rgba(255, 195, 18, 0.2) 40%, rgba(255, 195, 18, 0.38) 50%, rgba(255, 195, 18, 0.2) 60%, rgba(255, 195, 18, 0) 100%)";

/**
 * An accent wash sweeping back and forth while work runs, fading out once it settles. It fills its
 * parent from behind the parent's content, so it never occludes a focusable.
 */
export function ScanBand({ active }: { active: boolean }) {
  const sweep = useSharedValue(0);
  const fade = useSharedValue(0);
  const hostW = useSharedValue(0);
  useEffect(() => {
    if (active) {
      fade.value = withTiming(1, { duration: 250 });
      // From the left edge: withRepeat's reverse leg returns to the value held at start,
      // and the fade-out's cancelAnimation leaves the last run's mid-flight value here.
      sweep.value = 0;
      sweep.value = withRepeat(withTiming(1, { duration: 1400, easing: Easing.inOut(Easing.quad) }), -1, true);
    } else {
      fade.value = withTiming(0, { duration: 500 }, (finished) => {
        if (finished) cancelAnimation(sweep);
      });
    }
    return () => {
      cancelAnimation(sweep);
      cancelAnimation(fade);
    };
  }, [active, sweep, fade]);
  const handleLayout = useCallback((event: LayoutChangeEvent) => hostW.set(event.nativeEvent.layout.width), [hostW]);
  // translateX, never `left`: a layout prop animated on the UI thread commits into the shadow
  // tree against the guide's own row commits.
  const drift = useAnimatedStyle(() => ({ opacity: fade.value, transform: [{ translateX: (sweep.value * 0.9 - 0.05) * hostW.value }] }));
  return (
    <View style={styles.scanHost} pointerEvents="none" onLayout={handleLayout}>
      <Animated.View style={[styles.scan, drift]} />
    </View>
  );
}

const styles = StyleSheet.create({
  scanHost: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    overflow: "hidden",
  },
  scan: {
    position: "absolute",
    top: 0,
    bottom: 0,
    left: 0,
    width: "20%",
    experimental_backgroundImage: SCAN_WASH,
  },
});
