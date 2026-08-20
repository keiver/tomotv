import { COLORS } from "@/constants/colors";
import React from "react";
import { Platform, StyleSheet, Text, View, useWindowDimensions } from "react-native";

const IS_TV = Platform.isTV;
const LETTER_SPACING = IS_TV ? 18 : 12;

/**
 * letterSpacing is emitted after the last glyph too, so a centered run sits half a
 * letterspace left of true center. Carrying that gap on the left edge instead cancels
 * it, and the digits land dead center inside the requested inset.
 */
const pad = (inset: number) => ({ paddingLeft: inset + LETTER_SPACING, paddingRight: inset });

interface QuickConnectCodeProps {
  code: string;
  /** Digit-by-digit reading, e.g. "6 9 0 1 7 3". */
  spokenCode: string;
}

/**
 * Display-only Quick Connect code, dead center and sized to the card width. Touch platforms
 * wrap the whole card in a copy Pressable (QuickConnectSection owns it, and the
 * accessibility surface with it). No visible coach text — the instruction lives in the
 * a11y layer.
 */
export function QuickConnectCode({ code, spokenCode }: QuickConnectCodeProps) {
  const { width } = useWindowDimensions();
  // Padding and cap ride the window so the code keeps the same optical margin on a
  // small phone as on a Pro Max, instead of one fixed inset that crowds the narrow one.
  const sizing = IS_TV ? { ...pad(56), fontSize: 100 } : { ...pad(Math.round(Math.min(28, Math.max(16, width * 0.05)))), fontSize: Math.min(76, Math.round(width * 0.19)) };

  return (
    <View style={styles.wrap} accessible={IS_TV} accessibilityLabel={IS_TV ? `Quick Connect code: ${spokenCode}. Enter it in your server's Quick Connect section.` : undefined}>
      <Text style={[styles.code, sizing]} accessible={false} importantForAccessibility="no" numberOfLines={1} adjustsFontSizeToFit={true} minimumFontScale={0.5}>
        {code}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    alignSelf: "stretch",
    alignItems: "center",
  },
  code: {
    width: "100%",
    fontWeight: "700",
    fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace",
    color: COLORS.ACCENT,
    letterSpacing: LETTER_SPACING,
    textAlign: "center",
  },
});
