import React from "react";
import { Platform, StyleSheet, View } from "react-native";

const IS_TV = Platform.isTV;

// Radii are the box's own, so the wash reaches zero exactly at its edges instead of cutting a
// line across the poster. Dense to 0.6 because the pill reaches 0.63 of the radius on a portrait card.
const CORNER_STOPS = "rgba(0, 0, 0, 0.9) 0%, rgba(0, 0, 0, 0.84) 30%, rgba(0, 0, 0, 0.62) 60%, rgba(0, 0, 0, 0.2) 82%, rgba(0, 0, 0, 0) 100%";
const CORNER_WASH = `radial-gradient(ellipse 100% 100% at 0% 0%, ${CORNER_STOPS})`;

/**
 * Top-left wash under the index pill, on a FOCUSED artwork card. Focus decoration: at rest the
 * pill's own fill is what separates it from the poster, and this would just darken every corner.
 */
export function CardCornerScrim() {
  return <View style={styles.cornerScrim} pointerEvents="none" />;
}

const styles = StyleSheet.create({
  // Proportional so a small card gets a small wash, capped so a 533pt landscape card does not
  // get a card-wide one. The pill it covers is the same size on both.
  cornerScrim: {
    position: "absolute",
    top: 0,
    left: 0,
    width: "95%",
    maxWidth: IS_TV ? 300 : 170,
    height: "58%",
    maxHeight: IS_TV ? 190 : 115,
    experimental_backgroundImage: CORNER_WASH,
  },
});
