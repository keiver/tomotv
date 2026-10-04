import "@/services/liveChannels";
import type { JellyfinVideoItem } from "@/types/jellyfin";
import * as ring from "@keiver/tomo-live/src/liveRing";

export { isHotChannel, releaseLiveRing, yieldLiveRing } from "@keiver/tomo-live/src/liveRing";
export type HotChannel = ring.HotChannel<JellyfinVideoItem>;
export type RingSession = ring.RingSession<JellyfinVideoItem>;

export function ringAround(channels: { Id: string }[], centerId: string, radius: number): string[] {
  return ring.ringAround(
    channels.map((channel) => channel.Id),
    centerId,
    radius,
  );
}

export function recenterLiveRing(channels: { Id: string }[], centerId: string, playing: boolean): void {
  ring.recenterLiveRing(
    channels.map((channel) => channel.Id),
    centerId,
    playing,
  );
}

export const takeRingSession = (channelId: string) => ring.takeRingSession<JellyfinVideoItem>(channelId);
export const retainLiveSession = (channel: HotChannel) => ring.retainLiveSession(channel);
export const takeWarmDetails = (channelId: string) => ring.takeWarmDetails<JellyfinVideoItem>(channelId);
