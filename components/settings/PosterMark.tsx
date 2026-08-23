import { CARD_FOCUS } from "@/constants/app";
import { COLORS } from "@/constants/colors";
import { Image } from "expo-image";
import { Platform, StyleSheet, View } from "react-native";

const IS_TV = Platform.isTV;

// The row's two text lines plus the gap between them. Any taller and the row outgrows
// DOWNLOAD_ROW_HEIGHT, which the list's height cap is arithmetic on.
const SIDE = IS_TV ? 64 : 42;

/**
 * The artwork a list row leads with, square so a poster and an album cover hold the same
 * column. Falls back to the brand face, which is what a card with no artwork shows.
 */
export function PosterMark({ uri }: { uri: string | null }) {
  return (
    <View style={styles.frame} accessibilityElementsHidden>
      {uri ? (
        <Image source={{ uri }} style={styles.art} contentFit="cover" transition={0} cachePolicy="memory-disk" />
      ) : (
        <Image source={require("@/assets/brand/layer-front.png")} style={styles.art} contentFit="cover" transition={0} />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  // The same rim every card carries at rest. It is what gives the brand-face placeholder an
  // edge: the face is a full-bleed image with no shape of its own.
  frame: {
    width: SIDE,
    height: SIDE,
    borderRadius: IS_TV ? 8 : 6,
    borderWidth: IS_TV ? 2 : 1,
    borderColor: CARD_FOCUS.BORDER_COLOR,
    overflow: "hidden",
    backgroundColor: COLORS.SURFACE,
  },
  art: {
    width: "100%",
    height: "100%",
  },
});
