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
 * soft glows anchored off-screen at opposite corners. Rendered as an absolute-fill
 * layer behind screen content; never intercepts focus or touch.
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

/**
 * The glow is held flat across its core and then faded to nothing, rather than being a
 * filled circle. A solid View with a borderRadius has a hard edge no matter how low its
 * opacity is, and on a sparse screen — Settings, with only two cards on it — that edge is
 * visible as an arc, and steps rather than fades on an OLED panel. The flat core keeps the
 * presence the filled circle had; only the boundary changes.
 *
 * `radial-gradient` in experimental_backgroundImage is implemented natively for this
 * renderer (React/Fabric/Utils/RCTRadialGradient.mm), so it draws on tvOS rather than
 * silently doing nothing.
 */
function glowGradient(color: string, position: { top?: number; bottom?: number; left?: number; right?: number }, radius: number) {
  return [
    {
      type: "radial-gradient" as const,
      shape: "circle" as const,
      size: { x: radius, y: radius },
      position: position as never,
      colorStops: [
        { color, positions: ["0%"] },
        { color, positions: ["35%"] },
        { color: "transparent", positions: ["100%"] },
      ],
    },
  ];
}

function GlowCircles({ topGlow, bottomGlow }: { topGlow: string; bottomGlow: string }) {
  return (
    <>
      <View style={[styles.glowLayer, { experimental_backgroundImage: glowGradient(topGlow, { top: -120, right: -120 }, 620) }]} />
      <View style={[styles.glowLayer, { experimental_backgroundImage: glowGradient(bottomGlow, { bottom: -180, left: -120 }, 700) }]} />
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
  // Each glow paints across the whole layer now — the gradient's own radius decides how far
  // it reaches, so the View no longer needs a size or a corner radius of its own.
  glowLayer: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
});
