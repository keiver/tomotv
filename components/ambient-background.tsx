import { COLORS } from "@/constants/colors";
import { useUiPreferences } from "@/hooks/useUiPreferences";
import { cardPalette, NEUTRAL_GLOW } from "@/services/cardTheme";
import { Image, ImageRef } from "expo-image";
import { StyleSheet, View, useWindowDimensions } from "react-native";

interface AmbientBackgroundProps {
  /** Which canvas to show. `filters` is the dim acid/rust pair the Filters screen uses. */
  variant?: "default" | "filters";
}

// Baked canvases (scripts/generate-ambient-background.py): glows and vignette composited
// in float and dithered BEFORE 8-bit quantization. Runtime gradients quantize into bands
// on 8-bit panels; a pre-dithered asset cannot. Each orientation has its own bake, since
// cover-fit would crop the landscape canvas to its center slice on a portrait window and
// lose every corner glow.
//
// The default canvas is three layers: the base field on the View, a black shade mask
// holding the vignette, and a glow mask drawn as a template image (tintColor colours by
// alpha) so the chosen theme hues the light. The Tomo canvas tints it the neutral white.
const CANVAS_BASE = "#1C1C1E";
const DEFAULT_MASKS = {
  shade: {
    landscape: require("@/assets/images/ambient-background-shade.png"),
    portrait: require("@/assets/images/ambient-background-shade-portrait.png"),
  },
  glow: {
    landscape: require("@/assets/images/ambient-background-glow.png"),
    portrait: require("@/assets/images/ambient-background-glow-portrait.png"),
  },
} as const;
const FILTERS = {
  base: COLORS.BACKGROUND_DEEP,
  landscape: require("@/assets/images/ambient-background-filters.png"),
  portrait: require("@/assets/images/ambient-background-filters-portrait.png"),
} as const;

// Decoded canvases, keyed by their asset module, held for the app's lifetime so every
// screen after startup paints from memory instead of re-decoding the PNG.
const decodedCanvases = new Map<number, ImageRef>();

function canvas(asset: number): ImageRef | number {
  return decodedCanvases.get(asset) ?? asset;
}

/** Decode every baked canvas once (called at startup) so screens never pop in. */
export function preloadAmbientBackgrounds(): void {
  for (const asset of [DEFAULT_MASKS.shade.landscape, DEFAULT_MASKS.shade.portrait, FILTERS.landscape, FILTERS.portrait]) {
    if (decodedCanvases.has(asset)) continue;
    Image.loadAsync(asset)
      .then((ref) => decodedCanvases.set(asset, ref))
      .catch(() => {}); // decode failure just falls back to the lazy path
  }
}

/**
 * Full-screen ambient background: a soft light from above the frame over a theater-black
 * vignette, the light in the chosen theme's glow (the Tomo canvas keeps it neutral).
 * Rendered as an absolute-fill layer behind screen content; never intercepts focus or
 * touch. One static canvas everywhere, since a focus-driven artwork wash was tried and
 * pulled: it fought the grid for attention.
 */
export function AmbientBackground({ variant = "default" }: AmbientBackgroundProps) {
  const { width, height } = useWindowDimensions();
  const prefs = useUiPreferences();
  const orientation = height > width ? "portrait" : "landscape";
  if (variant === "filters") {
    return (
      <View pointerEvents="none" style={[styles.layer, { backgroundColor: FILTERS.base }]}>
        <Image source={canvas(FILTERS[orientation])} contentFit="cover" transition={0} style={styles.layer} />
      </View>
    );
  }
  const glow = prefs.background === "accent" ? cardPalette(prefs.cardTheme.accent).glow : NEUTRAL_GLOW;
  return (
    <View pointerEvents="none" style={[styles.layer, { backgroundColor: CANVAS_BASE }]}>
      <Image source={canvas(DEFAULT_MASKS.shade[orientation])} contentFit="cover" transition={0} style={styles.layer} />
      {/* The glow takes the asset module, never a decoded ref: expo-image draws a ref once in its
          source setter and cannot re-tint it, so a theme change would leave the old colour. */}
      <Image source={DEFAULT_MASKS.glow[orientation]} contentFit="cover" transition={0} tintColor={glow} style={styles.layer} />
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
