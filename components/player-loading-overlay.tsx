import { COLORS } from "@/constants/colors";
import React from "react";
import { ActivityIndicator, Platform, Pressable, StyleSheet, View } from "react-native";

/**
 * The player's black loading canvas, and on tvOS the screen's focus anchor.
 *
 * The anchor cannot be a sibling of this overlay. react-native-tvos Fabric
 * forces `isUserInteractionEnabled = YES` on plain views, so an opaque absolute
 * overlay occludes UIKit focus for everything beneath it (`pointerEvents` cannot
 * opt out) — which is every focusable the player has while it loads: AVKit's
 * transport bar, and the invisible holders this component replaces. With focus
 * stranded outside the pushed screen, Menu finds no responder chain to the
 * navigation controller and the system backgrounds the app instead of popping
 * (see memories/CLAUDE-lessons-learned.md — the audio-player Menu case and the
 * PR #61 overlay case).
 *
 * So the topmost view IS the focusable: by construction nothing can occlude it,
 * and no future overlay can silently break Menu by out-stacking a holder's
 * zIndex. Menu handling stays zero-JS.
 */
export function PlayerLoadingOverlay() {
  if (Platform.isTV) {
    return (
      <Pressable isTVSelectable hasTVPreferredFocus onPress={() => {}} style={styles.overlay} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        <ActivityIndicator size="large" color={COLORS.TEXT_PRIMARY} />
      </Pressable>
    );
  }

  return (
    <View style={styles.overlay}>
      <ActivityIndicator size="large" color={COLORS.TEXT_PRIMARY} />
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: COLORS.MEDIA_BACKGROUND,
    zIndex: 100,
  },
});
