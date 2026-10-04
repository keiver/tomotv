import { healthFor, healthGeneration, subscribeChannelHealth, subscribeHealthGeneration, type ChannelHealth } from "@/services/channelHealth";
import { useCallback, useSyncExternalStore } from "react";

const NO_SUBSCRIPTION = () => () => {};
const NO_GENERATION = () => 0;

/** The channel's health verdict, following each check; "unknown" until one concludes. */
export function useChannelHealth(channelId: string): ChannelHealth {
  const subscribe = useCallback((listener: () => void) => subscribeChannelHealth(channelId, listener), [channelId]);
  const read = useCallback(() => healthFor(channelId), [channelId]);
  return useSyncExternalStore(subscribe, read);
}

/** Bumps on any channel's verdict change while `enabled`; a constant 0 otherwise, so no verdict re-renders the caller. */
export function useHealthGeneration(enabled: boolean): number {
  return useSyncExternalStore(enabled ? subscribeHealthGeneration : NO_SUBSCRIPTION, enabled ? healthGeneration : NO_GENERATION);
}
