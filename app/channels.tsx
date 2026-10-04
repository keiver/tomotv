import { AmbientBackground } from "@/components/ambient-background";
import { LibraryGrid } from "@/components/library-grid";
import { ShowAllChannels } from "@/components/live-tv/show-all-channels";
import { SfSymbolIcon } from "@/components/sf-symbol-icon";
import { HeaderSearchReveal } from "@/components/header-search-reveal";
import { settingsStyles } from "@/components/settings/styles";
import { SunkenTextInput } from "@/components/sunken-text-input";
import { COLORS } from "@/constants/colors";
import { useLoadingActions } from "@/contexts/LoadingContext";
import { useItemLongPress } from "@/hooks/useItemLongPress";
import { useChannelFavoritesSync } from "@/hooks/useChannelFavoritesSync";
import { useChannels } from "@/hooks/useChannels";
import { useLiveTvPreferences } from "@/hooks/useLiveTvPreferences";
import { useOpenShelfItem } from "@/hooks/useOpenShelfItem";
import { usePlaylistChannelIds } from "@/hooks/useTunerGroups";
import { useHealthGeneration } from "@/hooks/useChannelHealth";
import { healthFor } from "@/services/channelHealth";
import { t } from "@/services/i18n";
import { fetchTimers, searchLiveTv } from "@/services/jellyfinApi";
import { reportRecordingTimers } from "@/services/recordingStatus";
import { activeCategory, activeChannelList, isFavoriteChannel } from "@/services/liveTvPreferences";
import type { FolderStackEntry, JellyfinItem, JellyfinTimer, JellyfinVideoItem } from "@/types/jellyfin";
import { activeRecordTimer } from "@/utils/guide";
import { logger } from "@/utils/logger";
import { Ionicons } from "@expo/vector-icons";
import { Stack, useIsFocused, useRouter, type NativeStackNavigationOptions } from "expo-router";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Platform, StyleSheet, Text, View } from "react-native";
import { useHeaderHeight } from "expo-router/react-navigation";

const IS_TV = Platform.isTV;
const SEARCH_DEBOUNCE_MS = 300;
/** A term shorter than this searches nothing, the search tab's own floor. */
const MIN_QUERY = 2;

/** The channel wall: every channel as the guide's card, tuning on select, a held card a favorite. A root route beside Recordings.
 *  Its head is the Live TV HUD: a search over channels and programmes, the group pills, and the guide's status. */
export default function ChannelsScreen() {
  const router = useRouter();
  const headerHeight = useHeaderHeight();
  const { showGlobalLoader } = useLoadingActions();
  const preferences = useLiveTvPreferences();
  useChannelFavoritesSync();
  const playlistIds = usePlaylistChannelIds(preferences.filter);
  const { items: listed, isLoading, isLoadingMore, hasMore, error, loadMore, retry } = useChannels(preferences.sort, activeCategory(preferences.filter), activeChannelList(preferences), playlistIds);
  const filtered = preferences.filter !== "all";
  // Hide offline narrows to channels whose health check concluded down; unchecked ones stay.
  const healthGen = useHealthGeneration(preferences.hideOffline);
  const wall = useMemo(
    () => (preferences.hideOffline ? listed.filter((channel) => healthFor(channel.Id) !== "down") : listed),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- healthGen re-filters when any verdict moves
    [listed, preferences.hideOffline, healthGen],
  );

  // The targeted search: channels and programmes only, debounced like the search tab. Results
  // are remembered with the term they answer, so what shows is derived and never reset in-effect.
  const [query, setQuery] = useState("");
  const [found, setFound] = useState<{ term: string; items: JellyfinVideoItem[] } | null>(null);
  const term = query.trim();
  const searching = term.length >= MIN_QUERY;
  useEffect(() => {
    if (term.length < MIN_QUERY) return;
    let stale = false;
    const timer = setTimeout(async () => {
      try {
        const items = await searchLiveTv(term);
        if (!stale) setFound({ term, items });
      } catch (error) {
        logger.warn("Live TV search failed", error, { screen: "Channels" });
        if (!stale) setFound({ term, items: [] });
      }
    }, SEARCH_DEBOUNCE_MS);
    return () => {
      stale = true;
      clearTimeout(timer);
    };
  }, [term]);
  const results = searching && found?.term === term ? found.items : [];
  const isSearching = searching && found?.term !== term;
  // A group pick answers over any search: the term drops so the picked list shows at once.
  const lastFilterRef = useRef(preferences.filter);
  useEffect(() => {
    if (lastFilterRef.current === preferences.filter) return;
    lastFilterRef.current = preferences.filter;
    setQuery("");
    setFound(null);
  }, [preferences.filter]);

  const tune = useCallback(
    (channel: JellyfinItem) => {
      showGlobalLoader();
      router.push({ pathname: "/player", params: { videoId: channel.Id, videoName: channel.Name, live: "1" } });
    },
    [router, showGlobalLoader],
  );
  // A search result follows the guide's rule: a channel or airing programme tunes, a later one opens its panel.
  const openResult = useOpenShelfItem();
  const openSettings = useCallback(() => router.push("/channel-settings"), [router]);
  // A held channel or search result opens the info panel.
  const openInfoPanel = useItemLongPress();
  // Reread on every return: the info panel and the player start and stop recordings.
  const isFocused = useIsFocused();
  const [timers, setTimers] = useState<JellyfinTimer[]>([]);
  useEffect(() => {
    if (!isFocused) return;
    let stale = false;
    fetchTimers()
      .then((next) => {
        reportRecordingTimers(next);
        if (!stale) setTimers(next);
      })
      .catch((err) => logger.warn("Timers refresh failed", err, { screen: "Channels" }));
    return () => {
      stale = true;
    };
  }, [isFocused]);
  const recordingFor = useCallback((item: JellyfinItem) => item.Type === "TvChannel" && !!activeRecordTimer(timers, { channelId: item.Id }, Date.now()), [timers]);
  const favoriteMark = useCallback((item: JellyfinItem) => (item.Type === "TvChannel" && isFavoriteChannel(preferences, item) ? ("heart" as const) : undefined), [preferences]);
  const crumbs = useMemo<FolderStackEntry[]>(() => [{ id: "channels", name: t("liveTv.channels"), type: "livetv" }], []);
  const openFilterPicker = useCallback(() => router.push("/channel-groups"), [router]);
  // Icon-only: the cog carries it.
  const headerAction = useMemo(() => ({ icon: "settings-outline" as const, accessibilityLabel: t("settings.title"), onPress: openSettings }), [openSettings]);
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

  // Phone: the search tab's field, in the body on the shared content column. TV: the bar's
  // search capsule reveals the field.
  const head = IS_TV ? null : (
    <View style={[styles.head, { paddingTop: headerHeight + 8 }]}>
      <View style={settingsStyles.contentContainer}>
        <SunkenTextInput
          value={query}
          onChangeText={setQuery}
          placeholder={t("liveTv.searchLive")}
          placeholderTextColor={COLORS.TEXT_SECONDARY}
          accessibilityLabel={t("liveTv.searchLive")}
          autoCorrect={false}
          autoCapitalize="none"
          returnKeyType="search"
          numberOfLines={1}
          multiline={false}
          clearButtonMode="while-editing"
          containerStyle={styles.searchField}
          style={styles.searchInput}
        />
      </View>
    </View>
  );

  // An empty wall keeps the bar: back, search, groups and settings stay in reach.
  const favoritesEmpty = preferences.filter === "favorites";
  const emptyWall =
    !searching && !hasMore ? (
      <View style={styles.center}>
        <Ionicons name={favoritesEmpty ? "heart-outline" : "tv-outline"} size={64} color={COLORS.TEXT_SECONDARY} />
        <Text style={styles.emptyText}>{favoritesEmpty ? t("liveTv.noFavorites") : t("liveTv.noChannels")}</Text>
        {favoritesEmpty ? <Text style={styles.hintText}>{t("liveTv.favoritesHint")}</Text> : null}
        {filtered ? <ShowAllChannels /> : null}
      </View>
    ) : undefined;
  return (
    <View style={styles.container}>
      <Stack.Screen options={screenOptions} />
      {/* Phone paints the canvas at screen level so the field and the grid share one wash. */}
      {IS_TV ? null : <AmbientBackground />}
      {head}
      <View style={styles.grid}>
        <LibraryGrid
          items={searching ? (results as JellyfinItem[]) : wall}
          liveChannels
          liveFramesEnabled={!searching && preferences.autoUpdate}
          titleIconFor={favoriteMark}
          recordingFor={recordingFor}
          headerAction={headerAction}
          headerSecondaryAction={filterAction}
          headerTrailing={IS_TV ? <HeaderSearchReveal key={preferences.filter} value={query} onChangeText={setQuery} placeholder={t("liveTv.searchLive")} /> : undefined}
          isLoading={searching ? isSearching : isLoading}
          isLoadingMore={!searching && isLoadingMore}
          hasMoreResults={!searching && hasMore}
          error={searching ? null : error}
          onItemPress={searching ? openResult : tune}
          onItemLongPress={openInfoPanel}
          onLoadMore={loadMore}
          onRetry={retry}
          crumbs={crumbs}
          homeAsBack
          noAmbient={!IS_TV}
          emptyContent={emptyWall}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  grid: {
    flex: 1,
  },
  // Phone: the field's row under the native bar, on the search tab's shared column.
  head: {
    alignItems: "center",
    paddingBottom: 8,
  },
  searchField: {
    width: "100%",
  },
  searchInput: {
    width: "100%",
    flex: 1,
    backgroundColor: "transparent",
    paddingHorizontal: 20,
    fontSize: 20,
    color: COLORS.TEXT_PRIMARY,
  },
  center: {
    alignItems: "center",
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
