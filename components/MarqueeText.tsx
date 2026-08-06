import React, { useCallback, useEffect, useMemo, useState } from "react";
import { LayoutChangeEvent, Platform, StyleSheet, TextStyle, View } from "react-native";
import Animated, { Easing, cancelAnimation, useAnimatedStyle, useReducedMotion, useSharedValue, withDelay, withRepeat, withSequence, withTiming } from "react-native-reanimated";

const IS_TV = Platform.isTV;

interface MarqueeTextProps {
  children: string;
  active: boolean;
  style?: TextStyle;
  speed?: number; // px per second, default 60
}

/**
 * MarqueeText - Scrolls long text horizontally when active (focused) and text overflows.
 *
 * On phone (non-TV): renders as a simple single-line truncated Text (no animation).
 * On TV: when `active` is true and text is wider than its container, animates
 * translateX to scroll the text left, pauses, then scrolls back.
 */
export function MarqueeText({ children, active, style, speed = 60 }: MarqueeTextProps) {
  const [containerWidth, setContainerWidth] = useState(0);
  const [textWidth, setTextWidth] = useState(0);
  const translateX = useSharedValue(0);
  const reducedMotion = useReducedMotion();

  const overflows = textWidth > containerWidth && containerWidth > 0;

  const onContainerLayout = useCallback((e: LayoutChangeEvent) => {
    setContainerWidth(e.nativeEvent.layout.width);
  }, []);

  const onTextLayout = useCallback((e: LayoutChangeEvent) => {
    setTextWidth(e.nativeEvent.layout.width);
  }, []);

  useEffect(() => {
    if (!IS_TV || !active || !overflows || reducedMotion) {
      cancelAnimation(translateX);
      translateX.value = withTiming(0, { duration: 150 });
      return;
    }

    const overflow = textWidth - containerWidth;
    const scrollMs = (overflow / speed) * 1000;

    translateX.value = withRepeat(
      withSequence(withDelay(300, withTiming(-overflow, { duration: scrollMs, easing: Easing.linear })), withDelay(800, withTiming(0, { duration: scrollMs, easing: Easing.linear }))),
      -1,
    );

    return () => {
      cancelAnimation(translateX);
    };
  }, [active, overflows, textWidth, containerWidth, speed, translateX, reducedMotion]);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: translateX.value }],
  }));

  // Strip width from the passed style so the inner text can expand
  // to its natural width for accurate overflow measurement.
  const innerTextStyle = useMemo(() => {
    if (!style) return style;
    const { width: _width, ...rest } = style as TextStyle & { width?: unknown };
    return rest;
  }, [style]);

  // Phone: simple truncated text, no animation
  if (!IS_TV) {
    return (
      <Animated.Text style={style} numberOfLines={1}>
        {children}
      </Animated.Text>
    );
  }

  return (
    <View style={styles.container} onLayout={onContainerLayout}>
      {/* Hidden measurement text — unconstrained width for accurate overflow
          detection. Hidden from assistive tech too: it duplicates the visible
          text and would otherwise be read twice. */}
      <View style={styles.measure} pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        <Animated.Text style={innerTextStyle} onLayout={onTextLayout}>
          {children}
        </Animated.Text>
      </View>

      {/* With Reduce Motion on, never scroll: keep single-line ellipsized text */}
      <Animated.View style={[styles.slider, animatedStyle, overflows && active && !reducedMotion ? { width: textWidth } : undefined]}>
        <Animated.Text style={innerTextStyle} numberOfLines={overflows && active && !reducedMotion ? undefined : 1}>
          {children}
        </Animated.Text>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    overflow: "hidden",
    width: "100%",
  },
  measure: {
    position: "absolute",
    opacity: 0,
    width: 99999,
    alignItems: "flex-start",
  },
  slider: {
    flexDirection: "row",
    // Center the text when it fits; when it overflows the slider is given an
    // explicit text-width and scrolls from the left, so centering is a no-op.
    justifyContent: "center",
  },
});
