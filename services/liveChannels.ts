/** Tomo's channels as @keiver/tomo-live reads them: Jellyfin resolution and opens, and the engine session mapping. */
import { closeLiveStream, openChannel, resolveChannel, resolveChannelOrigin, resolveChannelWithoutOpen } from "@/services/jellyfinApi";
import { getLiveTvPreferences, subscribeLiveTvPreferences } from "@/services/liveTvPreferences";
import { canRemuxLocally, startLocalRemux } from "@/services/localRemux";
import type { JellyfinVideoItem } from "@/types/jellyfin";
import { configureLive } from "@keiver/tomo-live";

configureLive<JellyfinVideoItem>({
  channels: {
    resolve: (channelId, options) => resolveChannel(channelId, undefined, options),
    resolveWithoutOpen: (channelId) => resolveChannelWithoutOpen(channelId),
    resolveOrigin: (channelId) => resolveChannelOrigin(channelId),
    open: (channelId, options) => openChannel(channelId, undefined, options),
    close: (item) => closeLiveStream(item.LiveStreamId),
    holdsOpen: (item) => !!item.LiveStreamId,
    streamUrl: (item) => item.liveStreamUrl,
    name: (item) => item.Name,
    canPlayOnDevice: (item) => canRemuxLocally(item, { record: false }),
    startSession: (item, options) => startLocalRemux(item, undefined, undefined, options),
    // Only a filter change replaces the rows; favorites and guide edits write the same store.
    subscribeListChange: (listener) => {
      let filter = getLiveTvPreferences().filter;
      return subscribeLiveTvPreferences(() => {
        const next = getLiveTvPreferences().filter;
        if (next === filter) return;
        filter = next;
        listener();
      });
    },
  },
});
