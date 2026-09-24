import { liveFrameFor, subscribeLiveFrame, type LiveFrame } from "@/services/liveFrames";
import { useCallback, useSyncExternalStore } from "react";

/** The channel's latest live frame, following each grab; undefined until one lands. */
export function useLiveFrame(channelId: string): LiveFrame | undefined {
  const subscribe = useCallback((listener: () => void) => subscribeLiveFrame(channelId, listener), [channelId]);
  const read = useCallback(() => liveFrameFor(channelId), [channelId]);
  return useSyncExternalStore(subscribe, read);
}
