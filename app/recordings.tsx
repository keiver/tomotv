import { AmbientBackground } from "@/components/ambient-background";
import { LibraryGrid } from "@/components/library-grid";
import { TVFocusHolder } from "@/components/tv-focus-holder";
import { COLORS } from "@/constants/colors";
import { useItemLongPress } from "@/hooks/useItemLongPress";
import { useOpenShelfItem } from "@/hooks/useOpenShelfItem";
import { t } from "@/services/i18n";
import { fetchRecordings } from "@/services/jellyfinApi";
import type { JellyfinItem } from "@/types/jellyfin";
import { logger } from "@/utils/logger";
import { Ionicons } from "@expo/vector-icons";
import { useIsFocused } from "expo-router";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Platform, StyleSheet, Text, View } from "react-native";

const IS_TV = Platform.isTV;

/** The guide's finished recordings. A root route: TV crossfades it, phone pushes it under a native bar. */
export default function RecordingsScreen() {
  const isScreenFocused = useIsFocused();
  const openItem = useOpenShelfItem();
  const onItemLongPress = useItemLongPress();
  const [recordings, setRecordings] = useState<{ items: JellyfinItem[]; isLoading: boolean; error: string | null }>({ items: [], isLoading: true, error: null });
  const [reloadKey, setReloadKey] = useState(0);

  // Reloads whenever the screen comes back on top: a recording played or deleted from here changes the list.
  useEffect(() => {
    if (!isScreenFocused) return;
    let cancelled = false;
    fetchRecordings()
      .then(({ items }) => !cancelled && setRecordings({ items, isLoading: false, error: null }))
      .catch((err) => {
        logger.warn("Recordings load failed", err, { screen: "Recordings" });
        if (!cancelled) setRecordings((current) => ({ ...current, isLoading: false, error: err instanceof Error ? err.message : String(err) }));
      });
    return () => {
      cancelled = true;
    };
  }, [isScreenFocused, reloadKey]);
  const reload = useCallback(() => setReloadKey((n) => n + 1), []);

  // A flat list of episodes from many series: the card names the series, its badge the episode.
  const recordingCards = useMemo(() => recordings.items.map((item) => (item.SeriesName ? { ...item, Name: item.SeriesName } : item)), [recordings.items]);
  const recordingById = useCallback((card: JellyfinItem) => recordings.items.find((item) => item.Id === card.Id) ?? card, [recordings.items]);
  const handlePress = useCallback((card: JellyfinItem) => openItem(recordingById(card)), [openItem, recordingById]);
  const handleLongPress = useCallback((card: JellyfinItem) => onItemLongPress(recordingById(card)), [onItemLongPress, recordingById]);

  if (!recordings.isLoading && !recordings.error && recordings.items.length === 0) {
    return (
      <View style={styles.container}>
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
    <LibraryGrid
      items={recordingCards}
      isLoading={recordings.isLoading}
      isLoadingMore={false}
      hasMoreResults={false}
      error={recordings.error}
      onItemPress={handlePress}
      onItemLongPress={handleLongPress}
      onLoadMore={() => {}}
      onRetry={reload}
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
