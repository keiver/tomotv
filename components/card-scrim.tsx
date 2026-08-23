import { LinearGradient } from "expo-linear-gradient";
import React from "react";
import { StyleSheet } from "react-native";

// Held off pure black at the foot: the title bar's own blur finishes the job, and a full-strength
// stop makes the card look like it ends early.
const STOPS = ["rgba(0, 0, 0, 0)", "rgba(0, 0, 0, 0.35)", "rgba(0, 0, 0, 0.72)"] as const;
const LOCATIONS = [0, 0.55, 1] as const;

// The plateau runs to 0.7 so the whole pill sits on it: the fade is measured along the box
// diagonal, and a two-segment pill on a portrait card already reaches 0.64 of it.
const CORNER_STOPS = ["rgba(0, 0, 0, 0.62)", "rgba(0, 0, 0, 0.44)", "rgba(0, 0, 0, 0)"] as const;
const CORNER_LOCATIONS = [0, 0.7, 1] as const;

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
 * and carries no contrast of its own: over a blown-out poster its gold glyphs measure 3.2:1
 * unscrimmed, 4.3:1 on this floor.
 */
export function CardCornerScrim() {
  return <LinearGradient colors={CORNER_STOPS} locations={CORNER_LOCATIONS} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.cornerScrim} pointerEvents="none" />;
}

const styles = StyleSheet.create({
  scrim: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    height: "45%",
  },
  cornerScrim: {
    position: "absolute",
    top: 0,
    left: 0,
    width: "70%",
    height: "50%",
  },
});
