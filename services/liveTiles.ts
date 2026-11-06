import "@/services/liveChannels";
import type { HotChannel } from "@/services/liveRing";
import type { JellyfinVideoItem } from "@/types/jellyfin";
import { retainLiveTile as retain, takeLiveTile as take } from "@keiver/tomo-live";

export { liveTileFailed, liveTilesVersion, liveTileUnavailable, liveTileUrl, noteLiveTileFailed, setLiveTiles, subscribeLiveTiles } from "@keiver/tomo-live";
export const takeLiveTile = (channelId: string) => take<JellyfinVideoItem>(channelId);
export const retainLiveTile = (channel: HotChannel) => retain(channel);
