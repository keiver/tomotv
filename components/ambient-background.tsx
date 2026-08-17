import { Image, StyleSheet, View } from "react-native";

interface AmbientBackgroundProps {
  /** Base canvas color. Defaults to Netflix-style dark gray (OLED-safe, avoids pure black). */
  baseColor?: string;
  /** Glow tints. Default to a cool/warm duotone pair so content stays the focus. */
  glows?: {
    top?: string;
    bottom?: string;
  };
}

const DEFAULT_BASE = "#141414";
// Duotone: cinematic slate blue up top, an ember in the gold accent's family below —
// a clearly visible wash, still dim enough that artwork stays the brightest thing on screen.
const DEFAULT_GLOW_TOP = "rgba(96, 132, 186, 0.16)";
const DEFAULT_GLOW_BOTTOM = "rgba(214, 150, 52, 0.11)";

// Grain amplitude for the dither overlay. Dark, slow gradients quantize into visible bands
// on 8-bit panels (older TVs especially); fine per-pixel noise at a few percent breaks the
// band edges up so the eye reads the fade as smooth. ~3% adds ±4 luminance of texture and
// lifts the black floor by ~1.5%, which the base color absorbs.
const NOISE_OPACITY = 0.03;

/**
 * Full-screen ambient background: a dark canvas, two large soft duotone glows anchored
 * off-screen at opposite corners, and a tiling noise layer that dithers the whole composite.
 * Rendered as an absolute-fill layer behind screen content; never intercepts focus or touch.
 * One static canvas everywhere — a focus-driven artwork wash was tried and pulled: it fought
 * the grid for attention.
 */
export function AmbientBackground({ baseColor = DEFAULT_BASE, glows }: AmbientBackgroundProps) {
  const topGlow = glows?.top ?? DEFAULT_GLOW_TOP;
  const bottomGlow = glows?.bottom ?? DEFAULT_GLOW_BOTTOM;

  return (
    <View pointerEvents="none" style={[styles.layer, { backgroundColor: baseColor }]}>
      <GlowCircles topGlow={topGlow} bottomGlow={bottomGlow} />
      {/* 128px grayscale noise tiled 1:1 over the gradient (scripts/generate-dither-noise
          regenerates the asset). Above the glows so the dither applies to the composite. */}
      <Image source={require("@/assets/images/dither-noise.png")} resizeMode="repeat" style={[styles.layer, { opacity: NOISE_OPACITY }]} fadeDuration={0} />
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
      <View style={[styles.glowLayer, { experimental_backgroundImage: glowGradient(topGlow, { top: -120, right: -120 }, 920) }]} />
      <View style={[styles.glowLayer, { experimental_backgroundImage: glowGradient(bottomGlow, { bottom: -180, left: -120 }, 1000) }]} />
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
  // Each glow paints across the whole layer — the gradient's own radius decides how far
  // it reaches, so the View needs no size or corner radius of its own.
  glowLayer: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
});
