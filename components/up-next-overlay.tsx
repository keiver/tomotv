import { FocusableButton } from "@/components/FocusableButton";
import { Ionicons } from "@expo/vector-icons";
import { useEffect } from "react";
import { AccessibilityInfo, Dimensions, Platform, StyleSheet, Text, View } from "react-native";

interface UpNextOverlayProps {
  nextVideoName: string;
  progress: string;
  onSkip: () => void;
  visible: boolean;
  upNextProgress: number;
}

// Purely presentational: the countdown bar mirrors the remaining time, and the actual queue
// advance happens in the player's onEnd — this overlay never advances the queue on its own
// (the player clears `visible` in the same pass that would drain the progress to zero).
export function UpNextOverlay({ nextVideoName, progress, onSkip, visible, upNextProgress }: UpNextOverlayProps) {
  // Announce the card to screen readers when it appears
  useEffect(() => {
    if (visible) {
      AccessibilityInfo.announceForAccessibility(`Up next: ${nextVideoName}`);
    }
  }, [visible, nextVideoName]);

  if (!visible) {
    return null;
  }

  return (
    <View style={styles.container} pointerEvents={visible ? "auto" : "none"} accessibilityLiveRegion="polite">
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
          title="Play Now"
          variant="primary"
          hasTVPreferredFocus={true}
          onPress={onSkip}
          icon={<Ionicons name="play" size={Platform.isTV ? 24 : 16} color="#000000" />}
          style={styles.playNowButton}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: "absolute",
    bottom: Dimensions.get("window").height * 0.3,
    right: 76,
    zIndex: 200,
  },
  card: {
    backgroundColor: "rgba(28, 28, 30, 0.65)",
    borderRadius: 23,
    padding: Platform.isTV ? 28 : 20,
    minWidth: Platform.isTV ? 400 : 280,
    maxWidth: Platform.isTV ? 500 : 340,
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
    marginTop: Platform.isTV ? 20 : 14,
    minWidth: 0,
    alignSelf: "stretch",
  },
});
