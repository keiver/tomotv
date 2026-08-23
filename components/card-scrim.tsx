import { LinearGradient } from "expo-linear-gradient";
import React from "react";
import { Platform, StyleSheet, View } from "react-native";

const IS_TV = Platform.isTV;

// Held off pure black at the foot: the title bar's own blur finishes the job, and a full-strength
// stop makes the card look like it ends early.
const STOPS = ["rgba(0, 0, 0, 0)", "rgba(0, 0, 0, 0.35)", "rgba(0, 0, 0, 0.72)"] as const;
const LOCATIONS = [0, 0.55, 1] as const;

// Radii are the box's own, so the wash reaches zero exactly at its edges instead of cutting a
// line across the poster. Dense to 0.65 because the pill reaches 0.63 of the radius on a portrait card.
const CORNER_WASH = "radial-gradient(ellipse 100% 100% at 0% 0%, rgba(0, 0, 0, 0.72) 0%, rgba(0, 0, 0, 0.68) 35%, rgba(0, 0, 0, 0.56) 65%, rgba(0, 0, 0, 0.26) 85%, rgba(0, 0, 0, 0) 100%)";

/**
 * Bottom-of-artwork scrim, under the title bar.
 *
 * The bar is a dark BlurView, and blurred bright artwork is still bright — a white title over
 * colour bars or a blown-out sky was barely legible. A fixed floor under it means the title's
 * contrast no longer depends on what the poster happens to be.
 *
 * Artwork only. A placeholder card has nothing to scrim, and darkening it just dims the bevel.
 */
export function CardScrim() {
  return <LinearGradient colors={STOPS} locations={LOCATIONS} style={styles.scrim} pointerEvents="none" />;
}

/**
 * Top-left floor under the index pill, on artwork cards that draw one. The focused pill is glass
 * and carries no contrast of its own: over a blown-out poster its gold glyphs measure 2.4:1
 * unscrimmed and 6.3:1 on this wash.
 */
export function CardCornerScrim() {
  return <View style={styles.cornerScrim} pointerEvents="none" />;
}

const styles = StyleSheet.create({
  scrim: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    height: "45%",
  },
  // Proportional so a small card gets a small wash, capped so a 533pt landscape card does not
  // get a card-wide one — the pill it covers is the same size on both.
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
