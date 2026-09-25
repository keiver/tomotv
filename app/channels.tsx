import { AmbientBackground } from "@/components/ambient-background";
import { GlassButton } from "@/components/glass-button";
import { LibraryGrid } from "@/components/library-grid";
import { ShowAllChannels } from "@/components/live-tv/show-all-channels";
import { SfSymbolIcon } from "@/components/sf-symbol-icon";
import { COLORS } from "@/constants/colors";
import { useLoadingActions } from "@/contexts/LoadingContext";
import { useChannelFavoriteMenu } from "@/hooks/useChannelFavoriteMenu";
import { useChannelFilterPicker } from "@/hooks/useChannelFilterPicker";
import { useChannels } from "@/hooks/useChannels";
import { useLiveTvPreferences } from "@/hooks/useLiveTvPreferences";
import { usePlaylistChannelIds } from "@/hooks/useTunerGroups";
import { t } from "@/services/i18n";
import { activeCategory, activeChannelList, isFavoriteChannel } from "@/services/liveTvPreferences";
import type { FolderStackEntry, JellyfinItem } from "@/types/jellyfin";
import { Ionicons } from "@expo/vector-icons";
import { Stack, useRouter, type NativeStackNavigationOptions } from "expo-router";
import React, { useCallback, useMemo } from "react";
import { Platform, StyleSheet, Text, View } from "react-native";

const IS_TV = Platform.isTV;

/** The channel wall: every channel as the guide's card, tuning on select, a held card a favorite. A root route beside Recordings. */
export default function ChannelsScreen() {
  const router = useRouter();
  const { showGlobalLoader } = useLoadingActions();
  const preferences = useLiveTvPreferences();
  const playlistIds = usePlaylistChannelIds(preferences.filter);
  const { items: shown, isLoading, isLoadingMore, hasMore, error, loadMore, retry } = useChannels(preferences.sort, activeCategory(preferences.filter), activeChannelList(preferences), playlistIds);
  const filtered = preferences.filter !== "all";

  const tune = useCallback(
    (channel: JellyfinItem) => {
      showGlobalLoader();
      router.push({ pathname: "/player", params: { videoId: channel.Id, videoName: channel.Name, live: "1" } });
    },
    [router, showGlobalLoader],
  );
  const openSettings = useCallback(() => router.push("/channel-settings"), [router]);
  const openFavoriteMenu = useChannelFavoriteMenu();
  const favoriteMark = useCallback((channel: JellyfinItem) => (isFavoriteChannel(preferences, channel) ? ("heart" as const) : undefined), [preferences]);
  const crumbs = useMemo<FolderStackEntry[]>(() => [{ id: "channels", name: t("liveTv.channels"), type: "livetv" }], []);
  const openFilterPicker = useChannelFilterPicker();
  const headerAction = useMemo(() => ({ title: t("settings.title"), icon: "settings-outline" as const, onPress: openSettings }), [openSettings]);
  // Left of Settings, the platform's filter button: the symbol fills while a filter holds the list.
  const filterAction = useMemo(
    () => ({
      accessibilityLabel: t("liveTv.groups"),
      icon: <SfSymbolIcon name={filtered ? "line.3.horizontal.decrease.circle.fill" : "line.3.horizontal.decrease.circle"} size={26} color={COLORS.ACCENT} />,
      onPress: openFilterPicker,
    }),
    [filtered, openFilterPicker],
  );

  // Phone: Settings and the filter ride the native bar, as Filters does on a folder level. TV draws them in the grid's bar.
  const screenOptions = useMemo<NativeStackNavigationOptions>(
    () =>
      IS_TV
        ? {}
        : {
            unstable_headerRightItems: () => [
              {
                type: "button",
                label: filterAction.accessibilityLabel,
                icon: { type: "sfSymbol", name: filtered ? "line.3.horizontal.decrease.circle.fill" : "line.3.horizontal.decrease.circle" },
                tintColor: COLORS.ACCENT,
                onPress: filterAction.onPress,
              },
              { type: "button", label: t("settings.title"), icon: { type: "sfSymbol", name: "gearshape" }, tintColor: COLORS.ACCENT, onPress: openSettings },
            ],
          },
    [openSettings, filterAction, filtered],
  );

  if (!isLoading && !error && shown.length === 0 && !hasMore) {
    const favoritesEmpty = preferences.filter === "favorites";
    return (
      <View style={styles.container}>
        <Stack.Screen options={screenOptions} />
        <AmbientBackground />
        <View style={styles.center}>
          <Ionicons name={favoritesEmpty ? "heart-outline" : "tv-outline"} size={64} color={COLORS.TEXT_SECONDARY} />
          <Text style={styles.emptyText}>{favoritesEmpty ? t("liveTv.noFavorites") : t("liveTv.noChannels")}</Text>
          {favoritesEmpty ? <Text style={styles.hintText}>{t("liveTv.favoritesHint")}</Text> : null}
          {filtered ? <ShowAllChannels hasTVPreferredFocus /> : null}
          {IS_TV ? (
            <GlassButton title={t("settings.title")} icon={<Ionicons name="settings-outline" size={26} color={COLORS.ACCENT} />} onPress={openSettings} hasTVPreferredFocus={!filtered} />
          ) : null}
        </View>
      </View>
    );
  }
  return (
    <>
      <Stack.Screen options={screenOptions} />
      <LibraryGrid
        items={shown}
        liveChannels
        liveFramesEnabled={preferences.autoUpdate}
        titleIconFor={favoriteMark}
        headerAction={headerAction}
        headerSecondaryAction={filterAction}
        isLoading={isLoading}
        isLoadingMore={isLoadingMore}
        hasMoreResults={hasMore}
        error={error}
        onItemPress={tune}
        onItemLongPress={openFavoriteMenu}
        onLoadMore={loadMore}
        onRetry={retry}
        crumbs={crumbs}
        homeAsBack
      />
    </>
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
  hintText: {
    color: COLORS.TEXT_TERTIARY,
    fontSize: IS_TV ? 20 : 15,
    textAlign: "center",
  },
});
