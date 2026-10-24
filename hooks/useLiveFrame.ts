import { liveClipFor, liveFrameFor, liveFrameReel, subscribeLiveFrame, type LiveFrame } from "@/services/liveFrames";
import { useCallback, useSyncExternalStore } from "react";

/** The channel's latest live frame, following each grab; undefined until one lands. */
export function useLiveFrame(channelId: string): LiveFrame | undefined {
  const subscribe = useCallback((listener: () => void) => subscribeLiveFrame(channelId, listener), [channelId]);
  const read = useCallback(() => liveFrameFor(channelId), [channelId]);
  return useSyncExternalStore(subscribe, read);
}

/** The channel's latest preview clip file, following each full grab; undefined until one lands. */
export function useLiveClip(channelId: string): LiveFrame | undefined {
  const subscribe = useCallback((listener: () => void) => subscribeLiveFrame(channelId, listener), [channelId]);
  const read = useCallback(() => liveClipFor(channelId), [channelId]);
  return useSyncExternalStore(subscribe, read);
}

/** When this device grabbed or last verified the channel's shown picture; 0 while none shows. */
export function useLiveFrameSeenAt(channelId: string): number {
  const subscribe = useCallback((listener: () => void) => subscribeLiveFrame(channelId, listener), [channelId]);
  const read = useCallback(() => {
    const reel = liveFrameReel(channelId);
    return reel && reel.frames.length > 0 ? reel.at : 0;
  }, [channelId]);
  return useSyncExternalStore(subscribe, read);
}
