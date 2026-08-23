import { settingsStyles } from "@/components/settings/styles";
import { ReactNode } from "react";
import { StyleSheet, View } from "react-native";

interface SectionFooterProps {
  children: ReactNode;
}

/**
 * The info area at the foot of a section card: full width, square across the top so it reads as
 * the card running out into it, rounded to the card's own bottom corners. Nothing inside is
 * pressable, which is what lets it carry an overlay at all.
 */
export function SectionFooter({ children }: SectionFooterProps) {
  return (
    <View style={styles.footer}>
      {children}
      {/* The card's bottom lip and side rim, re-painted above the opaque content that covers
          them. The same move a filled ListRow makes at the end of a card. */}
      <View pointerEvents="none" style={[StyleSheet.absoluteFill, settingsStyles.rowShadowBottom]} />
    </View>
  );
}

const styles = StyleSheet.create({
  footer: {
    borderBottomLeftRadius: 32,
    borderBottomRightRadius: 32,
    overflow: "hidden",
  },
});
