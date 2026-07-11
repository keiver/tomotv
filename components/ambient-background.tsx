import { usePosterBackdropValue } from "@/contexts/PosterBackdropContext";
import { Image } from "expo-image";
import { useEffect, useState } from "react";
import { Animated, StyleSheet, View } from "react-native";
import { useReducedMotion } from "react-native-reanimated";

interface AmbientBackgroundProps {
  /** Base canvas color. Defaults to Netflix-style dark gray (OLED-safe, avoids pure black). */
  baseColor?: string;
  /** Glow tints. Default to a dim, neutral/cool pair so content stays the focus. */
  glows?: {
    top?: string;
    bottom?: string;
  };
  /**
   * When true, washes the background with a blurred version of the currently-focused
   * grid card's poster (via PosterBackdropContext), fading the static glows out underneath.
   * Must be rendered inside a PosterBackdropProvider.
   */
  dynamic?: boolean;
}

const DEFAULT_BASE = "#141414";
const DEFAULT_GLOW_TOP = "rgba(120, 140, 170, 0.035)";
const DEFAULT_GLOW_BOTTOM = "rgba(120, 120, 130, 0.025)";

const POSTER_OPACITY = 0.3;

/**
 * Full-screen ambient background: a dark canvas with two large, very-low-opacity
 * soft glow circles offset off-screen at opposite corners. Rendered as an
 * absolute-fill layer behind screen content; never intercepts focus or touch.
 *
 * In `dynamic` mode it also crossfades a blurred poster wash of the focused card.
 */
export function AmbientBackground({ baseColor = DEFAULT_BASE, glows, dynamic = false }: AmbientBackgroundProps) {
  const topGlow = glows?.top ?? DEFAULT_GLOW_TOP;
  const bottomGlow = glows?.bottom ?? DEFAULT_GLOW_BOTTOM;

  return (
    <View pointerEvents="none" style={[styles.layer, { backgroundColor: baseColor }]}>
      {dynamic ? <DynamicLayer topGlow={topGlow} bottomGlow={bottomGlow} /> : <GlowCircles topGlow={topGlow} bottomGlow={bottomGlow} />}
    </View>
  );
}

function GlowCircles({ topGlow, bottomGlow }: { topGlow: string; bottomGlow: string }) {
  return (
    <>
      <View style={[styles.glowTopRight, { backgroundColor: topGlow }]} />
      <View style={[styles.glowBottomLeft, { backgroundColor: bottomGlow }]} />
    </>
  );
}

function DynamicLayer({ topGlow, bottomGlow }: { topGlow: string; bottomGlow: string }) {
  const source = usePosterBackdropValue();
  const [glowOpacity] = useState(() => new Animated.Value(1));
  const [posterOpacity] = useState(() => new Animated.Value(0));
  // Keep the last poster mounted so it can fade out smoothly when focus leaves the grid
  // (expo-image's transition only animates on source change, not on unmount).
  const [displaySource, setDisplaySource] = useState(source);
  const reducedMotion = useReducedMotion();

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (source) setDisplaySource(source);
    if (reducedMotion) {
      // Reduce Motion: swap the wash without the crossfade
      glowOpacity.setValue(source ? 0 : 1);
      posterOpacity.setValue(source ? POSTER_OPACITY : 0);
      return;
    }
    Animated.parallel([
      Animated.timing(glowOpacity, { toValue: source ? 0 : 1, duration: 300, useNativeDriver: true }),
      Animated.timing(posterOpacity, { toValue: source ? POSTER_OPACITY : 0, duration: 450, useNativeDriver: true }),
    ]).start();
  }, [source, glowOpacity, posterOpacity, reducedMotion]);

  return (
    <>
      {displaySource && (
        <Animated.View pointerEvents="none" style={[styles.poster, { opacity: posterOpacity }]}>
          <Image source={displaySource} style={StyleSheet.absoluteFill} contentFit="cover" transition={reducedMotion ? 0 : 450} cachePolicy="memory-disk" />
        </Animated.View>
      )}
      <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, { opacity: glowOpacity }]}>
        <GlowCircles topGlow={topGlow} bottomGlow={bottomGlow} />
      </Animated.View>
    </>
  );
}

const styles = StyleSheet.create({
  layer: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
  poster: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
  glowTopRight: {
    position: "absolute",
    top: -200,
    right: -200,
    width: 600,
    height: 600,
    borderRadius: 300,
  },
  glowBottomLeft: {
    position: "absolute",
    bottom: -300,
    left: -200,
    width: 700,
    height: 700,
    borderRadius: 350,
  },
});
