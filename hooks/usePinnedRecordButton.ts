import type { PinnedRecordButton } from "@/components/live-tv/pinned-corner-buttons";
import { useLiveTvManagement } from "@/hooks/useLiveTvManagement";
import { useRecordActions } from "@/hooks/useRecordActions";
import { tapFeedback } from "@/services/haptics";
import { t } from "@/services/i18n";
import { runningTimers } from "@/services/recordingStatus";
import type { JellyfinItem, JellyfinProgram } from "@/types/jellyfin";
import { cleanLabel } from "@/utils/cleanLabel";
import { EXTERNAL_GUIDE_PREFIX } from "@/utils/guide";
import { useCallback, useMemo } from "react";

interface PinnedRecordOptions {
  /** Null: no channel plays, and there is no button. */
  channel: JellyfinItem | null;
  program?: JellyfinProgram | null;
  nowMs: number;
  /** The picture plays the channel's recording, not the channel. */
  playsRecording: boolean;
  /** The record button is about to start a recording on the channel. */
  onRecordStart: () => void;
  /** The record write answered, whether it landed. */
  onRecordSettled: (landed: boolean) => void;
}

/**
 * The record button over a playing channel's picture, and the mark that says what the picture is while a recording runs:
 * the pinned band's and Multiview's spot with the sound. Null for an account that may not record this channel.
 */
export function usePinnedRecordButton({ channel, program, nowMs, playsRecording, onRecordStart, onRecordSettled }: PinnedRecordOptions) {
  const name = cleanLabel(channel?.Name);
  const startMs = Date.parse(program?.StartDate ?? "");
  const endMs = Date.parse(program?.EndDate ?? "");
  const timed = Number.isFinite(startMs) && Number.isFinite(endMs) && endMs > startMs;

  // The info panel's rule: an external programme records by its times, and a channel the server has not ingested not at all.
  const canManage = useLiveTvManagement();
  const externalProgram = !!program?.Id?.startsWith(EXTERNAL_GUIDE_PREFIX);
  const recording = useRecordActions(
    channel && canManage && !channel.playlistPending && (!externalProgram || timed)
      ? { programId: program && !externalProgram ? program.Id : undefined, channelId: channel.Id, channelName: name, program: program ?? null }
      : null,
  );
  const { timer: recordTimer, busy: recordBusy, record, cancel: cancelRecording, cancelWaiting } = recording;
  const waiting = recordBusy === "waiting";
  const pressRecord = useCallback(() => {
    if (waiting) {
      void tapFeedback();
      cancelWaiting();
      return;
    }
    if (recordBusy !== null) return;
    void tapFeedback();
    if (recordTimer) {
      void cancelRecording();
      return;
    }
    onRecordStart();
    void Promise.resolve(record()).then((landed) => onRecordSettled(landed === true));
  }, [waiting, cancelWaiting, recordBusy, recordTimer, cancelRecording, record, onRecordStart, onRecordSettled]);
  // Recording now by the shared status's rule: InProgress, or its span covers the clock before the server says so.
  const recordingNow = !!recordTimer && runningTimers([recordTimer], nowMs).length > 0;
  const recordButton = useMemo<PinnedRecordButton | null>(() => {
    if (recordTimer === undefined) return null;
    if (waiting) return { icon: "close-circle-outline", label: t("liveTv.waitingForConnection"), text: t("liveTv.waitingForConnection"), onPress: pressRecord };
    return {
      icon: recordTimer ? (recordingNow ? "stop" : "close-circle-outline") : "radio-button-on",
      label: t(recordTimer ? (recordingNow ? "liveTv.stopRecording" : "liveTv.cancelRecording") : "liveTv.record"),
      text: recordingNow ? t("liveTv.stopRecording") : undefined,
      onPress: pressRecord,
    };
  }, [recordTimer, recordingNow, waiting, pressRecord]);
  const mark = playsRecording ? t("liveTv.playingRecording") : recordingNow ? t("liveTv.recordingNow") : null;
  return { recordButton, mark };
}
