import { isPlaybackHeld, onPlaybackHoldReleased, onPlaybackHoldTaken } from "@/services/playbackHold";
import { useSyncExternalStore } from "react";

function subscribe(listener: () => void): () => void {
  const offTaken = onPlaybackHoldTaken(listener);
  const offReleased = onPlaybackHoldReleased(listener);
  return () => {
    offTaken();
    offReleased();
  };
}

/** True while playback owns the link. */
export function usePlaybackHeld(): boolean {
  return useSyncExternalStore(subscribe, isPlaybackHeld);
}
