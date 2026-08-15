import { LinearGradient } from "expo-linear-gradient";
import React from "react";
import { StyleSheet } from "react-native";

// Held off pure black at the foot: the title bar's own blur finishes the job, and a full-strength
// stop makes the card look like it ends early.
const STOPS = ["rgba(0, 0, 0, 0)", "rgba(0, 0, 0, 0.35)", "rgba(0, 0, 0, 0.72)"] as const;
const LOCATIONS = [0, 0.55, 1] as const;

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

const styles = StyleSheet.create({
  scrim: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    height: "45%",
  },
});
