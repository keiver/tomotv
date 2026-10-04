import { getRecordingStatus, subscribeRecordingStatus } from "@/services/recordingStatus";
import { useSyncExternalStore } from "react";

const isRecording = () => getRecordingStatus().running.length > 0;

/** Whether the server is recording anything right now, as the shared reading sees it. */
export function useIsRecording(): boolean {
  return useSyncExternalStore(subscribeRecordingStatus, isRecording);
}
