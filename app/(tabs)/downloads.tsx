import { AmbientBackground } from "@/components/ambient-background";
import { BrandCorners } from "@/components/brand-corners";
import { SectionFooter } from "@/components/settings/SectionFooter";
import { DownloadRow, REMOVE_ACTIONS } from "@/components/settings/DownloadRow";
import { ListRow } from "@/components/settings/ListRow";
import { PosterMark } from "@/components/settings/PosterMark";
import { ServerConnectScreen } from "@/components/settings/ServerConnectScreen";
import { SwipeToRemove } from "@/components/settings/SwipeToRemove";
import { StorageBar } from "@/components/storage-bar";
import { downloadRowHeight, downloadsListHeight, DOWNLOAD_SUBTITLE_LINE_HEIGHT, DOWNLOAD_TITLE_LINE_HEIGHT, IS_PAD, settingsStyles as styles } from "@/components/settings/styles";
import { COLORS } from "@/constants/colors";
import { useAuth } from "@/contexts/AuthContext";
import { downloadManager, type DownloadsUIState } from "@/services/downloads/manager";
import { downloadsSupported } from "@/services/downloads/paths";
import { groupDownloads, locateDownload, totalDownloadedBytes, type DownloadGroup, type DownloadListRow } from "@/services/downloads/grouping";
import type { DownloadEntry } from "@/services/downloads/manifest";
import { useDownloadPlayback } from "@/hooks/useDownloadPlayback";
import { formatFileSize } from "@/utils/mediaInfo";
import { Ionicons } from "@expo/vector-icons";
import { Paths } from "expo-file-system";
import { useLocalSearchParams, useNavigation } from "expo-router";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Alert, FlatList, Platform, StyleSheet, Text, useWindowDimensions, View } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Animated, { LinearTransition } from "react-native-reanimated";

// A removed row leaves and the stack closes over it, which is the one list animation UIKit does
// for free and the only reason a delete reads as a delete. It rides the cell rather than the
// row: a recycled cell would play an exiting animation for a scroll.
const ROW_SHIFT = LinearTransition.duration(220);
// The panel's height changes with its rows and Yoga hands it the new height in one frame; without
// this the card, the list's clip and the footer snap while the rows move under them.
const PANEL_SHIFT = LinearTransition.duration(220);

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

/** One drawn row. A folder's members follow it while it is open. */
type ListItem =
  | { key: string; kind: "item"; entry: DownloadEntry }
  | { key: string; kind: "folder"; group: DownloadGroup; open: boolean }
  | { key: string; kind: "member"; entry: DownloadEntry; group: DownloadGroup };

/** The grouping's tree, flattened to the one array a virtualised list addresses by index. */
function flatten(rows: DownloadListRow[], expanded: string | null): ListItem[] {
  const flat: ListItem[] = [];
  for (const row of rows) {
    if (row.kind === "item") {
      flat.push({ key: row.entry.itemId, kind: "item", entry: row.entry });
      continue;
    }
    const open = expanded === row.group.id;
    flat.push({ key: row.group.id, kind: "folder", group: row.group, open });
    if (!open) continue;
    for (const entry of row.group.entries) flat.push({ key: entry.itemId, kind: "member", entry, group: row.group });
  }
  return flat;
}

const keyOf = (row: ListItem) => row.key;

/**
 * What is on the device, the one screen that needs no server. tvOS has no persistent local
 * storage, so the tab is hidden there (app/(tabs)/_layout.tsx) and this screen says so if reached.
 */
export default function DownloadsScreen() {
  // A finished file plays with no server at all, so the list stands alone. What it holds does
  // not: an unfinished transfer needs the session back before it means anything.
  const { isConnected } = useAuth();
  const [state, setState] = useState<DownloadsUIState>(() => downloadManager.getState());
  // One folder open at a time: the list is a flat section, and several open at once buries
  // whatever the user scrolled here for.
  const [expanded, setExpanded] = useState<string | null>(null);
  // The row the download circle sent us here to see. Nothing else on this screen says which of
  // twenty transfers was the one just started.
  const [selected, setSelected] = useState<string | null>(null);
  const pendingReveal = useRef<string | null>(null);
  // The mark answers "which one got me here"; the first press is that answer being read.
  const clearMark = useCallback(() => {
    pendingReveal.current = null;
    setSelected(null);
  }, []);
  const playback = useDownloadPlayback();
  const insets = useSafeAreaInsets();
  // Rows grow with Dynamic Type and the cap has to grow with them, or the list ends on a sliver.
  const { fontScale } = useWindowDimensions();
  const rowHeight = downloadRowHeight(fontScale);
  const listHeight = downloadsListHeight(fontScale);

  useEffect(() => downloadManager.subscribe(setState), []);
  useEffect(() => {
    void downloadManager.hydrate();
  }, []);

  // Signed out, the list holds only what it can actually play. An unfinished transfer has no
  // server to resume against, so it is not a file this device has: it is hidden until it is.
  const listed = useMemo(() => (isConnected ? state.entries : state.entries.filter((entry) => entry.state === "ready")), [isConnected, state.entries]);
  const flat = useMemo(() => flatten(groupDownloads(listed), expanded), [listed, expanded]);
  // What a row outside any folder queues against: the other loose downloads, not the whole
  // device. A track opened next to an album should not walk into that album.
  const loose = useMemo(() => listed.filter((entry) => !entry.group), [listed]);
  // The gauge and Remove All read the whole manifest either way: a half-written file still
  // occupies the disk it is being measured against, and removing everything still removes it.
  const stored = totalDownloadedBytes(state.entries);

  // tvOS moves focus out of a scroller only while its offset is at the matching end
  // (RCTScrollViewComponentView.shouldUpdateFocusInContext), so the capped list pins itself
  // when focus lands on its first or last row. Same pattern as the quality list in settings.
  const listRef = useRef<FlatList<ListItem>>(null);
  const pinListToTop = useCallback(() => listRef.current?.scrollToOffset({ offset: 0, animated: false }), []);
  const pinListToBottom = useCallback(() => listRef.current?.scrollToEnd({ animated: false }), []);

  // Every row measures the same, so an offset is arithmetic: a marked row can be scrolled to
  // before its cell has ever been rendered, and the list never has to measure to find it.
  const itemLayout = useCallback((_data: ArrayLike<ListItem> | null | undefined, index: number) => ({ length: rowHeight, offset: rowHeight * index, index }), [rowHeight]);

  // Centred, so the row reads as one of a set rather than as the top of one. The mark is held
  // until the row exists: a folder's members arrive only once its expansion has been committed.
  useEffect(() => {
    const key = pendingReveal.current;
    if (key === null) return;
    const index = flat.findIndex((row) => row.key === key);
    if (index < 0) return;
    pendingReveal.current = null;
    listRef.current?.scrollToIndex({ index, viewPosition: 0.5, animated: true });
  }, [flat]);

  // A folder queues its items after the push, so the id is looked for again on every manifest
  // change until it lands. Consuming it clears the param: the same item sent twice must mark
  // its row twice, and an unchanged param would not re-fire this.
  const { highlight } = useLocalSearchParams<{ highlight?: string }>();
  // Typed on the spot: useNavigation reads its params off ReactNavigation.RootParamList, which
  // declares none for a tab route, so the untyped call rejects every payload.
  const navigation = useNavigation<{ setParams: (params: { highlight?: string }) => void }>();
  useEffect(() => {
    if (!highlight) return;
    const found = locateDownload(groupDownloads(state.entries), highlight);
    if (!found) return;
    pendingReveal.current = found.rowId;
    // One shot: this run clears the param it reads, so it cannot cascade.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setExpanded(found.groupId);
    setSelected(found.rowId);
    navigation.setParams({ highlight: undefined });
  }, [highlight, state.entries, navigation]);

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

  // Downloads survive sign-out and every server switch, so the gauge is the only thing in the
  // app that clears them.
  const confirmRemoveAll = useCallback(() => {
    // Read at press time, not from the render that drew the gauge: this one deletes files.
    const entries = downloadManager.getState().entries;
    Alert.alert("Remove all downloads", `Remove all ${entries.length} items from this device? That frees ${formatFileSize(totalDownloadedBytes(entries))}.`, [
      { text: "Cancel", style: "cancel" },
      { text: "Remove All", style: "destructive", onPress: () => void downloadManager.removeAll() },
    ]);
  }, []);

  const renderRow = useCallback(
    ({ item, index }: { item: ListItem; index: number }) => {
      const onFocus = index === 0 ? pinListToTop : index === flat.length - 1 ? pinListToBottom : undefined;

      if (item.kind === "folder") {
        const { group, open } = item;
        return (
          <SwipeToRemove label={group.name} onRemove={() => confirmRemoveGroup(group)}>
            <ListRow
              icon={() => <PosterMark uri={groupArtwork(group)} />}
              title={group.name}
              subtitle={groupSubtitle(group)}
              trailingIcon={open ? undefined : "chevron-down"}
              trailingAction={
                open && playback.canShuffle(group.entries)
                  ? {
                      icon: "shuffle",
                      label: `Shuffle ${group.name}`,
                      hint: `${group.entries.filter((entry) => entry.state === "ready").length} ready. Plays on repeat.`,
                      onPress: () => {
                        clearMark();
                        playback.shuffle(group.entries, group.id, group.name);
                      },
                    }
                  : undefined
              }
              tone={group.state === "failed" ? "destructive" : "default"}
              selected={selected === group.id}
              onPress={() => {
                clearMark();
                setExpanded(open ? null : group.id);
              }}
              onLongPress={() => confirmRemoveGroup(group)}
              accessibilityActions={REMOVE_ACTIONS}
              onAccessibilityAction={(event) => {
                if (event.nativeEvent.actionName === "remove") confirmRemoveGroup(group);
              }}
              onFocus={onFocus}
              titleStyle={screenStyles.rowTitle}
              subtitleStyle={screenStyles.rowSubtitle}
              accessibilityLabel={group.name}
              accessibilityState={{ expanded: open, selected: selected === group.id }}
              accessibilityHint={`${groupSubtitle(group)}. Swipe left or press and hold to remove the whole folder.`}
            />
          </SwipeToRemove>
        );
      }

      const member = item.kind === "member";
      return (
        <DownloadRow
          entry={item.entry}
          selected={selected === item.entry.itemId}
          onPress={() => press(item.entry, member ? item.group.entries : loose, member ? item.group.id : "downloads", member ? item.group.name : "Downloads")}
          onRemove={() => confirmRemove(item.entry)}
          onFocus={onFocus}
          nested={member}
          titleStyle={screenStyles.rowTitle}
          subtitleStyle={screenStyles.rowSubtitle}
        />
      );
    },
    [flat.length, loose, selected, playback, press, confirmRemove, confirmRemoveGroup, clearMark, pinListToTop, pinListToBottom],
  );

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

  // Nothing to play and no session to fill the list with: the tab offers the one thing that
  // would, which is the view the Home and Search tabs show while logged out. Gated on hydration,
  // or the manifest read would flash this over a device that has downloads.
  if (state.hydrated && !isConnected && listed.length === 0) {
    return <ServerConnectScreen title="Downloads" />;
  }

  return (
    <View style={styles.screenContainer}>
      {/* Decoration first: siblings paint in order, and the tvOS focus rule that puts it
          behind the rows holds on phone too. Same order as the Settings screen. */}
      <AmbientBackground />
      <BrandCorners />

      {/* The list is the screen's own scroller. A virtualised list inside a ScrollView of the
          same axis is a dev error and keeps every row mounted, which is the whole point of it. */}
      <View style={[screenStyles.page, { paddingTop: insets.top + (Platform.isTV ? 4 : 8) }]}>
        <View style={[styles.contentContainer, screenStyles.column]}>
          {!Platform.isTV && (
            <Text style={styles.screenTitle} accessibilityRole="header">
              Downloads
            </Text>
          )}

          {!state.hydrated ? null : listed.length === 0 ? (
            // A card rather than a floating block: Remove All empties the list in place, and the
            // section it emptied should still be there, holding what to do about it.
            <View style={[styles.section, screenStyles.emptyCard]}>
              <Ionicons name="arrow-down-circle-outline" size={56} color={COLORS.TEXT_QUATERNARY} />
              <Text style={screenStyles.emptyText}>Nothing downloaded yet. Open an item and choose Download to keep it on this device.</Text>
            </View>
          ) : (
            <>
              <View style={[styles.sectionHeader, !Platform.isTV && styles.sectionHeaderFirst]}>
                <Text style={styles.sectionHeaderText} accessibilityRole="header">
                  ON THIS DEVICE
                </Text>
              </View>

              {/* Capped at whole rows (8 on phone, 4 on TV) and scrolling inside the card, so a
                  device full of downloads, or an expanded folder, cannot run off the bottom of
                  the screen. The wrapper keeps the radius, the clipping and the inset shadow. */}
              <Animated.View style={[styles.section, screenStyles.card]} layout={PANEL_SHIFT}>
                {/* The rows swipe, and a GestureDetector throws in dev without a root above it.
                    Styled, because the default is flex: 1 and this sits in a content-sized card. */}
                <GestureHandlerRootView style={screenStyles.gestureRoot}>
                  <Animated.FlatList
                    ref={listRef}
                    data={flat}
                    keyExtractor={keyOf}
                    renderItem={renderRow}
                    getItemLayout={itemLayout}
                    itemLayoutAnimation={ROW_SHIFT}
                    // A screen whose every row fades in reads as a screen still loading, and a
                    // cell leaving the window is a scroll, not a delete.
                    skipEnteringExitingAnimations
                    style={[styles.downloadsScrollable, { maxHeight: listHeight }]}
                    initialNumToRender={12}
                    maxToRenderPerBatch={8}
                    windowSize={5}
                    removeClippedSubviews={!Platform.isTV}
                    showsVerticalScrollIndicator={false}
                    focusable={false}
                  />
                </GestureHandlerRootView>

                {/* The card runs out into the gauge rather than stopping above it: square across
                    the top, the card's own corners at the bottom. */}
                <SectionFooter layout={PANEL_SHIFT}>
                  <StorageBar used={stored} free={Paths.availableDiskSpace} onClear={confirmRemoveAll} />
                </SectionFooter>
              </Animated.View>
            </>
          )}
        </View>
      </View>
    </View>
  );
}

const screenStyles = StyleSheet.create({
  // The page, in place of a ScrollView: the list inside it is the only thing that scrolls.
  page: {
    flex: 1,
    alignItems: "center",
    paddingBottom: Platform.isTV ? 60 : 40,
  },
  // Shrink rather than overflow: at accessibility text sizes the capped list is taller than
  // the screen, and the card has to give before the gauge is pushed off the bottom of it.
  column: {
    flexShrink: 1,
  },
  card: {
    flexShrink: 1,
  },
  // The capped list's own box. Without it the root takes its flex: 1 default and collapses
  // inside the content-sized card.
  gestureRoot: {
    flexShrink: 1,
  },
  empty: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 16,
    paddingHorizontal: 32,
    paddingTop: 120,
  },
  // The emptied section keeps a card's presence: tall enough not to read as a stray line of
  // text where a list of rows was.
  emptyCard: {
    minHeight: 140,
    alignItems: "center",
    justifyContent: "center",
    gap: 16,
    paddingHorizontal: 24,
    paddingVertical: 24,
  },
  // Pinned leading on both lines: the section's height cap is DOWNLOAD_ROW_HEIGHT times a row
  // count, and that arithmetic only holds if every row measures what it assumes.
  rowTitle: {
    lineHeight: DOWNLOAD_TITLE_LINE_HEIGHT,
  },
  // marginTop 0 overrides ListRow's subtitle air, which the row height does not budget for.
  rowSubtitle: {
    fontSize: Platform.isTV ? 22 : IS_PAD ? 15 : 14,
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
