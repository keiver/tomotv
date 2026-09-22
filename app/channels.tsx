import { AmbientBackground } from "@/components/ambient-background";
import { LibraryGrid } from "@/components/library-grid";
import { TVFocusHolder } from "@/components/tv-focus-holder";
import { COLORS } from "@/constants/colors";
import { useLoadingActions } from "@/contexts/LoadingContext";
import { useChannels } from "@/hooks/useChannels";
import { t } from "@/services/i18n";
import type { FolderStackEntry, JellyfinItem } from "@/types/jellyfin";
import { Ionicons } from "@expo/vector-icons";
import { useIsFocused, useRouter } from "expo-router";
import React, { useCallback, useMemo } from "react";
import { Platform, StyleSheet, Text, View } from "react-native";

const IS_TV = Platform.isTV;

/** The channel wall: every channel as the guide's card, tuning on select. A root route beside Recordings. */
export default function ChannelsScreen() {
  const router = useRouter();
  const isScreenFocused = useIsFocused();
  const { showGlobalLoader } = useLoadingActions();
  const { items, isLoading, isLoadingMore, hasMore, error, loadMore, retry } = useChannels();

  const tune = useCallback(
    (channel: JellyfinItem) => {
      showGlobalLoader();
      router.push({ pathname: "/player", params: { videoId: channel.Id, videoName: channel.Name, live: "1" } });
    },
    [router, showGlobalLoader],
  );
  const crumbs = useMemo<FolderStackEntry[]>(() => [{ id: "channels", name: t("liveTv.channels"), type: "livetv" }], []);

  if (!isLoading && !error && items.length === 0) {
    return (
      <View style={styles.container}>
        <AmbientBackground />
        <View style={styles.center}>
          <Ionicons name="tv-outline" size={64} color={COLORS.TEXT_SECONDARY} />
          <Text style={styles.emptyText}>{t("liveTv.noChannels")}</Text>
        </View>
        <TVFocusHolder preferred={isScreenFocused} />
      </View>
    );
  }
  return (
    <LibraryGrid
      items={items}
      liveChannels
      isLoading={isLoading}
      isLoadingMore={isLoadingMore}
      hasMoreResults={hasMore}
      error={error}
      onItemPress={tune}
      onLoadMore={loadMore}
      onRetry={retry}
      crumbs={crumbs}
      homeAsBack
    />
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  center: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: 40,
    gap: 18,
  },
  emptyText: {
    color: COLORS.TEXT_SECONDARY,
    fontSize: IS_TV ? 24 : 18,
    textAlign: "center",
  },
});
