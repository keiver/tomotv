import { liveClipFor, liveFrameFor, subscribeLiveFrame, type LiveFrame } from "@/services/liveFrames";
import { livePreviewFor, subscribeLivePreview } from "@/services/livePreview";
import { useCallback, useSyncExternalStore } from "react";

/** The channel's latest live frame, following each grab; undefined until one lands. */
export function useLiveFrame(channelId: string): LiveFrame | undefined {
  const subscribe = useCallback((listener: () => void) => subscribeLiveFrame(channelId, listener), [channelId]);
  const read = useCallback(() => liveFrameFor(channelId), [channelId]);
  return useSyncExternalStore(subscribe, read);
}

/** The channel's live preview session once it has cut a segment; undefined while the card is not the one previewing. */
export function useLivePreview(channelId: string): LiveFrame | undefined {
  const subscribe = useCallback((listener: () => void) => subscribeLivePreview(channelId, listener), [channelId]);
  const read = useCallback(() => livePreviewFor(channelId), [channelId]);
  return useSyncExternalStore(subscribe, read);
}

/** The channel's latest preview clip file, following each full grab; undefined until one lands. */
export function useLiveClip(channelId: string): LiveFrame | undefined {
  const subscribe = useCallback((listener: () => void) => subscribeLiveFrame(channelId, listener), [channelId]);
  const read = useCallback(() => liveClipFor(channelId), [channelId]);
  return useSyncExternalStore(subscribe, read);
}
