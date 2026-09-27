import { healthFor, subscribeChannelHealth, type ChannelHealth } from "@/services/channelHealth";
import { useCallback, useSyncExternalStore } from "react";

/** The channel's health verdict, following each check; "unknown" until one concludes. */
export function useChannelHealth(channelId: string): ChannelHealth {
  const subscribe = useCallback((listener: () => void) => subscribeChannelHealth(channelId, listener), [channelId]);
  const read = useCallback(() => healthFor(channelId), [channelId]);
  return useSyncExternalStore(subscribe, read);
}
