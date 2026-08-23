import { AmbientBackground } from "@/components/ambient-background";
import { FocusableButton } from "@/components/FocusableButton";
import { FolderGridItem } from "@/components/folder-grid-item";
// import { FiltersGhostTitle } from "@/components/filters-ghost-title";
import { FolderLoadingBar } from "@/components/folder-loading-bar";
import { VideoGridItem } from "@/components/video-grid-item";
import { gridEdgePadding, itemSlotRatio, itemSlotShape, slotCardPadding, slotRowHeights } from "@/constants/app";
import { COLORS } from "@/constants/colors";
import { getRecoveryStatus, RecoveryStatus, subscribeRecoveryStatus } from "@/services/connectionRecovery";
import { isFolder, signOut } from "@/services/jellyfinApi";
import { JellyfinItem } from "@/types/jellyfin";
import { isStrandedAboveLastRow, packArtworkRows, PackedRow } from "@/utils/artworkRows";
import { backkeyProbe } from "@/utils/backkeyProbe";
import { cardResumeProgress } from "@/utils/resumeProgress";
import { Ionicons } from "@expo/vector-icons";
import { useIsFocused, useRouter } from "expo-router";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, findNodeHandle, FlatList, Platform, StyleSheet, Text, useWindowDimensions, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

const IS_TV = Platform.isTV;

/**
 * Native node handle for TV directional focus (nextFocusDown). findNodeHandle is deprecated under
 * Fabric but is still the only way to target a specific view for nextFocus* in react-native-tvos.
 * Mirrors the helper in app/(tabs)/search.tsx.
 */
function getNativeHandle(node: View | null): number | undefined {
  if (!node || !Platform.isTV) return undefined;
  const handle = findNodeHandle(node);
  return handle ?? undefined;
}

const CARD_PADDING = slotCardPadding(IS_TV);

interface LibraryGridProps {
  items: JellyfinItem[];
  isLoading: boolean;
  isLoadingMore: boolean;
  hasMoreResults: boolean;
  error: string | null;
  onItemPress: (item: JellyfinItem) => void;
  onLoadMore: () => void;
  /** Name of the folder being shown, for the loading bar and the dev focus probes. */
  folderName?: string;
  /** Number of active filter selections, which decides the empty state's wording. */
  activeFilterCount?: number;
  /** Long-press on any card, folder cards included — opens the info panel. */
  onItemLongPress?: (item: JellyfinItem) => void;
  /** Re-runs the load from the error state's Retry button. */
  onRetry?: () => void;
  /**
   * Item to scroll to and focus once it has loaded, instead of the first card — how "Show In
   * Folder" lands the user on the card they came for. Until it turns up (the folder screen
   * pages forward to find it) the first card keeps the focus, so focus is never left nowhere.
   */
  focusItemId?: string;
}

/**
 * Presentational folder grid — the inside of a library, playlist or series (the Home tab's
 * shelf layout is components/home-shelves.tsx). Pure UI: it receives items + callbacks and
 * renders the grid and the empty/error states. The title and the Filters control are the screen's
 * native navigation bar (app/(tabs)/(library)/[folderId].tsx); navigation and data loading live in
 * the route screens that use this.
 */
export function LibraryGrid({
  items,
  isLoading,
  isLoadingMore,
  hasMoreResults,
  error,
  onItemPress,
  onLoadMore,
  folderName,
  activeFilterCount = 0,
  onItemLongPress,
  onRetry,
  focusItemId,
}: LibraryGridProps) {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { width: windowWidth } = useWindowDimensions();

  /**
   * Whether this grid's screen is the one on top. Load-bearing on tvOS, because focus here is
   * NOT screen-scoped: `hasTVPreferredFocus` ends at RCTViewComponentView's `focusSelf`, which
   * writes the single app-wide `rootView.reactPreferredFocusedView` slot and forces a focus update
   * on the whole surface (RCTViewComponentView.mm:200, :1118). `updateLayoutMetrics` (:1253) then
   * RE-requests it on every layout pass for as long as the view holds the prop and isn't the
   * current preferred view.
   *
   * "Show In Folder" pushes a whole path at once, so two covered folder screens mount, load and
   * lay out alongside the visible one. Left ungated they keep claiming that global slot for a view
   * UIKit cannot focus, and the resulting focus update lands on whatever else is focusable on
   * screen. So a covered grid claims nothing, and the live value re-arms the claim the moment the
   * screen is revealed.
   */
  const isScreenFocused = useIsFocused();
  // [backkey] dev-only diagnostics for the Menu/back investigation
  useEffect(() => {
    if (IS_TV) backkeyProbe("screen focus flip", { focused: isScreenFocused, folder: folderName });
  }, [isScreenFocused, folderName]);

  // Connection recovery runs in the background after a network-classified load
  // failure; while it is looking for the server the error state shows progress
  // instead of dead-end actions. A recovered connection refreshes the load via
  // the auth-change subscription, which clears `error` and leaves this branch.
  const [recoveryStatus, setRecoveryStatus] = useState<RecoveryStatus>(getRecoveryStatus());
  useEffect(() => subscribeRecoveryStatus(setRecoveryStatus), []);

  // Switching servers from the error state is an explicit choice to leave this
  // server, so no extra confirmation. Sign-out flips isConnected and the
  // Library root swaps to the connect screen; pop home so a pushed folder
  // route doesn't linger on a dead grid.
  //
  // dismissTo, not navigate: from inside a folder, navigate pushed a duplicate root onto the
  // (library) stack and left the dead folder route underneath it, one Menu press away. Same
  // router behaviour as the login unwind — see hooks/useFinishLogin.ts.
  const handleSwitchServer = useCallback(async () => {
    await signOut();
    router.dismissTo("/");
  }, [router]);

  // Native node of the card "Show In Folder" targets, once that item has loaded.
  const focusCellRef = useRef<View | null>(null);
  const handleFocusCellRef = useCallback((node: View | null) => {
    focusCellRef.current = node;
  }, []);
  // Last card's native node, so the cards stranded above a PARTIAL last row have a Down target.
  // UIKit only moves focus to a candidate intersecting the projection of the focused frame, so a
  // card with empty space beneath it dead-ends; UICollectionView solves this for Apple's own grids,
  // a FlatList has to name the target itself.
  const [lastCardHandle, setLastCardHandle] = useState<number | undefined>(undefined);
  const handleLastCellRef = useCallback((node: View | null) => setLastCardHandle(getNativeHandle(node)), []);
  // A card can be both the focus target and the last card; each role needs its own node.
  const handleFocusAndLastCellRef = useCallback(
    (node: View | null) => {
      focusCellRef.current = node;
      handleLastCellRef(node);
    },
    [handleLastCellRef],
  );
  // One-shot latch: once focus is inside this grid, later renders (favorites re-annotation,
  // pagination, filter changes, foreground refresh, and every screen reveal) must never re-raise a
  // card's mount-time claim and yank focus from the viewer. Same shape as home-shelves' focusClaimed.
  //
  // STATE, not a ref: the latch has to reach the cards. A ref flip renders nothing, so the first
  // card would keep `hasTVPreferredFocus` set natively, and UIKit re-requests a claim like that on
  // every layout pass once the view stops being the app-wide preferred one
  // (RCTViewComponentView.mm:1253) — which is what coming back from the player is.
  const [handoffDone, setHandoffDone] = useState(false);

  // The Menu key is deliberately NOT handled here (no BackHandler, no enableTVMenuKey, no
  // usePreventRemove): the nested Stack pops it natively. Any handler dual-fires with the
  // native delivery (double pop / visible pop-start) — see memories/CLAUDE-lessons-learned.md,
  // the e136575 Menu lesson and its August 2026 confirmations.

  // Edge padding subsumes the safe-area inset instead of stacking on top of it, so cards fill the
  // safe area (see gridEdgePadding). The home shelves derive their card widths the same way,
  // which is what keeps every screen on identical column boundaries.
  const edgeLeft = gridEdgePadding(insets.left, IS_TV);
  const edgeRight = gridEdgePadding(insets.right, IS_TV);

  // Mixed-shape JUSTIFIED rows, same card system as the home shelves: each card sized by its
  // artwork's snapped shape (posters taller than wide thumbs), each full row scaled uniformly
  // to exactly fill the width (no trailing gap). The FlatList virtualizes ROWS — its index
  // space is rows from here on.
  const rowHeights = useMemo(() => slotRowHeights(windowWidth, insets.left, insets.right, IS_TV, "grid"), [windowWidth, insets.left, insets.right]);
  const packedRows = useMemo(
    () =>
      packArtworkRows(
        items,
        windowWidth - edgeLeft - edgeRight,
        // itemSlotShape is the same mapping the cards render with (see cardSlotRatio) — the
        // packer and the cards MUST agree or justified rows misalign around no-art items.
        (item) => {
          const shape = itemSlotShape(item.PrimaryImageAspectRatio);
          return { ratio: itemSlotRatio(item.PrimaryImageAspectRatio), height: rowHeights[shape] };
        },
        CARD_PADDING,
      ),
    [items, windowWidth, edgeLeft, edgeRight, rowHeights],
  );
  const lastRowWidth = packedRows.length > 0 ? packedRows[packedRows.length - 1].width : 0;
  // Global item index of each row's first card (drives image-priority for the first cards).
  const rowStartIndices = useMemo(() => {
    const starts: number[] = [];
    let acc = 0;
    for (const row of packedRows) {
      starts.push(acc);
      acc += row.cards.length;
    }
    return starts;
  }, [packedRows]);

  // Where the mount-time claim points: the "Show In Folder" target once it has loaded, else the
  // first card — the behaviour every other screen gets.
  const focusTargetId = useMemo(() => (focusItemId && items.some((item) => item.Id === focusItemId) ? focusItemId : items[0]?.Id), [focusItemId, items]);
  // The row holding focusItemId, for scrollToIndex. -1 while its page hasn't loaded.
  const targetRowIndex = useMemo(() => (focusItemId ? packedRows.findIndex((row) => row.cards.some((card) => card.item.Id === focusItemId)) : -1), [focusItemId, packedRows]);

  // Design gap only. The navigation bar is translucent, so UIKit's own adjusted content inset
  // clears it (contentInsetAdjustmentBehavior below), and the same inset clears the tab bar and
  // the home indicator at the bottom.
  const folderGridContentStyle = useMemo(
    () => ({
      ...styles.gridContent,
      paddingTop: IS_TV ? 40 : 16,
      paddingBottom: IS_TV ? 40 : 20,
      paddingLeft: edgeLeft,
      paddingRight: edgeRight,
    }),
    [edgeLeft, edgeRight],
  );

  // TV only: the latch exists to retire mount-time focus claims, which phone doesn't have.
  // On phone this same handler is the press-in path, where a state flip would re-render the
  // grid under the finger of a press that is about to navigate.
  const handleItemFocus = useCallback(
    (item: JellyfinItem) => {
      if (!IS_TV) return;
      // [backkey] dev-only diagnostics for the Menu/back investigation
      backkeyProbe("card focus", { id: item.Id, name: item.Name, folder: folderName });
      setHandoffDone(true);
    },
    [folderName],
  );

  // Focus the "Show In Folder" target on the tvOS focus engine's own terms. Reports whether the
  // request could be MADE (the card is only mounted once virtualization has rendered its row), not
  // that focus landed; UIKit resolves the request on its own schedule.
  const focusTargetCard = useCallback(() => {
    const tvNode = focusCellRef.current as unknown as { requestTVFocus?: () => void } | null;
    if (!tvNode?.requestTVFocus) return false;
    // [backkey] dev-only diagnostics for the Menu/back investigation
    backkeyProbe("requestTVFocus on target card");
    tvNode.requestTVFocus();
    return true;
  }, []);

  // Every deferred scroll/focus step, so popping the route mid-walk can't fire one into a dead list.
  const focusTimersRef = useRef<ReturnType<typeof setTimeout>[]>([]);
  const schedule = useCallback((fn: () => void, ms: number) => {
    focusTimersRef.current.push(setTimeout(fn, ms));
  }, []);
  useEffect(() => () => focusTimersRef.current.forEach(clearTimeout), []);

  const renderRow = useCallback(
    ({ item: row, index: rowIndex }: { item: PackedRow<JellyfinItem>; index: number }) => {
      const isSecondToLastRow = rowIndex === packedRows.length - 2;
      const isLastRow = rowIndex === packedRows.length - 1;
      const rowStart = rowStartIndices[rowIndex] ?? 0;
      return (
        <View style={styles.rowWrapper}>
          {row.cards.map((card, cardIndex) => {
            const item = card.item;
            // Down out of a ragged last row: a card in the row above starting past the last
            // row's right edge has no candidate beneath it (UIKit needs frame overlap), so it
            // names the final card as its Down target.
            const nextFocusDown = isSecondToLastRow && isStrandedAboveLastRow(card, lastRowWidth) ? lastCardHandle : undefined;
            // Mount-time focus claim, which is what moves focus off the navigation bar and onto the
            // grid. Gated on the live screen focus so a covered screen never takes the global slot,
            // and dropped the moment the latch is set: a claim left standing is re-requested by
            // UIKit on later layout passes, and a false→true flip re-requests it too.
            const isFocusTarget = item.Id === focusTargetId;
            const claimsFocusOnMount = isFocusTarget && isScreenFocused && !handoffDone;
            const isLastCard = isLastRow && cardIndex === row.cards.length - 1;
            // Stable callback refs — not in the deps, so they don't re-render memoized cards
            // (refs aren't props to arePropsEqual). Only the focus target and the last card
            // get one; a card that is both takes the composed ref.
            const cardRef = !IS_TV ? undefined : isFocusTarget && isLastCard ? handleFocusAndLastCellRef : isFocusTarget ? handleFocusCellRef : isLastCard ? handleLastCellRef : undefined;
            if (isFolder(item)) {
              return (
                <FolderGridItem
                  key={item.Id}
                  ref={cardRef}
                  folder={item}
                  onPress={onItemPress}
                  onLongPress={onItemLongPress}
                  index={rowStart + cardIndex}
                  onItemFocus={handleItemFocus}
                  hasTVPreferredFocus={claimsFocusOnMount}
                  nextFocusDown={nextFocusDown}
                  cardHeight={card.cardHeight}
                  fitArtwork
                />
              );
            }
            return (
              <VideoGridItem
                key={item.Id}
                ref={cardRef}
                video={item}
                onPress={onItemPress}
                onLongPress={onItemLongPress}
                index={rowStart + cardIndex}
                onItemFocus={handleItemFocus}
                hasTVPreferredFocus={claimsFocusOnMount}
                nextFocusDown={nextFocusDown}
                cardHeight={card.cardHeight}
                fitArtwork
                progressPercent={cardResumeProgress(item)}
              />
            );
          })}
        </View>
      );
    },
    [
      onItemPress,
      handleItemFocus,
      onItemLongPress,
      lastCardHandle,
      packedRows.length,
      rowStartIndices,
      lastRowWidth,
      focusTargetId,
      isScreenFocused,
      handoffDone,
      handleFocusCellRef,
      handleLastCellRef,
      handleFocusAndLastCellRef,
    ],
  );

  const renderFooter = useCallback(() => {
    if (!isLoadingMore) return null;
    return (
      <View style={styles.footerLoading}>
        <ActivityIndicator size="small" color={COLORS.ACCENT} />
        <Text style={styles.footerLoadingText}>Loading more...</Text>
      </View>
    );
  }, [isLoadingMore]);

  const handleLoadMore = useCallback(() => {
    if (hasMoreResults && !isLoadingMore && !isLoading) {
      onLoadMore();
    }
  }, [hasMoreResults, isLoadingMore, isLoading, onLoadMore]);

  // Initial folder load: content isn't known yet, so no cards exist.
  const isFolderLoading = isLoading && items.length === 0;

  const listRef = useRef<FlatList<PackedRow<JellyfinItem>> | null>(null);

  // scrollToIndex can't reach a row outside the render window without getItemLayout, which this
  // grid deliberately doesn't have — the row height is derivable, but getting it a pixel wrong
  // would corrupt ALL scrolling to buy one focus nicety. The documented recovery instead: jump to
  // the estimated offset, let that render, then ask again. Only ever fires from our own call.
  const scrollFailuresRef = useRef(0);
  const handleScrollToIndexFailed = useCallback(
    (info: { index: number; averageItemLength: number }) => {
      if (scrollFailuresRef.current >= 3) return;
      scrollFailuresRef.current += 1;
      listRef.current?.scrollToOffset({ offset: info.averageItemLength * info.index, animated: false });
      schedule(() => listRef.current?.scrollToIndex({ index: info.index, animated: false, viewPosition: 0.5 }), 120);
    },
    [schedule],
  );

  // "Show In Folder" target. One-shot per id: after this the user owns the focus, and later renders
  // (pagination, favorites re-annotation, a foreground refresh) must never yank it back.
  // The list's data IS rows, so targetRowIndex feeds scrollToIndex directly.
  const focusedTargetRef = useRef<string | null>(null);
  useEffect(() => {
    if (!focusItemId || targetRowIndex < 0 || focusedTargetRef.current === focusItemId) return;
    if (IS_TV && !isScreenFocused) return; // covered screen — see isScreenFocused
    focusedTargetRef.current = focusItemId;
    scrollFailuresRef.current = 0;
    listRef.current?.scrollToIndex({ index: targetRowIndex, animated: false, viewPosition: 0.5 });
    if (!IS_TV) return; // phone has no focus engine — the scroll IS the whole gesture
    // The card mounts only once that scroll pulls its row into the render window, so poll for the
    // ref instead of assuming it is already attached.
    let attempts = 0;
    const tryFocus = () => {
      if (focusCellRef.current) {
        focusTargetCard();
        return;
      }
      if (++attempts >= 6) return;
      schedule(tryFocus, 100);
    };
    schedule(tryFocus, 60);
  }, [focusItemId, targetRowIndex, isScreenFocused, focusTargetCard, schedule]);

  const renderEmpty = useCallback(() => {
    if (isLoading) {
      // No spinner — the FolderLoadingBar at the bottom is the progress indicator; a faded
      // folder glyph (the empty state's icon at low opacity) anchors the center of the screen
      // so eyes landing there see the state, not a void.
      return (
        <View style={styles.centerContainer} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
          <Ionicons name="folder-open-outline" size={64} color={COLORS.TEXT_SECONDARY} style={styles.loadingGlyph} />
        </View>
      );
    }

    if (error) {
      if (recoveryStatus === "running") {
        return (
          <View style={styles.centerContainer}>
            <ActivityIndicator size="small" color={COLORS.ACCENT} />
            <Text style={styles.errorTitle}>Looking for your server...</Text>
            <Text style={styles.errorText}>Checking this network for your Jellyfin server</Text>
          </View>
        );
      }
      return (
        <View style={styles.centerContainer}>
          <Ionicons name="alert-circle-outline" size={64} color={COLORS.DESTRUCTIVE} />
          <Text style={styles.errorTitle}>Unable to Load</Text>
          <Text style={styles.errorText}>{error}</Text>

          <View style={styles.buttonGroup}>
            {onRetry ? (
              <FocusableButton
                title="Retry"
                variant="primary"
                onPress={onRetry}
                icon={<Ionicons name="refresh-outline" size={Platform.isTV ? 24 : 20} color={COLORS.ON_ACCENT} />}
                hasTVPreferredFocus={true}
              />
            ) : null}
            <FocusableButton
              title="Switch Server"
              variant="secondary"
              onPress={handleSwitchServer}
              icon={<Ionicons name="swap-horizontal-outline" size={Platform.isTV ? 24 : 20} color={COLORS.ACCENT} />}
              hasTVPreferredFocus={!onRetry}
            />
          </View>
        </View>
      );
    }

    return (
      <View style={styles.centerContainer}>
        <Ionicons name="folder-open-outline" size={64} color={COLORS.TEXT_SECONDARY} />
        <Text style={styles.emptyText}>{activeFilterCount > 0 ? "No items match the current filters" : "This folder is empty"}</Text>
      </View>
    );
  }, [isLoading, error, activeFilterCount, recoveryStatus, onRetry, handleSwitchServer]);

  return (
    <View style={styles.container}>
      <AmbientBackground />
      {/* The brand mark, in the bottom-right corner on every platform and orientation. Screen-level
          and out of flow, so it holds that corner while the grid scrolls under it. Before the
          list, like every other ghost — on tvOS a view above a focusable occludes it, and this
          file serves both platforms. */}
      {/* <FiltersGhostTitle name={BRAND_NAME} variant="brand" /> */}
      {/* No trapFocusUp: react-native-screens' repeated-tab-selection pop is off for this tab
          (see app/(tabs)/_layout.tsx), so the Up escape is harmless. The ladder is top row →
          navigation bar → tab bar, and a scrolled grid keeps Up inside itself via the native
          scroll-view containment check. */}
      <FlatList
        ref={listRef}
        testID="library-list"
        data={packedRows}
        renderItem={renderRow}
        keyExtractor={(row) => row.cards[0].item.Id}
        contentContainerStyle={folderGridContentStyle}
        ListEmptyComponent={renderEmpty}
        showsVerticalScrollIndicator={false}
        updateCellsBatchingPeriod={50}
        // List items are packed ROWS of ~3-4 cards, so the render counts are rows.
        initialNumToRender={Platform.isTV ? 8 : 6}
        maxToRenderPerBatch={Platform.isTV ? 8 : 6}
        windowSize={5}
        // UIKit owns the insets: the header is translucent, so the screen extends under it and the
        // adjusted inset is the only thing that clears the bar (and the tab bar below).
        // headerLargeTitleEnabled needs this to collapse the title on scroll.
        contentInsetAdjustmentBehavior="automatic"
        // Phone: detach off-screen cells so a long-scrolled grid doesn't unmount hundreds of
        // native views in one commit on pop (same setting as the search results list).
        // TV must keep everything mounted — the focus engine needs live cells to traverse.
        removeClippedSubviews={!IS_TV}
        onEndReached={handleLoadMore}
        onEndReachedThreshold={0.5}
        onScrollToIndexFailed={handleScrollToIndexFailed}
        ListFooterComponent={renderFooter}
      />
      {/* Bottom loading bar: mounted for the whole folder lifetime so its complete-then-fade
          handoff plays over the arriving grid. */}
      <FolderLoadingBar active={isFolderLoading} title={folderName ?? ""} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  // Horizontal padding is applied in the content-style memo (side padding + safe-area insets).
  // flexGrow lets the empty and loading states centre in the viewport.
  gridContent: {
    flexGrow: 1,
  },
  // One justified row of mixed-shape cards, all at the row's unified height.
  rowWrapper: {
    flexDirection: "row",
    justifyContent: "flex-start",
    paddingVertical: IS_TV ? 24 : 6,
  },
  centerContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    // Symmetric: this block is optically centered on screen, not aligned to the grid's left column.
    padding: 40,
  },
  // Center-screen anchor while a folder loads: the empty state's folder glyph, dimmed. It brightens
  // in place if the folder turns out to be empty (same icon, same position).
  loadingGlyph: {
    opacity: 0.4,
  },
  errorTitle: {
    marginTop: 16,
    fontSize: 24,
    fontWeight: "700",
    color: COLORS.TEXT_PRIMARY,
    textAlign: "center",
  },
  errorText: {
    marginTop: 18,
    fontSize: 17,
    color: COLORS.TEXT_SECONDARY,
    textAlign: "center",
    lineHeight: 24,
  },
  emptyText: {
    marginTop: 16,
    fontSize: 20,
    color: COLORS.TEXT_SECONDARY,
    textAlign: "center",
  },
  footerLoading: {
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
    paddingVertical: 30,
    gap: 12,
  },
  footerLoadingText: {
    fontSize: Platform.isTV ? 20 : 16,
    color: COLORS.TEXT_SECONDARY,
    fontWeight: "500",
  },
  buttonGroup: {
    gap: Platform.isTV ? 16 : 12,
    marginTop: Platform.isTV ? 32 : 24,
    width: "100%",
    maxWidth: 400,
    alignItems: "center",
  },
});
