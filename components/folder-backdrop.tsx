import type { FolderBackdropSource } from "@/hooks/useFolderBackdrop";
import { Image } from "expo-image";
import { StyleSheet, View } from "react-native";

// Over-saturate the muted average, then screen-blend it onto the dark ambient so the colour glows
// instead of just darkening. High opacity because the tiny source reads faint otherwise.
const TINT_OPACITY_SHARP = 0.85;
const TINT_OPACITY_POSTER = 0.7;
const SATURATE = 4;

/**
 * The folder's colour glow: a tiny server-blurred source (getTintUrl) stretched full-screen,
 * over-saturated and screen-blended so its dominant colour lights the background. No animation —
 * it appears as soon as it resolves. Held for the whole folder; over the baked AmbientBackground.
 */
export function FolderBackdrop({ source }: { source: FolderBackdropSource | null }) {
  if (!source) return null;
  return (
    <View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.layer, { opacity: source.sharp ? TINT_OPACITY_SHARP : TINT_OPACITY_POSTER }]}>
      <Image source={source.uri} style={StyleSheet.absoluteFill} contentFit="cover" transition={0} cachePolicy="memory-disk" priority="high" />
    </View>
  );
}

const styles = StyleSheet.create({
  // filter over-saturates the muted average; mixBlendMode screens the result onto the dark ambient.
  layer: {
    filter: [{ saturate: SATURATE }],
    mixBlendMode: "screen",
  },
});
