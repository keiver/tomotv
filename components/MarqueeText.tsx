import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Animated, Easing, LayoutChangeEvent, Platform, StyleSheet, Text, TextStyle, useAnimatedValue, View } from "react-native";
import { useReducedMotion } from "react-native-reanimated";

const IS_TV = Platform.isTV;
/** Scroll there and back this many times, then rest on the ellipsized title. */
export const MARQUEE_PLAYS = 4;

interface MarqueeTextProps {
  children: string;
  active: boolean;
  style?: TextStyle;
  speed?: number; // px per second, default 60
}

/**
 * Single-line title that scrolls on TV while its card is focused and the text overflows.
 * At rest it is one Text: the measuring pair and the animated value mount only for the
 * focused card, so a shelf of resting cards carries none of them.
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

/** The focused card's title: measures its overflow, then scrolls left, pauses, and scrolls back, MARQUEE_PLAYS times. */
function ScrollingText({ children, style, speed }: { children: string; style?: TextStyle; speed: number }) {
  const [containerWidth, setContainerWidth] = useState(0);
  const [textWidth, setTextWidth] = useState(0);
  const [playedTitle, setPlayedTitle] = useState<string | null>(null);
  const translateX = useAnimatedValue(0);
  const reducedMotion = useReducedMotion();

  const overflows = textWidth > containerWidth && containerWidth > 0;
  const scrolls = overflows && !reducedMotion && playedTitle !== children;

  const onContainerLayout = useCallback((e: LayoutChangeEvent) => {
    setContainerWidth(e.nativeEvent.layout.width);
  }, []);

  const onTextLayout = useCallback((e: LayoutChangeEvent) => {
    setTextWidth(e.nativeEvent.layout.width);
  }, []);

  useEffect(() => {
    if (!scrolls) return;
    const overflow = textWidth - containerWidth;
    const scrollMs = (overflow / speed) * 1000;
    // Native driver: frames go through synchronouslyUpdateViewOnUIThread, not a shadow-tree commit.
    const pass = Animated.sequence([
      Animated.timing(translateX, { toValue: -overflow, duration: scrollMs, delay: 300, easing: Easing.linear, useNativeDriver: true }),
      Animated.timing(translateX, { toValue: 0, duration: scrollMs, delay: 800, easing: Easing.linear, useNativeDriver: true }),
    ]);
    const loop = Animated.loop(pass, { iterations: MARQUEE_PLAYS });
    loop.start(({ finished }) => {
      if (finished) setPlayedTitle(children);
    });
    return () => {
      loop.stop();
      translateX.setValue(0);
    };
  }, [scrolls, textWidth, containerWidth, speed, translateX, children]);

  // Strip width from the passed style so the inner text can expand
  // to its natural width for accurate overflow measurement.
  const innerTextStyle = useMemo(() => {
    if (!style) return style;
    const { width: _width, ...rest } = style as TextStyle & { width?: unknown };
    return rest;
  }, [style]);

  return (
    <View style={styles.container} onLayout={onContainerLayout}>
      {/* Hidden measurement text, unconstrained width for accurate overflow
          detection. Hidden from assistive tech too: it duplicates the visible
          text and would otherwise be read twice. */}
      <View style={styles.measure} pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        <Text style={innerTextStyle} onLayout={onTextLayout}>
          {children}
        </Text>
      </View>

      {/* With Reduce Motion on, or once the plays are spent, never scroll: single-line ellipsized text */}
      <Animated.View style={[styles.slider, { transform: [{ translateX }] }, scrolls ? { width: textWidth } : undefined]}>
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
