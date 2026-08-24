import { AmbientBackground } from "@/components/ambient-background";
import { BrandCorners } from "@/components/brand-corners";
import { SectionFooter } from "@/components/settings/SectionFooter";
import { ListRow } from "@/components/settings/ListRow";
import { PosterMark } from "@/components/settings/PosterMark";
import { SwipeToRemove } from "@/components/settings/SwipeToRemove";
import { StorageBar } from "@/components/storage-bar";
import { DOWNLOAD_ROW_HEIGHT, DOWNLOAD_SUBTITLE_LINE_HEIGHT, DOWNLOAD_TITLE_LINE_HEIGHT, DOWNLOADS_LIST_HEIGHT, settingsStyles as styles } from "@/components/settings/styles";
import { GRID } from "@/constants/app";
import { COLORS } from "@/constants/colors";
import { downloadManager, type DownloadsUIState } from "@/services/downloads/manager";
import { downloadsSupported } from "@/services/downloads/paths";
import { groupDownloads, locateDownload, rowsAbove, totalDownloadedBytes, type DownloadGroup } from "@/services/downloads/grouping";
import type { DownloadEntry } from "@/services/downloads/manifest";
import { useDownloadPlayback } from "@/hooks/useDownloadPlayback";
import { formatFileSize } from "@/utils/mediaInfo";
import { Ionicons } from "@expo/vector-icons";
import { Paths } from "expo-file-system";
import { useLocalSearchParams, useNavigation } from "expo-router";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { Alert, Platform, ScrollView, StyleSheet, Text, View } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import Animated, { FadeIn, FadeOutLeft, LayoutAnimationConfig, LinearTransition } from "react-native-reanimated";

type IoniconName = keyof typeof Ionicons.glyphMap;

// A removed row leaves the way it was dragged and the stack closes over it, which is the one
// list animation UIKit does for free and the only reason a delete reads as a delete.
const ROW_IN = FadeIn.duration(180);
const ROW_OUT = FadeOutLeft.duration(180);
const ROW_SHIFT = LinearTransition.duration(220);
// The panel's own height changes with its rows, and Yoga hands it the new height in one frame:
// without this the card, the list's clip and the footer all snap while the leaving rows fade
// over them, which is the jump collapsing a folder used to make.
const PANEL_SHIFT = LinearTransition.duration(220);

/**
 * What each state's row says and does, so the list has no branching in its body. The artwork
 * leads the row, so the state is the subtitle's to state and the trailing mark's to act on.
 */
function rowFor(entry: DownloadEntry): { subtitle: string; trailing?: IoniconName } {
  switch (entry.state) {
    case "ready":
      return { subtitle: formatFileSize(entry.totalBytes), trailing: "play" };
    case "downloading": {
      const percent = entry.totalBytes > 0 ? Math.floor((entry.bytesWritten / entry.totalBytes) * 100) : null;
      return { subtitle: percent === null ? `${formatFileSize(entry.bytesWritten)} so far` : `${percent}% · ${formatFileSize(entry.totalBytes)}`, trailing: "pause" };
    }
    case "queued":
      return { subtitle: "Waiting", trailing: "close" };
    case "paused":
      return { subtitle: entry.bytesWritten > 0 ? `Paused at ${formatFileSize(entry.bytesWritten)}` : "Paused", trailing: "arrow-down" };
    case "failed":
      return { subtitle: entry.error ?? "Download failed", trailing: "refresh" };
  }
}

/** A folder wears the first artwork it holds: its own cover, in practice, for an album or a season. */
function groupArtwork(group: DownloadGroup): string | null {
  return group.entries.find((entry) => entry.artworkUri)?.artworkUri ?? null;
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
  const [state, setState] = useState<DownloadsUIState>(() => downloadManager.getState());
  // One folder open at a time: the list is a flat section, and several open at once buries
  // whatever the user scrolled here for.
  const [expanded, setExpanded] = useState<string | null>(null);
  // The row the download circle sent us here to see. Nothing else on this screen says which of
  // twenty transfers was the one just started.
  const [selected, setSelected] = useState<string | null>(null);
  const pendingScroll = useRef<number | null>(null);
  // The mark answers "which one got me here"; the first press is that answer being read.
  const clearMark = useCallback(() => {
    pendingScroll.current = null;
    setSelected(null);
  }, []);
  const playback = useDownloadPlayback();

  useEffect(() => downloadManager.subscribe(setState), []);
  useEffect(() => {
    void downloadManager.hydrate();
  }, []);

  // tvOS moves focus out of a ScrollView only while its offset is at the matching end
  // (RCTScrollViewComponentView.shouldUpdateFocusInContext), so the capped list pins itself
  // when focus lands on its first or last row. Same pattern as the quality list in settings.
  const listRef = useRef<ScrollView>(null);
  const pinListToTop = useCallback(() => listRef.current?.scrollTo({ y: 0, animated: false }), []);
  const pinListToBottom = useCallback(() => listRef.current?.scrollToEnd({ animated: false }), []);

  // Where the marked row will sit, so it comes into the capped list rather than staying below
  // its fold. Two triggers, and only one of them fires per case: a row already in the list needs
  // no growth, while a folder's members exist only once the expansion has re-laid the list out.
  const revealSelected = useCallback(() => {
    const y = pendingScroll.current;
    if (y !== null) listRef.current?.scrollTo({ y, animated: true });
  }, []);
  const revealOnGrowth = useCallback(() => {
    revealSelected();
    pendingScroll.current = null;
  }, [revealSelected]);

  // A folder queues its items after the push, so the id is looked for again on every manifest
  // change until it lands. Consuming it clears the param: the same item sent twice must mark
  // its row twice, and an unchanged param would not re-fire this.
  const { highlight } = useLocalSearchParams<{ highlight?: string }>();
  // Typed on the spot: useNavigation reads its params off ReactNavigation.RootParamList, which
  // declares none for a tab route, so the untyped call rejects every payload.
  const navigation = useNavigation<{ setParams: (params: { highlight?: string }) => void }>();
  useEffect(() => {
    if (!highlight) return;
    const rows = groupDownloads(state.entries);
    const found = locateDownload(rows, highlight);
    if (!found) return;
    const folder = found.groupId ? rows.find((row) => row.kind === "group" && row.group.id === found.groupId) : undefined;
    const top = rowsAbove(rows, found, folder?.kind === "group" && playback.canShuffle(folder.group.entries)) * DOWNLOAD_ROW_HEIGHT;
    // Centred in the list, so the row reads as one of a set rather than as the top of it. Rows
    // in the first half give a negative offset, which is the list already showing them at rest.
    pendingScroll.current = Math.max(0, top - (DOWNLOADS_LIST_HEIGHT - DOWNLOAD_ROW_HEIGHT) / 2);
    // One shot: this run clears the param it reads, so it cannot cascade.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setExpanded(found.groupId);
    setSelected(found.rowId);
    revealSelected();
    navigation.setParams({ highlight: undefined });
  }, [highlight, state.entries, navigation, playback, revealSelected]);

  const press = useCallback(
    (entry: DownloadEntry, scope: DownloadEntry[], sourceId: string, sourceName: string) => {
      clearMark();
      switch (entry.state) {
        case "ready":
          // Queued with the rest of its row. The queue is built from the manifest's own
          // items, never fetched: this is the one screen that has to work with no server.
          playback.play(entry, scope, sourceId, sourceName);
          return;
        case "downloading":
          void downloadManager.pause(entry.itemId);
          return;
        default:
          downloadManager.resume(entry.itemId);
      }
    },
    [clearMark, playback],
  );

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
  // What a row outside any folder queues against: the other loose downloads, not the whole
  // device. A track opened next to an album should not walk into that album.
  const loose = state.entries.filter((entry) => !entry.group);

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
              <View style={[styles.sectionHeader, !Platform.isTV && screenStyles.deviceHeader]}>
                <Text style={styles.sectionHeaderText}>ON THIS DEVICE</Text>
              </View>

              {/* Capped at whole rows (8 on phone, 4 on TV) and scrolling inside the card, so a
                  device full of downloads, or an expanded folder, cannot run off the bottom of
                  the screen. The wrapper keeps the radius, the clipping and the inset shadow. */}
              <Animated.View style={styles.section} layout={PANEL_SHIFT}>
                {/* The rows swipe, and a GestureDetector throws in dev without a root above it.
                    Styled, because the default is flex: 1 and this sits in a content-sized card. */}
                <GestureHandlerRootView style={screenStyles.gestureRoot}>
                  <Animated.ScrollView
                    ref={listRef}
                    style={styles.downloadsScrollable}
                    layout={PANEL_SHIFT}
                    onContentSizeChange={revealOnGrowth}
                    showsVerticalScrollIndicator={false}
                    nestedScrollEnabled
                    focusable={false}>
                    {/* Entering is for rows that arrive later, never for the list opening: a
                        screen whose every row fades in reads as a screen still loading. */}
                    <LayoutAnimationConfig skipEntering>
                      {rows.map((row, index) => {
                        const first = index === 0;
                        const last = index === rows.length - 1;

                        if (row.kind === "item") {
                          const { subtitle, trailing } = rowFor(row.entry);
                          return (
                            <Animated.View key={row.entry.itemId} entering={ROW_IN} exiting={ROW_OUT} layout={ROW_SHIFT}>
                              <SwipeToRemove label={row.entry.item.Name} onRemove={() => confirmRemove(row.entry)}>
                                <ListRow
                                  icon={() => <PosterMark uri={row.entry.artworkUri} />}
                                  title={row.entry.item.Name}
                                  subtitle={subtitle}
                                  trailingIcon={trailing}
                                  tone={row.entry.state === "failed" ? "destructive" : "default"}
                                  selected={selected === row.entry.itemId}
                                  onPress={() => press(row.entry, loose, "downloads", "Downloads")}
                                  onLongPress={() => confirmRemove(row.entry)}
                                  onFocus={first ? pinListToTop : last ? pinListToBottom : undefined}
                                  titleStyle={screenStyles.rowTitle}
                                  subtitleStyle={screenStyles.rowSubtitle}
                                  isFirst={first}
                                  accessibilityLabel={row.entry.item.Name}
                                  accessibilityState={{ selected: selected === row.entry.itemId }}
                                  accessibilityHint={
                                    row.entry.state === "ready" ? "Plays from this device. Swipe left or press and hold to remove." : `${subtitle}. Swipe left or press and hold to remove.`
                                  }
                                />
                              </SwipeToRemove>
                            </Animated.View>
                          );
                        }

                        const { group } = row;
                        const open = expanded === group.id;
                        return (
                          <React.Fragment key={group.id}>
                            <Animated.View entering={ROW_IN} exiting={ROW_OUT} layout={ROW_SHIFT}>
                              <SwipeToRemove label={group.name} onRemove={() => confirmRemoveGroup(group)}>
                                <ListRow
                                  icon={() => <PosterMark uri={groupArtwork(group)} />}
                                  title={group.name}
                                  subtitle={groupSubtitle(group)}
                                  trailingIcon={open ? "chevron-up" : "chevron-down"}
                                  tone={group.state === "failed" ? "destructive" : "default"}
                                  selected={selected === group.id}
                                  onPress={() => {
                                    clearMark();
                                    setExpanded(open ? null : group.id);
                                  }}
                                  onLongPress={() => confirmRemoveGroup(group)}
                                  onFocus={first ? pinListToTop : last && !open ? pinListToBottom : undefined}
                                  titleStyle={screenStyles.rowTitle}
                                  subtitleStyle={screenStyles.rowSubtitle}
                                  isFirst={first}
                                  accessibilityLabel={group.name}
                                  accessibilityState={{ expanded: open, selected: selected === group.id }}
                                  accessibilityHint={`${groupSubtitle(group)}. Swipe left or press and hold to remove the whole folder.`}
                                />
                              </SwipeToRemove>
                            </Animated.View>
                            {/* First inside the folder, so shuffling a set needs no gesture of its
                            own and cannot be confused with playing it in order. */}
                            {open && playback.canShuffle(group.entries) && (
                              <Animated.View entering={ROW_IN} exiting={ROW_OUT} layout={ROW_SHIFT}>
                                <ListRow
                                  icon="shuffle"
                                  title="Shuffle"
                                  subtitle={`${group.entries.filter((entry) => entry.state === "ready").length} ready · plays on repeat`}
                                  onPress={() => {
                                    clearMark();
                                    playback.shuffle(group.entries, group.id, group.name);
                                  }}
                                  titleStyle={screenStyles.rowTitle}
                                  subtitleStyle={screenStyles.rowSubtitle}
                                  accessibilityLabel={`Shuffle ${group.name}`}
                                />
                              </Animated.View>
                            )}
                            {open &&
                              group.entries.map((entry, memberIndex) => {
                                const { subtitle, trailing } = rowFor(entry);
                                return (
                                  <Animated.View key={entry.itemId} entering={ROW_IN} exiting={ROW_OUT} layout={ROW_SHIFT}>
                                    <SwipeToRemove label={entry.item.Name} onRemove={() => confirmRemove(entry)}>
                                      <ListRow
                                        icon={() => <PosterMark uri={entry.artworkUri} />}
                                        title={entry.item.Name}
                                        subtitle={subtitle}
                                        trailingIcon={trailing}
                                        tone={entry.state === "failed" ? "destructive" : "default"}
                                        selected={selected === entry.itemId}
                                        onPress={() => press(entry, group.entries, group.id, group.name)}
                                        onLongPress={() => confirmRemove(entry)}
                                        onFocus={last && memberIndex === group.entries.length - 1 ? pinListToBottom : undefined}
                                        titleStyle={screenStyles.rowTitle}
                                        subtitleStyle={screenStyles.rowSubtitle}
                                        accessibilityLabel={entry.item.Name}
                                        accessibilityState={{ selected: selected === entry.itemId }}
                                        accessibilityHint={
                                          entry.state === "ready" ? "Plays from this device. Swipe left or press and hold to remove." : `${subtitle}. Swipe left or press and hold to remove.`
                                        }
                                      />
                                    </SwipeToRemove>
                                  </Animated.View>
                                );
                              })}
                          </React.Fragment>
                        );
                      })}
                    </LayoutAnimationConfig>
                  </Animated.ScrollView>
                </GestureHandlerRootView>

                {/* The card runs out into the gauge rather than stopping above it: square across
                    the top, the card's own corners at the bottom. */}
                <SectionFooter layout={PANEL_SHIFT}>
                  <StorageBar used={stored} free={Paths.availableDiskSpace} />
                </SectionFooter>
              </Animated.View>
            </>
          )}
        </View>
      </ScrollView>
    </View>
  );
}

const screenStyles = StyleSheet.create({
  // The capped list's own box. Without it the root takes its flex: 1 default and collapses
  // inside the content-sized card.
  gestureRoot: {
    flexShrink: 1,
  },
  // Top air equal to the header text's own inset from the screen edge.
  deviceHeader: {
    paddingTop: GRID.SIDE_PADDING.phone + 16,
  },
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
  emptyText: {
    color: COLORS.TEXT_SECONDARY,
    fontSize: 15,
    lineHeight: 21,
    textAlign: "center",
  },
});
