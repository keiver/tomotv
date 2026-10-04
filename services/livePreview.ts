import "@/services/liveChannels";
import type { JellyfinVideoItem } from "@/types/jellyfin";
import { takeLivePreview as take } from "@keiver/tomo-live/src/livePreview";

export { showLivePreview, stopLivePreview } from "@keiver/tomo-live/src/livePreview";
export const takeLivePreview = (channelId: string) => take<JellyfinVideoItem>(channelId);
