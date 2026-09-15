import { settingsStyles } from "@/components/settings/styles";
import { ComponentProps, ReactNode } from "react";
import { StyleSheet, View } from "react-native";
import Animated from "react-native-reanimated";

interface SectionFooterProps {
  children: ReactNode;
  /** The card's own transition, so the footer travels with the end it marks instead of snapping. */
  layout?: ComponentProps<typeof Animated.View>["layout"];
}

/**
 * The info area at the foot of a section card: full width, square across the top so it reads as
 * the card running out into it, rounded by the card's own clip. Nothing inside is pressable,
 * which is what lets it carry an overlay at all.
 */
export function SectionFooter({ children, layout }: SectionFooterProps) {
  return (
    // No clip of its own: a second mask on the card's curve lets the card's light rim bleed
    // through the antialiased corner pixels.
    <Animated.View layout={layout}>
      {children}
      {/* A dark cast shadow at the top so the rows read as stepping down into the note, plus the
          card's bottom lip and side rim re-painted above the opaque band that covers them. Its own
          shadow (noteShadow), not a row's: the note drops below the rows, and the recess's light
          rim would disappear on this darker band. */}
      <View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.shadowClip, settingsStyles.noteShadow]} />
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  // An inset boxShadow follows its own element's corners, so the overlay takes the card's bottom
  // radius to round the shadow with it. Top stays square, like the band.
  shadowClip: {
    borderBottomLeftRadius: 32,
    borderBottomRightRadius: 32,
  },
});
