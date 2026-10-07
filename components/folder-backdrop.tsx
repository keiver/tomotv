import type { FolderBackdropSource } from "@/hooks/useFolderBackdrop";
import { Image } from "expo-image";
import { StyleSheet, View } from "react-native";

// Under the grid's own art, so the cards stay the brightest thing on screen.
const OPACITY = 0.55;

/**
 * The folder's art behind its grid, server-blurred (getTintUrl) and stretched full-screen. No animation;
 * it appears as soon as it resolves. Held for the whole folder, over the baked AmbientBackground.
 */
export function FolderBackdrop({ source }: { source: FolderBackdropSource | null }) {
  if (!source) return null;
  return (
    <View pointerEvents="none" style={[StyleSheet.absoluteFill, { opacity: OPACITY }]}>
      <Image source={source.uri} style={StyleSheet.absoluteFill} contentFit="cover" transition={0} cachePolicy="memory-disk" priority="high" />
    </View>
  );
}
