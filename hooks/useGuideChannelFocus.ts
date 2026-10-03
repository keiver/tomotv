import { isGuideChannelFocused, isGuideRowFocused, subscribeGuideChannelFocus, subscribeGuideRowFocus } from "@/services/guideChannelFocus";
import { useCallback, useSyncExternalStore } from "react";

/** True while the channel's column card holds TV focus; an empty id listens to nothing and reads false. */
export function useGuideChannelFocus(channelId: string | undefined): boolean {
  const subscribe = useCallback((listener: () => void) => (channelId ? subscribeGuideChannelFocus(listener) : () => undefined), [channelId]);
  const read = useCallback(() => (channelId ? isGuideChannelFocused(channelId) : false), [channelId]);
  return useSyncExternalStore(subscribe, read);
}

/** True while a programme cell in the channel's guide row holds TV focus. */
export function useGuideRowFocus(channelId: string): boolean {
  const read = useCallback(() => isGuideRowFocused(channelId), [channelId]);
  return useSyncExternalStore(subscribeGuideRowFocus, read);
}
