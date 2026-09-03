import { usePlayerSession } from "@/contexts/PlayerSessionContext";
import { audioPlayerManager, type AudioPlayerUIState } from "@/services/audioPlayerManager";
import { JellyfinVideoItem } from "@/types/jellyfin";
import { useRouter } from "expo-router";
import { useCallback, useSyncExternalStore } from "react";

/** The track whose card is the player: a queue playing behind a dismissed native UI. */
export function nowPlayingItemId(state: Pick<AudioPlayerUIState, "active" | "uiVisible" | "track">): string | null {
  return state.active && !state.uiVisible && state.track ? state.track.Id : null;
}

const subscribe = (onChange: () => void) => audioPlayerManager.subscribe(onChange);

/**
 * Whether this card's item is the track playing. Every card subscribes, but the snapshot is
 * one boolean, so the 1 Hz position ticks re-render nothing and a track change re-renders two.
 */
export function useIsNowPlaying(itemId: string | null): boolean {
  return useSyncExternalStore(subscribe, () => itemId !== null && nowPlayingItemId(audioPlayerManager.getUIState()) === itemId);
}

export interface NowPlayingVideo {
  /** This card's item owns the live video session, on screen or in a PiP window. */
  active: boolean;
  playing: boolean;
}

/** Whether this card's item is the video the host is holding; an errored session is not held. */
export function useNowPlayingVideo(itemId: string | null): NowPlayingVideo {
  const { sessionVideoId, hostMode, playbackState } = usePlayerSession();
  const active = itemId !== null && sessionVideoId === itemId && hostMode !== "idle" && hostMode !== "error";
  return { active, playing: active && playbackState.type === "PLAYING" };
}

/**
 * Select on the playing item's card brings its native player back instead of restarting it:
 * the audio queue re-presents its controller, the video route is re-pushed with the same
 * adopt flag the host uses when PiP asks to restore.
 */
export function useOpenNowPlaying() {
  const router = useRouter();
  return useCallback(
    (video: JellyfinVideoItem, kind: "audio" | "video") => {
      if (kind === "audio") {
        void audioPlayerManager.present();
        return;
      }
      router.push({ pathname: "/player", params: { videoId: video.Id, videoName: video.Name ?? "", adopt: "1" } });
    },
    [router],
  );
}
