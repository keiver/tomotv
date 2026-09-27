import { isGuideChannelFocused, subscribeGuideChannelFocus } from "@/services/guideChannelFocus";
import { useCallback, useSyncExternalStore } from "react";

/** True while the channel's column card holds TV focus; false for an empty id. */
export function useGuideChannelFocus(channelId: string | undefined): boolean {
  const subscribe = useCallback((listener: () => void) => subscribeGuideChannelFocus(listener), []);
  const read = useCallback(() => (channelId ? isGuideChannelFocused(channelId) : false), [channelId]);
  return useSyncExternalStore(subscribe, read);
}
