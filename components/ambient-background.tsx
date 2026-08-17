import { Image, StyleSheet, View } from "react-native";

interface AmbientBackgroundProps {
  /** Which baked canvas to show. `filters` is the dim acid/rust pair the Filters screen uses. */
  variant?: "default" | "filters";
}

// Grain amplitude for the film-texture tile. Banding is already killed inside the baked
// asset (TPDF dither before quantization); this layer is texture only.
const NOISE_OPACITY = 0.04;

// Baked 1920x1080 canvases (scripts/generate-ambient-background.py): base, duotone glows
// and vignette composited in float and dithered BEFORE 8-bit quantization. Runtime
// gradients quantize into bands on 8-bit panels; a pre-dithered asset cannot.
const VARIANTS = {
  default: { base: "#141414", image: require("@/assets/images/ambient-background.png") },
  filters: { base: "#0D0D0F", image: require("@/assets/images/ambient-background-filters.png") },
} as const;

/**
 * Full-screen ambient background: a baked cinematic canvas (dark base, duotone corner
 * glows over a vignette) under a 1:1 tiling grain layer. Rendered as an absolute-fill
 * layer behind screen content; never intercepts focus or touch. One static canvas
 * everywhere — a focus-driven artwork wash was tried and pulled: it fought the grid for
 * attention.
 */
export function AmbientBackground({ variant = "default" }: AmbientBackgroundProps) {
  const { base, image } = VARIANTS[variant];
  return (
    <View pointerEvents="none" style={[styles.layer, { backgroundColor: base }]}>
      <Image source={image} resizeMode="cover" style={styles.layer} fadeDuration={0} />
      <Image source={require("@/assets/images/dither-noise.png")} resizeMode="repeat" style={[styles.layer, { opacity: NOISE_OPACITY }]} fadeDuration={0} />
    </View>
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
});
