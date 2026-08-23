import { AmbientBackground } from "@/components/ambient-background";
import { BrandCorners } from "@/components/brand-corners";
import { InfoSection } from "@/components/settings/InfoSection";
import { ListRow } from "@/components/settings/ListRow";
import { StorageBar } from "@/components/storage-bar";
import { DOWNLOAD_SUBTITLE_LINE_HEIGHT, DOWNLOAD_TITLE_LINE_HEIGHT, settingsStyles as styles } from "@/components/settings/styles";
import { COLORS } from "@/constants/colors";
import { downloadManager, type DownloadsUIState } from "@/services/downloads/manager";
import { downloadsSupported } from "@/services/downloads/paths";
import { groupDownloads, totalDownloadedBytes, type DownloadGroup } from "@/services/downloads/grouping";
import type { DownloadEntry } from "@/services/downloads/manifest";
import { isAudioItem } from "@/services/jellyfinApi";
import { formatFileSize } from "@/utils/mediaInfo";
import { Ionicons } from "@expo/vector-icons";
import { Paths } from "expo-file-system";
import { useRouter } from "expo-router";
import React, { useCallback, useEffect, useRef, useState } from "react";
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

/** What a folder row says about itself: how many, how far along, how big. */
function groupSubtitle(group: DownloadGroup): string {
  const count = `${group.entries.length} items`;
  if (group.state === "ready") return `${count} · ${formatFileSize(group.bytes)}`;
  if (group.state === "failed") return `${count} · some failed`;
  const done = group.entries.filter((entry) => entry.state === "ready").length;
  return group.totalBytes ? `${done} of ${group.entries.length} · ${formatFileSize(group.totalBytes)}` : `${done} of ${group.entries.length}`;
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
  // One folder open at a time: the list is a flat section, and several open at once buries
  // whatever the user scrolled here for.
  const [expanded, setExpanded] = useState<string | null>(null);

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

  // tvOS moves focus out of a ScrollView only while its offset is at the matching end
  // (RCTScrollViewComponentView.shouldUpdateFocusInContext), so the capped list pins itself
  // when focus lands on its first or last row. Same pattern as the quality list in settings.
  const listRef = useRef<ScrollView>(null);
  const pinListToTop = useCallback(() => listRef.current?.scrollTo({ y: 0, animated: false }), []);
  const pinListToBottom = useCallback(() => listRef.current?.scrollToEnd({ animated: false }), []);

  const confirmRemove = useCallback((entry: DownloadEntry) => {
    Alert.alert(entry.item.Name, "Remove this download from the device?", [
      { text: "Cancel", style: "cancel" },
      { text: "Remove", style: "destructive", onPress: () => void downloadManager.remove(entry.itemId) },
    ]);
  }, []);

  // The whole folder in one confirmation, with the size it frees: removing twenty tracks one
  // long press at a time is not a thing anyone should have to do.
  const confirmRemoveGroup = useCallback((group: DownloadGroup) => {
    Alert.alert(group.name, `Remove all ${group.entries.length} items from this device? That frees ${formatFileSize(group.bytes)}.`, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Remove",
        style: "destructive",
        onPress: () =>
          void (async () => {
            for (const entry of group.entries) await downloadManager.remove(entry.itemId);
          })(),
      },
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

  const stored = totalDownloadedBytes(state.entries);
  const rows = groupDownloads(state.entries);

  return (
    <View style={styles.screenContainer}>
      {/* Decoration first: siblings paint in order, and the tvOS focus rule that puts it
          behind the rows holds on phone too. Same order as the Settings screen. */}
      <AmbientBackground />
      <BrandCorners />

      <ScrollView style={styles.scrollView} contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false} contentInsetAdjustmentBehavior="automatic" focusable={false}>
        <View style={styles.contentContainer}>
          {!Platform.isTV && <Text style={styles.screenTitle}>Downloads</Text>}

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

              {/* Capped at whole rows (7 on phone, 4 on TV) and scrolling inside the card, so a
                  device full of downloads, or an expanded folder, cannot run off the bottom of
                  the screen. The wrapper keeps the radius, the clipping and the inset shadow. */}
              <View style={styles.section}>
                <ScrollView ref={listRef} style={styles.downloadsScrollable} showsVerticalScrollIndicator={false} nestedScrollEnabled focusable={false}>
                  {rows.map((row, index) => {
                    const first = index === 0;
                    const last = index === rows.length - 1;

                    if (row.kind === "item") {
                      const { icon, subtitle, trailing } = rowFor(row.entry);
                      return (
                        <ListRow
                          key={row.entry.itemId}
                          icon={icon}
                          title={row.entry.item.Name}
                          subtitle={subtitle}
                          trailingIcon={trailing}
                          tone={row.entry.state === "failed" ? "destructive" : "default"}
                          onPress={() => press(row.entry)}
                          onLongPress={() => confirmRemove(row.entry)}
                          onFocus={first ? pinListToTop : last ? pinListToBottom : undefined}
                          titleStyle={screenStyles.rowTitle}
                          subtitleStyle={screenStyles.rowSubtitle}
                          isFirst={first}
                          isLast={last}
                          accessibilityLabel={row.entry.item.Name}
                          accessibilityHint={row.entry.state === "ready" ? "Plays from this device. Press and hold to remove." : `${subtitle}. Press and hold to remove.`}
                        />
                      );
                    }

                    const { group } = row;
                    const open = expanded === group.id;
                    return (
                      <React.Fragment key={group.id}>
                        <ListRow
                          icon="folder"
                          title={group.name}
                          subtitle={groupSubtitle(group)}
                          trailingIcon={open ? "chevron-up" : "chevron-down"}
                          tone={group.state === "failed" ? "destructive" : "default"}
                          onPress={() => setExpanded(open ? null : group.id)}
                          onLongPress={() => confirmRemoveGroup(group)}
                          onFocus={first ? pinListToTop : last && !open ? pinListToBottom : undefined}
                          titleStyle={screenStyles.rowTitle}
                          subtitleStyle={screenStyles.rowSubtitle}
                          isFirst={first}
                          isLast={last && !open}
                          accessibilityLabel={group.name}
                          accessibilityState={{ expanded: open }}
                          accessibilityHint={`${groupSubtitle(group)}. Press and hold to remove the whole folder.`}
                        />
                        {open &&
                          group.entries.map((entry, memberIndex) => {
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
                                onFocus={last && memberIndex === group.entries.length - 1 ? pinListToBottom : undefined}
                                isLast={last && memberIndex === group.entries.length - 1}
                                titleStyle={[screenStyles.rowTitle, screenStyles.memberTitle]}
                                subtitleStyle={screenStyles.rowSubtitle}
                                accessibilityLabel={entry.item.Name}
                                accessibilityHint={entry.state === "ready" ? "Plays from this device. Press and hold to remove." : `${subtitle}. Press and hold to remove.`}
                              />
                            );
                          })}
                      </React.Fragment>
                    );
                  })}
                </ScrollView>
              </View>

              <InfoSection>
                <StorageBar used={stored} free={Paths.availableDiskSpace} />
              </InfoSection>
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
  // Pinned leading on both lines: the section's height cap is DOWNLOAD_ROW_HEIGHT times a row
  // count, and that arithmetic only holds if every row measures what it assumes.
  rowTitle: {
    lineHeight: DOWNLOAD_TITLE_LINE_HEIGHT,
  },
  // marginTop 0 overrides ListRow's subtitle air, which the row height does not budget for.
  rowSubtitle: {
    fontSize: Platform.isTV ? 22 : 14,
    lineHeight: DOWNLOAD_SUBTITLE_LINE_HEIGHT,
    marginTop: 0,
  },
  // Indented so an open folder's contents read as belonging to the row above them.
  memberTitle: {
    paddingLeft: 16,
  },
  emptyText: {
    color: COLORS.TEXT_SECONDARY,
    fontSize: 15,
    lineHeight: 21,
    textAlign: "center",
  },
});
