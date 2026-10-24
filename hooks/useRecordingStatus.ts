import { getHeldPredicate, getRecordingCheckVersion, heldRecording, recordingChecking, subscribeHolds, subscribeRecordingChecks } from "@/services/recordingHold";
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

const noSubscription = () => () => {};

/** The timer holding the channel's provider while `active`, re-read as timers change; null otherwise. */
export function useHeldRecording(channelId: string, active: boolean): JellyfinTimer | null {
  const status = useSyncExternalStore(active ? subscribeRecordingStatus : noSubscription, getRecordingStatus);
  const checkVersion = useSyncExternalStore(active ? subscribeRecordingChecks : noSubscription, getRecordingCheckVersion);
  return active ? heldRecording(channelId, status, checkVersion) : null;
}

/** Whether the recording holding the channel's provider is still being checked for the stream, while `active`. */
export function useRecordingChecking(channelId: string, active: boolean): boolean {
  return useSyncExternalStore(active ? subscribeRecordingChecks : noSubscription, () => active && recordingChecking(channelId));
}

/** Whether a recording holds a channel's provider; a new function whenever a hold changes. */
export function useChannelHeld(): (channelId: string) => boolean {
  return useSyncExternalStore(subscribeHolds, getHeldPredicate);
}
