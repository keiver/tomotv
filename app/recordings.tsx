import { AmbientBackground } from "@/components/ambient-background";
import { FocusableButton } from "@/components/FocusableButton";
import { LibraryGrid } from "@/components/library-grid";
import { TVFocusHolder } from "@/components/tv-focus-holder";
import { COLORS } from "@/constants/colors";
import { useLibraryFilters } from "@/contexts/LibraryFiltersContext";
import { useItemLongPress } from "@/hooks/useItemLongPress";
import { useOpenShelfItem } from "@/hooks/useOpenShelfItem";
import { t } from "@/services/i18n";
import { fetchFilteredVideos, fetchRecordingFolderIds, fetchRecordings } from "@/services/jellyfinApi";
import { countActiveFilters, EMPTY_FILTERS, type FolderStackEntry, type JellyfinItem } from "@/types/jellyfin";
import { logger } from "@/utils/logger";
import { Ionicons } from "@expo/vector-icons";
import { Stack, useIsFocused, useLocalSearchParams, useRouter } from "expo-router";
import type { NativeStackNavigationOptions } from "expo-router";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Platform, StyleSheet, Text, View } from "react-native";

const IS_TV = Platform.isTV;

/** The guide's finished recordings. A root route: TV crossfades it, phone pushes it under a native bar. */
export default function RecordingsScreen() {
  const router = useRouter();
  const isScreenFocused = useIsFocused();
  // "Show in Folder" on a recording lands here with the card to mark.
  const { focusId } = useLocalSearchParams<{ focusId?: string }>();
  const openItem = useOpenShelfItem();
  const onItemLongPress = useItemLongPress();
  const [recordings, setRecordings] = useState<{ items: JellyfinItem[]; isLoading: boolean; error: string | null }>({ items: [], isLoading: true, error: null });
  const [reloadKey, setReloadKey] = useState(0);
  const loadedFilterKey = useRef("");

  // A server can hold several recordings libraries; a filter searches all of them and keys on the first.
  const [folderIds, setFolderIds] = useState<string[]>([]);
  const folderId = folderIds[0] ?? null;
  useEffect(() => {
    let cancelled = false;
    fetchRecordingFolderIds()
      .then((ids) => !cancelled && setFolderIds(ids))
      .catch((err) => logger.warn("Recordings folder lookup failed", err, { screen: "Recordings" }));
    return () => {
      cancelled = true;
    };
  }, []);
  const { getFilters } = useLibraryFilters();
  const filters = folderId ? getFilters(folderId) : EMPTY_FILTERS;
  const activeFilterCount = countActiveFilters(filters);
  const filterKey = activeFilterCount > 0 ? JSON.stringify(filters) : "";

  // Reloads whenever the screen comes back on top: a recording played or deleted from here changes the list.
  useEffect(() => {
    if (!isScreenFocused) return;
    let cancelled = false;
    // A changed selection shows the loading state; a plain return keeps the list up while it refetches.
    if (loadedFilterKey.current !== filterKey) setRecordings((current) => ({ ...current, isLoading: true }));
    loadedFilterKey.current = filterKey;
    const load =
      filterKey && folderId
        ? Promise.all(folderIds.map((id) => fetchFilteredVideos(id, filters))).then((pages) => ({ items: pages.flat().sort((a, b) => a.Name.localeCompare(b.Name)) }))
        : fetchRecordings();
    load
      .then(({ items }) => !cancelled && setRecordings({ items, isLoading: false, error: null }))
      .catch((err) => {
        logger.warn("Recordings load failed", err, { screen: "Recordings" });
        if (!cancelled) setRecordings((current) => ({ ...current, isLoading: false, error: err instanceof Error ? err.message : String(err) }));
      });
    return () => {
      cancelled = true;
    };
    // filterKey stands in for the filters object, so a same-selection rerender does not refetch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isScreenFocused, reloadKey, filterKey, folderIds]);
  const reload = useCallback(() => setReloadKey((n) => n + 1), []);

  // A flat list of episodes from many series: the card names the series, its badge the episode.
  const recordingCards = useMemo(() => recordings.items.map((item) => (item.SeriesName ? { ...item, Name: item.SeriesName } : item)), [recordings.items]);
  const recordingById = useCallback((card: JellyfinItem) => recordings.items.find((item) => item.Id === card.Id) ?? card, [recordings.items]);
  const handlePress = useCallback((card: JellyfinItem) => openItem(recordingById(card)), [openItem, recordingById]);
  const handleLongPress = useCallback((card: JellyfinItem) => onItemLongPress(recordingById(card)), [onItemLongPress, recordingById]);

  const title = t("liveTv.recordings");
  const crumbs = useMemo<FolderStackEntry[] | undefined>(() => (folderId ? [{ id: folderId, name: title, type: "folder" }] : undefined), [folderId, title]);
  const handleOpenFilters = useCallback(() => {
    if (!folderId) return;
    router.push({ pathname: "/filters", params: { folderId, name: title, libraryId: folderId, libraryName: title } });
  }, [router, folderId, title]);

  // Phone: the Filters button rides the native bar, as on a folder level. TV draws its own bar in the grid.
  const screenOptions = useMemo<NativeStackNavigationOptions>(
    () =>
      IS_TV || !folderId
        ? {}
        : {
            unstable_headerRightItems: () => [
              {
                type: "custom",
                element: (
                  <FocusableButton
                    title={activeFilterCount > 0 ? t("filters.titleCount").replace("{count}", String(activeFilterCount)) : t("filters.title")}
                    variant="link"
                    icon={<Ionicons name="funnel-outline" size={18} color={COLORS.ACCENT} />}
                    onPress={handleOpenFilters}
                    accessibilityLabel={t("filters.title")}
                  />
                ),
              },
            ],
          },
    [folderId, activeFilterCount, handleOpenFilters],
  );

  if (!recordings.isLoading && !recordings.error && recordings.items.length === 0 && activeFilterCount === 0) {
    return (
      <View style={styles.container}>
        <Stack.Screen options={screenOptions} />
        <AmbientBackground />
        <View style={styles.center}>
          <Ionicons name="recording-outline" size={64} color={COLORS.TEXT_SECONDARY} />
          <Text style={styles.emptyText}>{t("liveTv.noRecordings")}</Text>
        </View>
        <TVFocusHolder preferred={isScreenFocused} />
      </View>
    );
  }
  return (
    <>
      <Stack.Screen options={screenOptions} />
      <LibraryGrid
        items={recordingCards}
        recordings
        isLoading={recordings.isLoading}
        isLoadingMore={false}
        hasMoreResults={false}
        error={recordings.error}
        onItemPress={handlePress}
        onItemLongPress={handleLongPress}
        onLoadMore={() => {}}
        onRetry={reload}
        focusItemId={focusId}
        crumbs={crumbs}
        homeAsBack
        onOpenFilters={folderId ? handleOpenFilters : undefined}
        activeFilterCount={activeFilterCount}
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
});
