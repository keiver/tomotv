import { FocusableButton } from "@/components/FocusableButton";
import { Ionicons } from "@expo/vector-icons";
import { Ref, useEffect } from "react";
import { AccessibilityInfo, Dimensions, Platform, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

const IS_TV = Platform.isTV;

interface UpNextOverlayProps {
  nextVideoName: string;
  progress: string;
  onSkip: () => void;
  visible: boolean;
  upNextProgress: number;
  /** tvOS: lets the player re-focus the CTA after the native transport bar dismisses. */
  ctaRef?: Ref<View>;
}

// Purely presentational: the countdown bar mirrors the remaining time, and the actual queue
// advance happens in the player's onEnd — this overlay never advances the queue on its own
// (the player clears `visible` in the same pass that would drain the progress to zero).
export function UpNextOverlay({ nextVideoName, progress, onSkip, visible, upNextProgress, ctaRef }: UpNextOverlayProps) {
  const insets = useSafeAreaInsets();

  // Announce the card to screen readers when it appears
  useEffect(() => {
    if (visible) {
      AccessibilityInfo.announceForAccessibility(`Up next: ${nextVideoName}`);
    }
  }, [visible, nextVideoName]);

  if (!visible) {
    return null;
  }

  // Phone: notch/home-indicator aware. Edges subsume the inset (max, not sum —
  // same rule as gridEdgePadding); the bottom clearance above the AVKit
  // transport bar stacks on the home-indicator inset.
  const containerStyle = IS_TV ? styles.container : [styles.container, { bottom: 80 + insets.bottom, right: Math.max(insets.right, 16), left: Math.max(insets.left, 16) }];

  return (
    <View style={containerStyle} accessibilityLiveRegion="polite">
      <View style={styles.card}>
        <View style={styles.header}>
          <Ionicons name="play-skip-forward" size={Platform.isTV ? 28 : 20} color="#FFC312" />
          <Text style={styles.headerText}>Up Next</Text>
        </View>

        <View style={styles.progressBarTrack}>
          <View style={[styles.progressBarFill, { width: `${Math.max(0, Math.min(1, upNextProgress)) * 100}%` }]} />
        </View>

        <Text style={styles.videoName} numberOfLines={2}>
          {nextVideoName}
        </Text>

        {progress ? <Text style={styles.progress}>{progress}</Text> : null}

        <FocusableButton
          ref={ctaRef}
          title="Play Now"
          variant="primary"
          hasTVPreferredFocus={true}
          onPress={onSkip}
          icon={<Ionicons name="play" size={Platform.isTV ? 24 : 14} color="#000000" />}
          style={styles.playNowButton}
          textStyle={IS_TV ? undefined : styles.playNowText}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: "absolute",
    // TV: fixed screen, the 30%-height offset clears the transport bar. Phone:
    // anchor above the AVKit controls bottom-right; the %-of-height value read
    // at module load is wrong there (and never updates on rotation).
    bottom: IS_TV ? Dimensions.get("window").height * 0.3 : 96,
    right: IS_TV ? 76 : 16,
    left: IS_TV ? undefined : 16,
    alignItems: IS_TV ? undefined : "flex-end",
    zIndex: 200,
  },
  card: {
    backgroundColor: "rgba(28, 28, 30, 0.65)",
    borderRadius: IS_TV ? 23 : 16,
    padding: IS_TV ? 28 : 16,
    minWidth: IS_TV ? 400 : 240,
    maxWidth: IS_TV ? 500 : 320,
    borderWidth: 1,
    borderColor: "rgba(255, 195, 18, 0.3)",
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: Platform.isTV ? 12 : 8,
    marginBottom: Platform.isTV ? 16 : 12,
  },
  headerText: {
    fontSize: Platform.isTV ? 22 : 16,
    fontWeight: "700",
    color: "#FFC312",
    flex: 1,
  },
  progressBarTrack: {
    height: 4,
    backgroundColor: "rgba(142, 142, 147, 0.3)",
    borderRadius: 2,
    marginBottom: Platform.isTV ? 16 : 12,
    overflow: "hidden" as const,
  },
  progressBarFill: {
    height: "100%",
    backgroundColor: "#FFC312",
    borderRadius: 2,
  },
  videoName: {
    fontSize: Platform.isTV ? 24 : 17,
    fontWeight: "600",
    color: "#FFFFFF",
    marginBottom: Platform.isTV ? 8 : 4,
    lineHeight: Platform.isTV ? 32 : 22,
  },
  progress: {
    fontSize: Platform.isTV ? 18 : 13,
    fontWeight: "500",
    color: "#98989D",
  },
  playNowButton: {
    marginTop: Platform.isTV ? 20 : 12,
    minWidth: 0,
    alignSelf: "stretch",
    // Compact the shared button on phone; TV keeps the component defaults.
    ...(IS_TV
      ? {}
      : {
          paddingVertical: 8,
          paddingHorizontal: 20,
          minHeight: 38,
        }),
  },
  playNowText: {
    fontSize: 15,
  },
});
