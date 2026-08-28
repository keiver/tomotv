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
 * the card running out into it, rounded to the card's own bottom corners. Nothing inside is
 * pressable, which is what lets it carry an overlay at all.
 */
export function SectionFooter({ children, layout }: SectionFooterProps) {
  return (
    <Animated.View style={styles.footer} layout={layout}>
      {children}
      {/* The card's bottom lip and side rim, re-painted above the opaque content that covers
          them. The same move a filled ListRow makes at the end of a card. */}
      <View pointerEvents="none" style={[StyleSheet.absoluteFill, settingsStyles.rowShadowBottom]} />
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  footer: {
    borderBottomLeftRadius: 32,
    borderBottomRightRadius: 32,
    overflow: "hidden",
  },
});
