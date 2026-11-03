import { useHeldRecording } from "@/hooks/useRecordingStatus";
import type { VideoPlayerState } from "@/hooks/useVideoPlayback";
import { t } from "@/services/i18n";
import { channelDisplayName, getLiveTvPreferences } from "@/services/liveTvPreferences";
import { admitUntilPlaying, recordingWhenReady, stopRecordingAndPlay } from "@/services/recordingHold";
import { recordingWindow } from "@/services/recordingStatus";
import { showToast } from "@/services/toast";
import type { JellyfinItem } from "@/types/jellyfin";
import { cleanLabel } from "@/utils/cleanLabel";
import { PLAYBACK_ERROR_IDS } from "@/utils/errorIds";
import { formatClock } from "@/utils/guide";
import { logger } from "@/utils/logger";
import { useCallback, useEffect, useRef, useState } from "react";
import { Alert } from "react-native";

/** The channel failed because a recording holds its provider's only connection. */
export function isRecordingHold(state: VideoPlayerState): boolean {
  return state.type === "ERROR" && state.ref?.id === PLAYBACK_ERROR_IDS.LIVE_RECORDING;
}

/**
 * The way back to a channel a recording holds the provider for: why it cannot play, Stop Recording and Play
 * (which frees the connection and plays it), and Watch Recording. Shared by the player and Live TV's slot.
 */
export function useRecordingHoldChoices(channelId: string, state: VideoPlayerState, retry: () => void, openRecording: (item: JellyfinItem) => void) {
  const held = isRecordingHold(state);
  const holdingTimer = useHeldRecording(channelId, held);
  const [stopping, setStopping] = useState(false);
  const [opening, setOpening] = useState(false);
  const leftRef = useRef(false);
  useEffect(
    () => () => {
      leftRef.current = true;
      admitUntilPlaying(null);
    },
    [],
  );

  const stopAndPlay = useCallback(() => {
    if (!holdingTimer) return;
    Alert.alert(holdingTimer.Name, undefined, [
      { text: t("common.cancel"), style: "cancel" },
      {
        text: t("liveTv.stopRecording"),
        style: "destructive",
        onPress: () => {
          setStopping(true);
          stopRecordingAndPlay(holdingTimer, channelId)
            .then(() => retry())
            .catch((err) => {
              logger.warn("Stop recording failed", err, { service: "RecordingHoldChoices" });
              showToast(t("liveTv.recordingFailed"), "error");
            })
            .finally(() => setStopping(false));
        },
      },
    ]);
  }, [holdingTimer, channelId, retry]);

  const watch = useCallback(() => {
    if (!holdingTimer) return;
    setOpening(true);
    recordingWhenReady(channelId)
      .then((item) => {
        if (item && !leftRef.current) openRecording(item);
      })
      .catch((err) => logger.warn("Recording read failed", err, { service: "RecordingHoldChoices" }))
      .finally(() => setOpening(false));
  }, [holdingTimer, channelId, openRecording]);

  const reason = !held
    ? null
    : holdingTimer
      ? t("player.error.recordingHold")
          .replace("{channel}", cleanLabel(channelDisplayName(getLiveTvPreferences(), { Id: holdingTimer.ChannelId, Name: holdingTimer.ChannelName ?? holdingTimer.Name })))
          .replace("{time}", formatClock(recordingWindow(holdingTimer).endMs))
      : state.type === "ERROR"
        ? state.error
        : null;

  return { held, holdingTimer, reason, stopping, opening, stopAndPlay, watch };
}
