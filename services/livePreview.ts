import "@/services/liveChannels";
import type { JellyfinVideoItem } from "@/types/jellyfin";
import { takeLivePreview as take } from "@keiver/tomo-live";

export { showLivePreview, stopLivePreview } from "@keiver/tomo-live";
export const takeLivePreview = (channelId: string) => take<JellyfinVideoItem>(channelId);
