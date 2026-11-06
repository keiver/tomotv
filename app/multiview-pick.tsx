import { LibraryGrid } from "@/components/library-grid";
import { useChannelWall } from "@/hooks/useChannelWall";
import { useLiveTvPreferences } from "@/hooks/useLiveTvPreferences";
import { t } from "@/services/i18n";
import { getLiveTvPreferences, updateLiveTvPreferences } from "@/services/liveTvPreferences";
import type { FolderStackEntry, JellyfinItem } from "@/types/jellyfin";
import { placeChannel } from "@/utils/multiviewArrangement";
import { useLocalSearchParams, useRouter } from "expo-router";
import React, { useCallback, useMemo } from "react";
import { StyleSheet, View } from "react-native";

/** The channel wall as a picker for one Multiview spot: the pressed channel fills that spot, and the screen goes back. */
export default function MultiviewPickScreen() {
  const router = useRouter();
  const { spot } = useLocalSearchParams<{ spot?: string }>();
  const index = Number(spot ?? 0);
  const preferences = useLiveTvPreferences();
  const { wall, isLoading, isLoadingMore, hasMore, error, loadMore, retry } = useChannelWall(preferences);
  const crumbs = useMemo<FolderStackEntry[]>(() => [{ id: "multiview-pick", name: t("liveTv.multiviewChange"), type: "livetv" }], []);
  const choose = useCallback(
    (channel: JellyfinItem) => {
      const { multiview } = getLiveTvPreferences();
      updateLiveTvPreferences({ multiview: placeChannel(multiview, Number.isInteger(index) && index >= 0 ? index : 0, channel.Id) });
      router.back();
    },
    [index, router],
  );
  return (
    <View style={styles.container}>
      <LibraryGrid
        items={wall}
        liveChannels
        liveFramesEnabled={preferences.autoUpdate}
        isLoading={isLoading}
        isLoadingMore={isLoadingMore}
        hasMoreResults={hasMore}
        error={error}
        onItemPress={choose}
        onLoadMore={loadMore}
        onRetry={retry}
        crumbs={crumbs}
        homeAsBack
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
});
