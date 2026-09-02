import { CARD_FOCUS } from "@/constants/app";
import { COLORS } from "@/constants/colors";
import { Image } from "expo-image";
import { Platform, StyleSheet, View } from "react-native";

const IS_TV = Platform.isTV;

/**
 * The artwork a list row leads with. Fills the row's leading tile inside the rim every
 * card carries at rest; falls back to the brand face, which is what a card with no
 * artwork shows.
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
  frame: {
    width: "100%",
    height: "100%",
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
