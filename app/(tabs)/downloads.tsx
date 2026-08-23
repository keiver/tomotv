import { AmbientBackground } from "@/components/ambient-background";
import { BrandCorners } from "@/components/brand-corners";
import { ListRow } from "@/components/settings/ListRow";
import { StorageBar } from "@/components/storage-bar";
import { settingsStyles as styles } from "@/components/settings/styles";
import { COLORS } from "@/constants/colors";
import { downloadManager, type DownloadsUIState } from "@/services/downloads/manager";
import { downloadsSupported } from "@/services/downloads/paths";
import type { DownloadEntry } from "@/services/downloads/manifest";
import { isAudioItem } from "@/services/jellyfinApi";
import { formatFileSize } from "@/utils/mediaInfo";
import { Ionicons } from "@expo/vector-icons";
import { Paths } from "expo-file-system";
import { useRouter } from "expo-router";
import React, { useCallback, useEffect, useState } from "react";
import { Alert, Platform, ScrollView, StyleSheet, Text, View } from "react-native";

type IoniconName = keyof typeof Ionicons.glyphMap;

/** What each state's row says and does, so the list has no branching in its body. */
function rowFor(entry: DownloadEntry): { icon: IoniconName; subtitle: string; trailing?: IoniconName } {
  switch (entry.state) {
    case "ready":
      return { icon: "checkmark-circle", subtitle: formatFileSize(entry.totalBytes), trailing: "play" };
    case "downloading": {
      const percent = entry.totalBytes > 0 ? Math.floor((entry.bytesWritten / entry.totalBytes) * 100) : null;
      return { icon: "arrow-down-circle", subtitle: percent === null ? `${formatFileSize(entry.bytesWritten)} so far` : `${percent}% · ${formatFileSize(entry.totalBytes)}`, trailing: "pause" };
    }
    case "queued":
      return { icon: "time-outline", subtitle: "Waiting", trailing: "close" };
    case "paused":
      return { icon: "pause-circle", subtitle: entry.bytesWritten > 0 ? `Paused at ${formatFileSize(entry.bytesWritten)}` : "Paused", trailing: "arrow-down" };
    case "failed":
      return { icon: "alert-circle", subtitle: entry.error ?? "Download failed", trailing: "refresh" };
  }
}

/**
 * What is on the device, and the only screen in the app that needs no server at all.
 *
 * Apple gives tvOS apps no persistent local storage, so the tab is hidden there
 * (app/(tabs)/_layout.tsx) and this screen says so if it is ever reached.
 */
export default function DownloadsScreen() {
  const router = useRouter();
  const [state, setState] = useState<DownloadsUIState>(() => downloadManager.getState());

  useEffect(() => downloadManager.subscribe(setState), []);
  useEffect(() => {
    void downloadManager.hydrate();
  }, []);

  const press = useCallback(
    (entry: DownloadEntry) => {
      switch (entry.state) {
        case "ready":
          // No queue build and no item refetch: both need the server, which is the one
          // thing this screen cannot assume. The stored payload is the whole launch.
          router.push({
            pathname: isAudioItem(entry.item) ? "/audio-player" : "/player",
            params: { videoId: entry.itemId, videoName: entry.item.Name },
          });
          return;
        case "downloading":
          void downloadManager.pause(entry.itemId);
          return;
        default:
          downloadManager.resume(entry.itemId);
      }
    },
    [router],
  );

  const confirmRemove = useCallback((entry: DownloadEntry) => {
    Alert.alert(entry.item.Name, "Remove this download from the device?", [
      { text: "Cancel", style: "cancel" },
      { text: "Remove", style: "destructive", onPress: () => void downloadManager.remove(entry.itemId) },
    ]);
  }, []);

  if (!downloadsSupported()) {
    return (
      <View style={styles.screenContainer}>
        <AmbientBackground />
        <View style={screenStyles.empty}>
          <Text style={screenStyles.emptyText}>Downloads need an iPhone or iPad. Apple TV keeps no files of its own.</Text>
        </View>
      </View>
    );
  }

  const stored = state.entries.reduce((total, entry) => total + (entry.state === "ready" ? entry.totalBytes : entry.bytesWritten), 0);

  return (
    <View style={styles.screenContainer}>
      {/* Decoration first: siblings paint in order, and the tvOS focus rule that puts it
          behind the rows holds on phone too. Same order as the Settings screen. */}
      <AmbientBackground />
      <BrandCorners />

      <ScrollView style={styles.scrollView} contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false} contentInsetAdjustmentBehavior="automatic" focusable={false}>
        <View style={styles.contentContainer}>
          {!Platform.isTV && <Text style={styles.screenTitle}>Downloads</Text>}

          {state.hydrated && state.entries.length > 0 && (
            <View style={screenStyles.storage}>
              <StorageBar used={stored} free={Paths.availableDiskSpace} />
            </View>
          )}

          {!state.hydrated ? null : state.entries.length === 0 ? (
            <View style={screenStyles.empty}>
              <Ionicons name="arrow-down-circle-outline" size={56} color={COLORS.TEXT_QUATERNARY} />
              <Text style={screenStyles.emptyText}>Nothing downloaded yet. Open an item and choose Download to keep it on this device.</Text>
            </View>
          ) : (
            <>
              <View style={styles.sectionHeader}>
                <Text style={styles.sectionHeaderText}>ON THIS DEVICE</Text>
              </View>

              <View style={styles.section}>
                {state.entries.map((entry, index) => {
                  const { icon, subtitle, trailing } = rowFor(entry);
                  return (
                    <ListRow
                      key={entry.itemId}
                      icon={icon}
                      title={entry.item.Name}
                      subtitle={subtitle}
                      trailingIcon={trailing}
                      tone={entry.state === "failed" ? "destructive" : "default"}
                      onPress={() => press(entry)}
                      onLongPress={() => confirmRemove(entry)}
                      isFirst={index === 0}
                      isLast={index === state.entries.length - 1}
                      accessibilityLabel={entry.item.Name}
                      accessibilityHint={entry.state === "ready" ? "Plays from this device. Press and hold to remove." : `${subtitle}. Press and hold to remove.`}
                    />
                  );
                })}
              </View>
            </>
          )}
        </View>
      </ScrollView>
    </View>
  );
}

const screenStyles = StyleSheet.create({
  empty: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 16,
    paddingHorizontal: 32,
    paddingTop: 120,
  },
  // Above the list, and clear of it: the bar is a stat, not a row.
  storage: {
    marginTop: 4,
    marginBottom: 20,
  },
  emptyText: {
    color: COLORS.TEXT_SECONDARY,
    fontSize: 15,
    lineHeight: 21,
    textAlign: "center",
  },
});
