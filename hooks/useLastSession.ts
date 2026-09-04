import { getLastSessionVersion, readLastSession, subscribeLastSession, type PlaybackSession } from "@/services/playbackProbe";
import { useSyncExternalStore } from "react";

type Snapshot = { version: number; session: PlaybackSession | null };
let snapshot: Snapshot | null = null;

/** One read per version: the store hands back the same object until the engine writes or the viewer clears. */
function getSnapshot(): Snapshot {
  const version = getLastSessionVersion();
  if (!snapshot || snapshot.version !== version) snapshot = { version, session: readLastSession() };
  return snapshot;
}

/** This device's last playback, live as the engine records it and gone once it is cleared. */
export function useLastSession(): PlaybackSession | null {
  return useSyncExternalStore(subscribeLastSession, getSnapshot, getSnapshot).session;
}
