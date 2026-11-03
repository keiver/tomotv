import { FocusableButton } from "@/components/FocusableButton";
import { COLORS } from "@/constants/colors";
import { usePlayerSession } from "@/contexts/PlayerSessionContext";
import { useLiveFrame } from "@/hooks/useLiveFrame";
import { useRecordingHoldChoices } from "@/hooks/useRecordingHoldChoices";
import { t } from "@/services/i18n";
import type { JellyfinItem } from "@/types/jellyfin";
import { Image } from "expo-image";
import { useRouter } from "expo-router";
import React, { useCallback } from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";

/**
 * What lies under Live TV's player, filling its shape: the channel's last frame while it opens, Retry when it
 * failed, and the recording's hold on a one-connection provider with the way to take the connection back.
 */
export function LivePreviewSlot({ channel }: { channel: JellyfinItem }) {
  const { hostMode, retry, playbackState, sessionVideoId } = usePlayerSession();
  const router = useRouter();
  const openRecording = useCallback((item: JellyfinItem) => router.push({ pathname: "/player", params: { videoId: item.Id, videoName: item.Name } }), [router]);
  const hold = useRecordingHoldChoices(sessionVideoId ?? channel.Id, playbackState, retry, openRecording);
  const liveFrame = useLiveFrame(channel.Id);

  return (
    <View style={styles.fill}>
      {liveFrame ? <Image source={{ uri: liveFrame.uri }} style={StyleSheet.absoluteFill} contentFit="cover" /> : null}
      {hostMode === "error" && hold.held && !hold.stopping && !hold.opening ? (
        <View style={[styles.center, styles.dim]}>
          <Text style={styles.reasonText}>{hold.reason}</Text>
          {hold.holdingTimer ? (
            <View style={styles.choices}>
              <FocusableButton title={t("liveTv.stopRecordingAndPlay")} variant="retry" onPress={hold.stopAndPlay} style={styles.choice} />
              <FocusableButton title={t("liveTv.watchRecording")} variant="secondary" onPress={hold.watch} style={styles.choice} />
            </View>
          ) : null}
        </View>
      ) : hostMode === "error" && !hold.held ? (
        <View style={[styles.center, styles.dim]}>
          <Text style={styles.errorText}>{t("player.unableToPlay")}</Text>
          <FocusableButton title={t("common.retry")} variant="retry" onPress={retry} />
        </View>
      ) : hostMode === "video" || hostMode === "pip-active" ? null : (
        <View style={styles.center}>
          <ActivityIndicator color={COLORS.TEXT_PRIMARY} />
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  fill: {
    flex: 1,
  },
  center: {
    position: "absolute",
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    alignItems: "center",
    justifyContent: "center",
    gap: 12,
  },
  dim: {
    backgroundColor: "rgba(0, 0, 0, 0.65)",
    paddingHorizontal: 16,
  },
  errorText: {
    color: COLORS.TEXT_PRIMARY,
    fontSize: 16,
    fontWeight: "600",
  },
  reasonText: {
    color: COLORS.TEXT_PRIMARY,
    fontSize: 14,
    textAlign: "center",
  },
  choices: {
    flexDirection: "row",
    alignSelf: "stretch",
    gap: 8,
  },
  choice: {
    flex: 1,
  },
});
