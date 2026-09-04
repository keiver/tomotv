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
const subscribeToNothing = () => () => undefined;
const notPlaying = () => false;

/**
 * Whether this card's item is the track playing. The snapshot is one boolean off the manager's
 * fields, so a 1 Hz tick allocates nothing and re-renders nothing.
 */
export function useIsNowPlaying(itemId: string | null): boolean {
  const isThisCard = useCallback(() => audioPlayerManager.nowPlayingItemId() === itemId, [itemId]);
  return useSyncExternalStore(itemId === null ? subscribeToNothing : subscribe, itemId === null ? notPlaying : isThisCard);
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
