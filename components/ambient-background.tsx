import { Image, ImageRef } from "expo-image";
import { StyleSheet, View, useWindowDimensions } from "react-native";

interface AmbientBackgroundProps {
  /** Which baked canvas to show. `filters` is the dim acid/rust pair the Filters screen uses. */
  variant?: "default" | "filters";
}

// Baked canvases (scripts/generate-ambient-background.py): glows and vignette composited
// in float and dithered BEFORE 8-bit quantization. Runtime gradients quantize into bands
// on 8-bit panels; a pre-dithered asset cannot. Each orientation has its own bake —
// cover-fit would crop the landscape canvas to its center slice on a portrait window and
// lose every corner glow.
const VARIANTS = {
  default: {
    base: "#141414",
    landscape: require("@/assets/images/ambient-background.png"),
    portrait: require("@/assets/images/ambient-background-portrait.png"),
  },
  filters: {
    base: "#0D0D0F",
    landscape: require("@/assets/images/ambient-background-filters.png"),
    portrait: require("@/assets/images/ambient-background-filters-portrait.png"),
  },
} as const;

// Decoded canvases, keyed "<variant>:<orientation>", held for the app's lifetime so every
// screen after startup paints from memory instead of re-decoding the PNG.
const decodedCanvases = new Map<string, ImageRef>();

/** Decode every baked canvas once (called at startup) so screens never pop in. */
export function preloadAmbientBackgrounds(): void {
  for (const [variantName, variant] of Object.entries(VARIANTS)) {
    for (const orientation of ["landscape", "portrait"] as const) {
      const key = `${variantName}:${orientation}`;
      if (decodedCanvases.has(key)) continue;
      Image.loadAsync(variant[orientation])
        .then((ref) => decodedCanvases.set(key, ref))
        .catch(() => {}); // decode failure just falls back to the lazy path
    }
  }
}

/**
 * Full-screen ambient background: a baked monochrome canvas — a soft neutral light from
 * above the frame over a theater-black vignette. Rendered as an absolute-fill layer
 * behind screen content; never intercepts focus or touch. One static canvas everywhere —
 * a focus-driven artwork wash was tried and pulled: it fought the grid for attention.
 */
export function AmbientBackground({ variant = "default" }: AmbientBackgroundProps) {
  const { width, height } = useWindowDimensions();
  const { base, ...images } = VARIANTS[variant];
  const orientation = height > width ? "portrait" : "landscape";
  const image = decodedCanvases.get(`${variant}:${orientation}`) ?? images[orientation];
  return (
    <View pointerEvents="none" style={[styles.layer, { backgroundColor: base }]}>
      <Image source={image} contentFit="cover" transition={0} style={styles.layer} />
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
