import { AmbientBackground } from "@/components/ambient-background";
import { FocusableButton } from "@/components/FocusableButton";
import { FolderGridItem } from "@/components/folder-grid-item";
// import { FiltersGhostTitle } from "@/components/filters-ghost-title";
import { FolderLoadingBar } from "@/components/folder-loading-bar";
import { LibraryHeader } from "@/components/library-header";
import { VideoGridItem } from "@/components/video-grid-item";
import { artworkSlotRatio, artworkSlotShape, BRAND_NAME, gridEdgePadding, slotCardPadding, slotRatio, slotRowHeights, type SlotOrientation } from "@/constants/app";
import { getRecoveryStatus, RecoveryStatus, subscribeRecoveryStatus } from "@/services/connectionRecovery";
import { isFolder, signOut } from "@/services/jellyfinApi";
import { FolderStackEntry, JellyfinItem } from "@/types/jellyfin";
import { isStrandedAboveLastRow, packArtworkRows, PackedRow } from "@/utils/artworkRows";
import { Ionicons } from "@expo/vector-icons";
import { useIsFocused, useRouter } from "expo-router";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, findNodeHandle, FlatList, Platform, Pressable, StyleSheet, Text, useWindowDimensions, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

const IS_TV = Platform.isTV;

/**
 * Native node handle for TV directional focus (nextFocusUp). findNodeHandle is deprecated under
 * Fabric but is still the only way to target a specific view for nextFocus* in react-native-tvos.
 * Mirrors the helper in app/(tabs)/search.tsx.
 */
function getNativeHandle(node: View | null): number | undefined {
  if (!node || !Platform.isTV) return undefined;
  const handle = findNodeHandle(node);
  return handle ?? undefined;
}

// TV tab bar is ~210px tall, phone tab bars are ~49px + safe area
const TAB_BAR_HEIGHT = IS_TV ? 210 : 49;
const CARD_PADDING = slotCardPadding(IS_TV);

interface LibraryGridProps {
  items: JellyfinItem[];
  isLoading: boolean;
  isLoadingMore: boolean;
  hasMoreResults: boolean;
  error: string | null;
  onItemPress: (item: JellyfinItem) => void;
  onLoadMore: () => void;
  /** Folder path for the header, innermost last. */
  crumbs?: FolderStackEntry[];
  /** Go up one level — wired to the touch back row. On TV the Menu button pops the stack natively. */
  onBack?: () => void;
  /** Opens the Filters panel. Renders the header Filters button only when provided ("folder" variant). */
  onOpenFilters?: () => void;
  /** Number of active filter selections, shown on the Filters button. */
  activeFilterCount?: number;
  /** Long-press on a video card (folder variant) — e.g. the favorite toggle menu. */
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
 * renders the grid, header, and empty/error states. Navigation and data loading live in the
 * route screens that use it.
 */
export function LibraryGrid({
  items,
  isLoading,
  isLoadingMore,
  hasMoreResults,
  error,
  onItemPress,
  onLoadMore,
  crumbs,
  onBack,
  onOpenFilters,
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
   * NOT screen-scoped: both `requestTVFocus` and `hasTVPreferredFocus` end at
   * RCTViewComponentView's `focusSelf`, which writes the single app-wide
   * `rootView.reactPreferredFocusedView` slot and forces a focus update on the whole surface
   * (react-native/React/Fabric/Mounting/ComponentViews/View/RCTViewComponentView.mm:200 and
   * :1118). `updateLayoutMetrics` (:1253) then RE-requests it on every layout pass for as long
   * as the view holds the prop and isn't the current preferred view.
   *
   * "Show In Folder" pushes a whole path at once, so two covered folder screens mount, load and
   * lay out alongside the visible one. Left ungated they keep claiming that global slot for a
   * view UIKit cannot focus, and the resulting focus update lands on whatever else is focusable
   * on screen — the Filters button, which is the only always-mounted focusable outside the
   * virtualized list. So a covered grid claims nothing, and the live value re-arms the claim the
   * moment the screen is revealed.
   */
  const isScreenFocused = useIsFocused();

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

  // Handle of the header's Filters button, so pressing Up from a top-row card jumps straight to it
  // (deterministic nextFocusUp, not the fragile geometry/guide redirect). The header sets the node
  // via onFiltersButtonRef once it mounts. Targeting by native handle is the search.tsx pattern,
  // and it is what makes the bar work as a list header: it does not depend on the bar's position,
  // only on the top row being the row that asks for it, which is the row the bar is next to.
  const [filtersButtonHandle, setFiltersButtonHandle] = useState<number | undefined>(undefined);
  const handleFiltersButtonRef = useCallback((node: View | null) => setFiltersButtonHandle(getNativeHandle(node)), []);

  // Native node of the card the post-load focus handoff targets (TV folder variant only): the
  // first card, or `focusItemId`'s card once that item has loaded.
  const focusCellRef = useRef<View | null>(null);
  const handleFocusCellRef = useCallback((node: View | null) => {
    focusCellRef.current = node;
  }, []);
  // Last card's native node, so the cards stranded above a PARTIAL last row have a Down target.
  // UIKit only moves focus to a candidate intersecting the projection of the focused frame, so a
  // card with empty space beneath it dead-ends; UICollectionView solves this for Apple's own grids,
  // a FlatList has to name the target itself. Same deterministic-handle approach as nextFocusUp.
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
  // pagination, filter changes, foreground refresh, and every screen reveal) must never re-run the
  // handoff or re-raise a card's mount-time claim and yank focus from the viewer. Set by the
  // handoff below, and by any card reporting focus — including the first card's own mount claim.
  //
  // STATE, not a ref: the latch has to reach the cards. A ref flip renders nothing, so the first
  // card kept `hasTVPreferredFocus` set natively long after the handoff, and UIKit re-requests a
  // claim like that on every layout pass once the view stops being the app-wide preferred one
  // (RCTViewComponentView.mm:1253). Coming back from the player is exactly that: the overlay took
  // the preferred slot, and the folder's first card grabbed focus back on the reveal's layout.
  const [handoffDone, setHandoffDone] = useState(false);
  // Whether the invisible focus holder is mounted. Starts true only for a cache-miss folder load
  // on TV; a cache-hit seeds items synchronously, so the first card's mount-time preferred focus
  // handles it and no holder is needed. Released by the latch — EXCEPT for a loaded-empty folder
  // with no Filters button, which never latches and keeps the holder as its only focusable
  // (without one the focus engine bounces to the tab bar and pops the route).
  const [holderStart] = useState(() => IS_TV && isLoading && items.length === 0);
  const holderActive = holderStart && !handoffDone;

  // The Menu key is deliberately NOT handled here (no BackHandler, no enableTVMenuKey, no
  // usePreventRemove): the nested Stack pops it natively. Any handler dual-fires with the
  // native delivery (double pop / visible pop-start) — see memories/CLAUDE-lessons-learned.md,
  // the e136575 Menu lesson and its August 2026 confirmations.

  // Fallback slot shape for items with no artwork, from the folder's dominant content
  // orientation — so an art-less folder still renders a uniform grid.
  const slotOrientation = useMemo<SlotOrientation>(() => {
    const rated = items.filter((i) => i.PrimaryImageAspectRatio != null);
    if (rated.length === 0) return "portrait";
    const landscape = rated.filter((i) => (i.PrimaryImageAspectRatio as number) >= 1).length;
    return landscape > rated.length / 2 ? "landscape" : "portrait";
  }, [items]);

  // insets.top ALREADY clears the tvOS top tab bar — measured on an Apple TV 4K: the bar's bottom
  // edge sits at 105pt and the inset is 157pt. The phone bar is at the bottom, so the phone list
  // starts right under the status bar inset. Left/right insets keep the grid clear of the notch
  // in landscape.
  //
  // Bottom clearance: the tab bar is at the BOTTOM only on phone — padding the TV
  // list by the 210px bar height created a phantom band of scrollable space below
  // the last row. The tvOS focus engine scrolls to reveal the focused element plus
  // that padding, over-scrolling the whole screen under the top tab bar even when
  // everything already fit.
  const bottomClearance = IS_TV ? 40 : TAB_BAR_HEIGHT + 20;
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
        (item) =>
          item.PrimaryImageAspectRatio
            ? { ratio: artworkSlotRatio(item.PrimaryImageAspectRatio), height: rowHeights[artworkSlotShape(item.PrimaryImageAspectRatio)] }
            : { ratio: slotRatio(slotOrientation), height: rowHeights[slotOrientation] },
        CARD_PADDING,
      ),
    [items, windowWidth, edgeLeft, edgeRight, rowHeights, slotOrientation],
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

  // Where the focus handoff points: the "Show In Folder" target once it has loaded, else the
  // first card — the behaviour every screen but "Show In Folder" gets.
  const focusTargetId = useMemo(() => (focusItemId && items.some((item) => item.Id === focusItemId) ? focusItemId : items[0]?.Id), [focusItemId, items]);
  // The row holding focusItemId, for scrollToIndex. -1 while its page hasn't loaded.
  const targetRowIndex = useMemo(() => (focusItemId ? packedRows.findIndex((row) => row.cards.some((card) => card.item.Id === focusItemId)) : -1), [focusItemId, packedRows]);

  // A folder opens at the offset the Filters bar sits at. It is a list header, so the padding is
  // the list's own and the bar scrolls away with the first row.
  const folderGridContentStyle = useMemo(
    () => ({
      ...styles.gridContent,
      paddingTop: (Platform.isTV ? 40 : 16) + insets.top,
      paddingBottom: bottomClearance + insets.bottom,
      paddingLeft: edgeLeft,
      paddingRight: edgeRight,
    }),
    [insets.top, insets.bottom, edgeLeft, edgeRight, bottomClearance],
  );

  // The same insets for the empty state, which has no list to carry them.
  const folderHeaderInFlowStyle = useMemo(
    () => ({
      paddingTop: (Platform.isTV ? 40 : 16) + insets.top,
      paddingLeft: edgeLeft,
      paddingRight: edgeRight,
    }),
    [insets.top, edgeLeft, edgeRight],
  );

  // TV only: the latch exists to retire mount-time focus claims, which phone doesn't have.
  // On phone this same handler is the press-in path, where a state flip would re-render the
  // grid under the finger of a press that is about to navigate.
  const handleItemFocus = useCallback(() => {
    if (!IS_TV) return;
    setHandoffDone(true);
  }, []);

  const renderRow = useCallback(
    ({ item: row, index: rowIndex }: { item: PackedRow<JellyfinItem>; index: number }) => {
      // Top row only: pressing Up jumps to the Filters button. Lower rows keep normal up traversal.
      const nextFocusUpForRow = rowIndex === 0 ? filtersButtonHandle : undefined;
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
            // Mount-time focus claim. Gated on the live screen focus so a covered screen never
            // takes the global slot, and dropped the moment the latch is set: a claim left
            // standing is re-requested by UIKit on later layout passes, and a false→true flip
            // re-requests it too, either of which yanks focus off the card the viewer left it on.
            const isFocusTarget = item.Id === focusTargetId;
            const claimsFocusOnMount = isFocusTarget && isScreenFocused && !handoffDone;
            const isLastCard = isLastRow && cardIndex === row.cards.length - 1;
            // Stable callback refs — not in the deps, so they don't re-render memoized cards
            // (refs aren't props to arePropsEqual). Only the handoff target and the last card
            // get one; a card that is both takes the composed ref.
            const cardRef = !IS_TV ? undefined : isFocusTarget && isLastCard ? handleFocusAndLastCellRef : isFocusTarget ? handleFocusCellRef : isLastCard ? handleLastCellRef : undefined;
            if (isFolder(item)) {
              return (
                <FolderGridItem
                  key={item.Id}
                  ref={cardRef}
                  folder={item}
                  onPress={onItemPress}
                  index={rowStart + cardIndex}
                  onItemFocus={handleItemFocus}
                  hasTVPreferredFocus={claimsFocusOnMount}
                  nextFocusUp={nextFocusUpForRow}
                  nextFocusDown={nextFocusDown}
                  cardHeight={card.cardHeight}
                  fitArtwork
                  slotOrientation={slotOrientation}
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
                nextFocusUp={nextFocusUpForRow}
                nextFocusDown={nextFocusDown}
                cardHeight={card.cardHeight}
                fitArtwork
                slotOrientation={slotOrientation}
              />
            );
          })}
        </View>
      );
    },
    [
      onItemPress,
      slotOrientation,
      handleItemFocus,
      onItemLongPress,
      filtersButtonHandle,
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
        <ActivityIndicator size="small" color="#FFC312" />
        <Text style={styles.footerLoadingText}>Loading more...</Text>
      </View>
    );
  }, [isLoadingMore]);

  const handleLoadMore = useCallback(() => {
    if (hasMoreResults && !isLoadingMore && !isLoading) {
      onLoadMore();
    }
  }, [hasMoreResults, isLoadingMore, isLoading, onLoadMore]);

  // Initial folder load: content isn't known yet, so neither the Filters CTA nor the cards exist.
  const isFolderLoading = isLoading && items.length === 0;

  // Focus the handoff target on the tvOS focus engine's own terms. Split out because the same
  // call serves the initial handoff and the later "Show In Folder" arrival.
  // Reports whether focus actually moved: the target card is only mounted once virtualization
  // has rendered its row, and a caller that unmounts the focus holder on a no-op would leave
  // focus nowhere — the exact failure the two-phase handoff below exists to prevent.
  const focusTargetCard = useCallback(() => {
    const tvNode = focusCellRef.current as unknown as { requestTVFocus?: () => void } | null;
    if (!tvNode?.requestTVFocus) return false;
    tvNode.requestTVFocus();
    return true;
  }, []);

  const listRef = useRef<FlatList<PackedRow<JellyfinItem>> | null>(null);
  // Every deferred scroll/focus step, so popping the route mid-walk can't fire one into a dead list.
  const focusTimersRef = useRef<ReturnType<typeof setTimeout>[]>([]);
  const schedule = useCallback((fn: () => void, ms: number) => {
    focusTimersRef.current.push(setTimeout(fn, ms));
  }, []);
  useEffect(() => () => focusTimersRef.current.forEach(clearTimeout), []);

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

  // Two-phase focus handoff. Removing the FOCUSED holder in the SAME commit that first mounts the
  // grid made the focus engine race the native layout of 15 fresh cells; when it lost, focus sat
  // nowhere until some unrelated later event (header onLayout, filtersButtonHandle update,
  // favorites re-annotation) happened to trigger another focus pass — the "content shown, focus
  // arrives much later" bug. Instead the holder SURVIVES that commit (it's invisible and already
  // holds focus, so nothing is racy), and this post-commit effect — by which point Fabric has
  // mounted and laid out the cells — explicitly hands focus to the first card, then unmounts the
  // holder (now a non-focused view, whose removal UIKit ignores).
  //
  // Gated on isScreenFocused (see above): a covered screen must not hand focus to its own card,
  // and the gate doubles as the trigger that runs the handoff when a pushed path is walked back
  // down to — a screen that has never held focus hands it to its first card the moment it is on
  // top. A screen that HAS held focus is latched and skips this: the effect re-runs on every
  // reveal, and coming back from the player is a reveal, where the card the viewer left must keep
  // the focus UIKit just restored to it.
  useEffect(() => {
    if (!IS_TV || handoffDone || isLoading || !isScreenFocused) return;
    if (items.length > 0) {
      // Only latch once focus has actually landed: the target card may not be mounted yet, and
      // unmounting a FOCUSED holder without a destination is the original bug.
      if (!focusTargetCard()) return;
      // Deliberate second phase: the holder must unmount one commit AFTER the grid mounts (post
      // native layout), which is exactly a synchronous setState in this effect. The same commit
      // drops the first card's mount-time claim.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setHandoffDone(true);
    } else if (onOpenFilters || error) {
      // Loaded-empty with a Filters button, or error state with the Configure button: removing
      // the FOCUSED holder triggers UIKit's automatic focus update, which resolves to that
      // button's mount-time hasTVPreferredFocus.
      setHandoffDone(true);
    }
    // else: loaded-empty with no Filters button — the holder stays as the permanent anchor.
  }, [isLoading, items.length, onOpenFilters, error, isScreenFocused, handoffDone, focusTargetCard]);

  // On tvOS the focus engine must always have a target, and the outer trapFocusUp keeps it on the
  // screen. During the initial folder load nothing focusable is rendered — the header (and its
  // focusable Filters CTA) waits for the content, because an early Filters button would claim
  // focus before the first card exists and keep it. The invisible holder anchors focus through
  // that window and through the commit that mounts the grid; the handoff effect above then moves
  // focus onto the first card and dismisses it. Rendered as a stable sibling of {inner} (NOT
  // inside renderEmpty) so the loading→loaded branch switch never remounts it — a remount would
  // re-fire its hasTVPreferredFocus and race the cards. Root never bounces (bottom of the stack),
  // so it gets no holder.
  //
  // It stays MOUNTED on a covered screen (it is the anchor for when that screen is revealed) but
  // only CLAIMS focus while the screen is on top — an unfocusable claim on the app-wide slot is
  // what pushed focus onto the visible screen's Filters button. See isScreenFocused.
  const focusHolder = useMemo(
    () =>
      IS_TV && holderActive ? (
        <Pressable isTVSelectable hasTVPreferredFocus={isScreenFocused} onPress={() => {}} style={styles.focusHolder} accessibilityElementsHidden importantForAccessibility="no-hide-descendants" />
      ) : null,
    [holderActive, isScreenFocused],
  );

  const renderEmpty = useCallback(() => {
    if (isLoading) {
      // No spinner — the FolderLoadingBar at the bottom is the progress indicator; a faded
      // folder glyph (the empty state's icon at low opacity) anchors the center of the screen
      // so eyes landing there see the state, not a void.
      return (
        <View style={styles.centerContainer} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
          <Ionicons name="folder-open-outline" size={64} color="#98989D" style={styles.loadingGlyph} />
        </View>
      );
    }

    if (error) {
      if (recoveryStatus === "running") {
        return (
          <View style={styles.centerContainer}>
            <ActivityIndicator size="small" color="#FFC312" />
            <Text style={styles.errorTitle}>Looking for your server...</Text>
            <Text style={styles.errorText}>Checking this network for your Jellyfin server</Text>
          </View>
        );
      }
      return (
        <View style={styles.centerContainer}>
          <Ionicons name="alert-circle-outline" size={64} color="#FF3B30" />
          <Text style={styles.errorTitle}>Unable to Load</Text>
          <Text style={styles.errorText}>{error}</Text>

          <View style={styles.buttonGroup}>
            {onRetry ? (
              <FocusableButton title="Retry" variant="primary" onPress={onRetry} icon={<Ionicons name="refresh-outline" size={Platform.isTV ? 24 : 20} color="#000000" />} hasTVPreferredFocus={true} />
            ) : null}
            <FocusableButton
              title="Switch Server"
              variant="secondary"
              onPress={handleSwitchServer}
              icon={<Ionicons name="swap-horizontal-outline" size={Platform.isTV ? 24 : 20} color="#FFC312" />}
              hasTVPreferredFocus={!onRetry}
            />
          </View>
        </View>
      );
    }

    return (
      <View style={styles.centerContainer}>
        <Ionicons name="folder-open-outline" size={64} color="#98989D" />
        <Text style={styles.emptyText}>{activeFilterCount > 0 ? "No items match the current filters" : "This folder is empty"}</Text>
      </View>
    );
  }, [isLoading, error, activeFilterCount, recoveryStatus, onRetry, handleSwitchServer]);

  // Breadcrumb bar with the Filters suffix action. Rendered in the loaded-empty branch too: a
  // filter selection that matches nothing must still leave the user a way back into the panel.
  // On TV the whole bar waits for the folder content (hidden while isFolderLoading): rendering it
  // early would flicker when the CTA lands and let Filters claim focus before the first card
  // exists. Those are focus-engine concerns; touch has none of them and DOES need a way back out
  // of a folder that is still loading, so the phone bar renders through the load.
  const folderHeader =
    !IS_TV || !isFolderLoading ? (
      <LibraryHeader
        stack={crumbs ?? []}
        onBack={onBack ?? (() => {})}
        onOpenFilters={onOpenFilters}
        activeFilterCount={activeFilterCount}
        onFiltersButtonRef={handleFiltersButtonRef}
        // Loaded-empty only (the bar doesn't render while loading): keeps focus on a visible
        // control when there is no card to take it. Never from a covered screen — that claim is
        // app-wide, not screen-local (see isScreenFocused).
        filtersButtonHasPreferredFocus={items.length === 0 && isScreenFocused}
      />
    ) : null;

  const grid = (
    <FlatList
      ref={listRef}
      testID="library-list"
      data={packedRows}
      renderItem={renderRow}
      keyExtractor={(row) => row.cards[0].item.Id}
      contentContainerStyle={folderGridContentStyle}
      ListHeaderComponent={folderHeader}
      showsVerticalScrollIndicator={false}
      updateCellsBatchingPeriod={50}
      // List items are packed ROWS of ~3-4 cards, so the render counts are rows.
      initialNumToRender={Platform.isTV ? 8 : 6}
      maxToRenderPerBatch={Platform.isTV ? 8 : 6}
      windowSize={5}
      contentInsetAdjustmentBehavior="never"
      // Phone: detach off-screen cells so a long-scrolled grid doesn't unmount hundreds of
      // native views in one commit on pop (same setting as the search results list).
      // TV must keep everything mounted — the focus engine needs live cells to traverse.
      removeClippedSubviews={!IS_TV}
      onEndReached={handleLoadMore}
      onEndReachedThreshold={0.5}
      onScrollToIndexFailed={handleScrollToIndexFailed}
      ListFooterComponent={renderFooter}
    />
  );

  const inner =
    items.length === 0 ? (
      // An empty folder renders no list, so the bar it would have headed goes in flow here — it is
      // the only control on the screen, and the one the focus claim above expects to find. Padded
      // to the list's own content insets so it does not move when the folder fills.
      <View style={styles.container}>
        {folderHeader ? <View style={folderHeaderInFlowStyle}>{folderHeader}</View> : null}
        {renderEmpty()}
      </View>
    ) : (
      grid
    );

  return (
    <View style={styles.container}>
      <AmbientBackground />
      {/* The brand mark, in the bottom-right corner on every platform and orientation. Screen-level
          and out of flow, so it holds that corner while the grid scrolls under it. Before the
          list, like every other ghost — on tvOS a view above a focusable occludes it, and this
          file serves both platforms. */}
      {/* <FiltersGhostTitle name={BRAND_NAME} variant="brand" /> */}
      {/* No trapFocusUp. A folder used to be wrapped in one because Up escaping the top row moved
          focus to the tab bar and popped the nested Stack to root — but that pop was
          react-native-screens' repeated-tab-selection special effect, not UIKit, and it is now off
          for this tab (see app/(tabs)/_layout.tsx). With it gone the escape is harmless, so Up is
          free again: top row → Filters bar (via nextFocusUp) → tab bar, and a scrolled grid still
          keeps Up inside itself via the native scroll-view containment check. */}
      {inner}
      {focusHolder}
      {/* Bottom loading bar: mounted for the whole folder lifetime (outside the empty/grid branch
          switch) so its complete-then-fade handoff plays over the arriving grid. */}
      <FolderLoadingBar active={isFolderLoading} title={crumbs?.[crumbs.length - 1]?.name ?? ""} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  // Horizontal padding is applied in the content-style memos (side padding + safe-area insets).
  gridContent: {},
  // One justified row of mixed-shape cards, all at the row's unified height.
  rowWrapper: {
    flexDirection: "row",
    justifyContent: "flex-start",
    paddingVertical: IS_TV ? 24 : 6,
  },
  // Phone matches the Search tab's 28pt title header so every tab opens the same way:
  // title at inset+8 from the top, 10pt of visible space below (4 here + the first
  // row's 6pt rowWrapper padding).
  centerContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    // Symmetric: this block is optically centered on screen, not aligned to the grid's left column.
    padding: 40,
  },
  // Invisible TV focus anchor (see focusHolder above). Fills the area so the focus engine has a
  // reliable target; transparent and non-interactive so the user only sees the spinner/empty text.
  focusHolder: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
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
    color: "#FFFFFF",
    textAlign: "center",
  },
  errorText: {
    marginTop: 18,
    fontSize: 17,
    color: "#98989D",
    textAlign: "center",
    lineHeight: 24,
  },
  emptyText: {
    marginTop: 16,
    fontSize: 20,
    color: "#98989D",
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
    color: "#98989D",
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
