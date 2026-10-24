import { audioPlayerManager, type AudioPlayerUIState } from "@/services/audioPlayerManager";
import type { JellyfinVideoItem } from "@/types/jellyfin";
import { queueTrackProgress } from "@/utils/resumeProgress";
import { useEffect, useState } from "react";

/**
 * The playing item's card position and play state. A track follows the queue at its native 1 Hz,
 * and only the card passed `audio` subscribes; a video keeps the progress its card was given, and
 * has none to show at 0 (a grid with the player in a PiP window passes no position).
 */
export function useNowPlayingProgress(video: JellyfinVideoItem, kind: "audio" | "video" | null, progressPercent = 0, playing = false): { fraction: number | null; playing: boolean } {
  const [state, setState] = useState<AudioPlayerUIState | null>(null);
  useEffect(() => (kind === "audio" ? audioPlayerManager.subscribe(setState) : undefined), [kind]);
  if (kind === "audio") {
    const current = state ?? audioPlayerManager.getUIState();
    return { fraction: queueTrackProgress(video, current.position), playing: current.playing };
  }
  return { fraction: progressPercent > 0 ? progressPercent : null, playing };
}
