import React, { useCallback, useEffect, useMemo, useState } from "react";
import { LayoutChangeEvent, Platform, StyleSheet, Text, TextStyle, View } from "react-native";
import Animated, { Easing, cancelAnimation, useAnimatedStyle, useReducedMotion, useSharedValue, withDelay, withRepeat, withSequence, withTiming } from "react-native-reanimated";

const IS_TV = Platform.isTV;

interface MarqueeTextProps {
  children: string;
  active: boolean;
  style?: TextStyle;
  speed?: number; // px per second, default 60
}

/**
 * Single-line title that scrolls on TV while its card is focused and the text overflows.
 * At rest it is one Text: the measuring pair, the shared value and the animated style mount
 * only for the focused card, so a shelf of resting cards carries none of them.
 */
export function MarqueeText({ children, active, style, speed = 60 }: MarqueeTextProps) {
  if (!IS_TV || !active) {
    return (
      <Text style={style} numberOfLines={1}>
        {children}
      </Text>
    );
  }
  return (
    <ScrollingText style={style} speed={speed}>
      {children}
    </ScrollingText>
  );
}

/** The focused card's title: measures its overflow, then scrolls left, pauses, and scrolls back. */
function ScrollingText({ children, style, speed }: { children: string; style?: TextStyle; speed: number }) {
  const [containerWidth, setContainerWidth] = useState(0);
  const [textWidth, setTextWidth] = useState(0);
  const translateX = useSharedValue(0);
  const reducedMotion = useReducedMotion();

  const overflows = textWidth > containerWidth && containerWidth > 0;
  const scrolls = overflows && !reducedMotion;

  const onContainerLayout = useCallback((e: LayoutChangeEvent) => {
    setContainerWidth(e.nativeEvent.layout.width);
  }, []);

  const onTextLayout = useCallback((e: LayoutChangeEvent) => {
    setTextWidth(e.nativeEvent.layout.width);
  }, []);

  useEffect(() => {
    if (!scrolls) {
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
  }, [scrolls, textWidth, containerWidth, speed, translateX]);

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

  return (
    <View style={styles.container} onLayout={onContainerLayout}>
      {/* Hidden measurement text — unconstrained width for accurate overflow
          detection. Hidden from assistive tech too: it duplicates the visible
          text and would otherwise be read twice. */}
      <View style={styles.measure} pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        <Text style={innerTextStyle} onLayout={onTextLayout}>
          {children}
        </Text>
      </View>

      {/* With Reduce Motion on, never scroll: keep single-line ellipsized text */}
      <Animated.View style={[styles.slider, animatedStyle, scrolls ? { width: textWidth } : undefined]}>
        <Text style={innerTextStyle} numberOfLines={scrolls ? undefined : 1}>
          {children}
        </Text>
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
