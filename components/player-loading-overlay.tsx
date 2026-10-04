import { COLORS } from "@/constants/colors";
import { stageReason, stageStatus, usePlaybackStage } from "@/hooks/usePlaybackStage";
import React from "react";
import { ActivityIndicator, Platform, Pressable, StyleSheet, View } from "react-native";
import Animated, { FadeIn } from "react-native-reanimated";

/**
 * The player's black loading canvas, and on tvOS the screen's focus anchor.
 *
 * The anchor cannot be a sibling of this overlay. react-native-tvos Fabric
 * forces `isUserInteractionEnabled = YES` on plain views, so an opaque absolute
 * overlay occludes UIKit focus for everything beneath it (`pointerEvents` cannot
 * opt out), which is every focusable the player has while it loads: AVKit's
 * transport bar, and the invisible holders this component replaces. With focus
 * stranded outside the pushed screen, Menu finds no responder chain to the
 * navigation controller and the system backgrounds the app instead of popping
 * (see memories/CLAUDE-lessons-learned.md: the audio-player Menu case and the
 * PR #61 overlay case).
 *
 * So the topmost view IS the focusable: by construction nothing can occlude it,
 * and no future overlay can silently break Menu by out-stacking a holder's
 * zIndex. Menu handling stays zero-JS.
 */
export function PlayerLoadingOverlay({ live = false, local = false }: { live?: boolean; local?: boolean }) {
  // Equal flex halves above and below keep the spinner at the exact centre whatever the line holds.
  const body = (
    <>
      <View style={styles.above} />
      <ActivityIndicator size="large" color={COLORS.TEXT_PRIMARY} />
      <View style={styles.below}>
        <PlaybackStageLine live={live} local={local} />
      </View>
    </>
  );
  if (Platform.isTV) {
    return (
      <Pressable isTVSelectable hasTVPreferredFocus onPress={() => {}} style={styles.overlay} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        {body}
      </Pressable>
    );
  }

  return <View style={styles.overlay}>{body}</View>;
}

const ENTER = FadeIn.duration(200);

/** The bare spinner until the attempt runs long, then one status line, then what the current stage waits on. */
function PlaybackStageLine({ live, local }: { live: boolean; local: boolean }) {
  const { stage, phase } = usePlaybackStage();
  if (!stage || phase === "quiet") return null;
  const reason = phase === "reason" ? stageReason(stage, { live, local }) : null;
  return (
    <View pointerEvents="none" style={styles.slot}>
      <Animated.Text entering={ENTER} style={styles.status} numberOfLines={1}>
        {stageStatus(live)}
      </Animated.Text>
      {reason ? (
        <Animated.Text key={reason} entering={ENTER} style={styles.reason} numberOfLines={2}>
          {reason}
        </Animated.Text>
      ) : null}
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
    alignItems: "center",
    backgroundColor: COLORS.MEDIA_BACKGROUND,
    zIndex: 100,
  },
  above: {
    flex: 1,
    paddingBottom: Platform.isTV ? 36 : 20,
  },
  below: {
    flex: 1,
    alignItems: "center",
    paddingTop: Platform.isTV ? 36 : 20,
  },
  slot: {
    alignItems: "center",
    maxWidth: Platform.isTV ? 760 : 320,
  },
  status: {
    fontSize: Platform.isTV ? 26 : 15,
    lineHeight: Platform.isTV ? 32 : 20,
    fontWeight: "600",
    color: COLORS.TEXT_PRIMARY,
  },
  reason: {
    marginTop: Platform.isTV ? 6 : 4,
    fontSize: Platform.isTV ? 21 : 13,
    color: COLORS.TEXT_SECONDARY,
    lineHeight: Platform.isTV ? 28 : 18,
    textAlign: "center",
  },
});
