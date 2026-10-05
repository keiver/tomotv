import { getRecordingStatus, subscribeRecordingStatus } from "@/services/recordingStatus";
import type { JellyfinTimer } from "@/types/jellyfin";
import { useSyncExternalStore } from "react";

const isRecording = () => getRecordingStatus().running.length > 0;
const activeTimers = () => getRecordingStatus().active;

/** Whether the server is recording anything right now, as the shared reading sees it. */
export function useIsRecording(): boolean {
  return useSyncExternalStore(subscribeRecordingStatus, isRecording);
}

/** The live timers, scheduled ones included; a record or cancel anywhere re-reads them. */
export function useActiveTimers(): JellyfinTimer[] {
  return useSyncExternalStore(subscribeRecordingStatus, activeTimers);
}
