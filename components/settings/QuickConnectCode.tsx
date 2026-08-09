import React from "react";
import { Platform, StyleSheet, Text, View } from "react-native";

const IS_TV = Platform.isTV;

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
  return (
    <View style={styles.wrap} accessible={IS_TV} accessibilityLabel={IS_TV ? `Quick Connect code: ${spokenCode}. Enter it in your server's Quick Connect section.` : undefined}>
      <Text style={styles.code} accessible={false} importantForAccessibility="no" numberOfLines={1} adjustsFontSizeToFit={true} minimumFontScale={0.5}>
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
    fontSize: IS_TV ? 100 : 76,
    fontWeight: "700",
    fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace",
    color: "#FFC312",
    letterSpacing: IS_TV ? 18 : 12,
    textAlign: "center",
  },
});
