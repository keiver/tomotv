import { AmbientBackground } from "@/components/ambient-background";
import { ContinueWatchingRow } from "@/components/continue-watching-row";
import { FocusableButton } from "@/components/FocusableButton";
import { FolderGridItem } from "@/components/folder-grid-item";
import { FolderLoadingBar } from "@/components/folder-loading-bar";
import { LibraryHeader } from "@/components/library-header";
import { VideoGridItem } from "@/components/video-grid-item";
import { gridEdgePadding, slotColumns, type SlotOrientation } from "@/constants/app";
import { usePosterBackdropDispatch } from "@/contexts/PosterBackdropContext";
import { getRecoveryStatus, RecoveryStatus, subscribeRecoveryStatus } from "@/services/connectionRecovery";
import { isFolder, signOut } from "@/services/jellyfinApi";
import { FolderStackEntry, JellyfinItem } from "@/types/jellyfin";
import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { useIsFocused, useRouter } from "expo-router";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, findNodeHandle, FlatList, LayoutChangeEvent, Platform, Pressable, StyleSheet, Text, useWindowDimensions, View } from "react-native";
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

interface LibraryGridProps {
  items: JellyfinItem[];
  isLoading: boolean;
  isLoadingMore: boolean;
  hasMoreResults: boolean;
  error: string | null;
  onItemPress: (item: JellyfinItem) => void;
  onLoadMore: () => void;
  /** "root" = libraries view (Continue Watching + heading). "folder" = inside a folder (path header). */
  variant: "root" | "folder";
  /** Folder path for the header, innermost last. Only used for the "folder" variant. */
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
 * Presentational library/folder grid. Pure UI: it receives items + callbacks and renders the grid,
 * header, and empty/error states. Navigation and data loading live in the route screens that use it.
 * Must be rendered inside a PosterBackdropProvider (it drives the dynamic backdrop on focus).
 */
export function LibraryGrid({
  items,
  isLoading,
  isLoadingMore,
  hasMoreResults,
  error,
  onItemPress,
  onLoadMore,
  variant,
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
  const backdrop = usePosterBackdropDispatch();
  const isInsideFolder = variant === "folder";

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
  // via onFiltersButtonRef once it mounts.
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
  // One-shot guard: once focus has been handed off (to the first card, or to the Filters/Configure
  // button of an empty/error result), later renders (favorites re-annotation, pagination, filter
  // changes, foreground refresh) must never re-run the handoff and yank focus from the user.
  const handoffDoneRef = useRef(false);
  // Whether the invisible focus holder is mounted. Starts true only for a cache-miss folder load
  // on TV; a cache-hit seeds items synchronously, so the first card's mount-time preferred focus
  // handles it and no holder is needed. Cleared by the handoff effect below — EXCEPT for a
  // loaded-empty folder with no Filters button, where the holder stays as the screen's only
  // focusable (without one the focus engine bounces to the tab bar and pops the route).
  const [holderActive, setHolderActive] = useState(() => IS_TV && isInsideFolder && isLoading && items.length === 0);

  // The Menu key is deliberately NOT handled here (no BackHandler, no enableTVMenuKey, no
  // usePreventRemove): the nested Stack pops it natively. Any handler dual-fires with the
  // native delivery (double pop / visible pop-start) — see memories/CLAUDE-lessons-learned.md,
  // the e136575 Menu lesson and its August 2026 confirmations.

  // Pick the grid's slot shape from the folder's dominant content orientation.
  const slotOrientation = useMemo<SlotOrientation>(() => {
    const rated = items.filter((i) => i.PrimaryImageAspectRatio != null);
    if (rated.length === 0) return "portrait";
    const landscape = rated.filter((i) => (i.PrimaryImageAspectRatio as number) >= 1).length;
    return landscape > rated.length / 2 ? "landscape" : "portrait";
  }, [items]);

  const numColumns = useMemo(() => slotColumns(slotOrientation, IS_TV, windowWidth), [slotOrientation, windowWidth]);
  const total = items.length;

  // Where the focus handoff points. -1 (no target, or its page hasn't loaded yet) means the
  // first card, which is the behaviour every screen but "Show In Folder" gets.
  const targetIndex = useMemo(() => (focusItemId ? items.findIndex((item) => item.Id === focusItemId) : -1), [focusItemId, items]);
  const focusIndex = targetIndex >= 0 ? targetIndex : 0;

  // insets.top ALREADY clears the tvOS top tab bar — measured on an Apple TV 4K: the bar's bottom
  // edge sits at 105pt and the inset is 157pt. An extra +80 used to sit here to "clear the tab bar",
  // which double-counted it and started the Libraries heading at 257pt, 84pt below where every other
  // tab begins its content (Help pads by insets.top + 16, landing at 173pt). The phone bar is at the
  // bottom, so the phone list starts right under the status bar inset. Left/right insets keep the
  // grid clear of the notch in landscape.
  //
  // Bottom clearance: the tab bar is at the BOTTOM only on phone — padding the TV
  // list by the 210px bar height created a phantom band of scrollable space below
  // the last row. The tvOS focus engine scrolls to reveal the focused element plus
  // that padding, so focusing the Continue Watching row over-scrolled the whole
  // screen under the top tab bar even when everything already fit.
  const bottomClearance = IS_TV ? 40 : TAB_BAR_HEIGHT + 20;
  // Edge padding subsumes the safe-area inset instead of stacking on top of it, so cards fill the
  // safe area (see gridEdgePadding). The Continue Watching shelf derives its card width the same
  // way, which is what keeps both rows on identical column boundaries.
  const edgeLeft = gridEdgePadding(insets.left, IS_TV);
  const edgeRight = gridEdgePadding(insets.right, IS_TV);
  const gridContentStyle = useMemo(
    () => ({
      ...styles.gridContent,
      paddingTop: (Platform.isTV ? 20 : 8) + insets.top,
      paddingBottom: bottomClearance + insets.bottom,
      paddingLeft: edgeLeft,
      paddingRight: edgeRight,
    }),
    [insets.top, insets.bottom, edgeLeft, edgeRight, bottomClearance],
  );

  // The Filters/breadcrumb bar floats OVER the grid (absolute overlay), so the list needs top
  // padding to start below it while still scrolling underneath. The bar's height is measured via
  // onLayout (the breadcrumb can wrap to multiple lines); the estimate covers the first frame.
  const [headerHeight, setHeaderHeight] = useState<number | null>(null);
  const handleHeaderLayout = useCallback((event: LayoutChangeEvent) => {
    const height = Math.round(event.nativeEvent.layout.height);
    setHeaderHeight((prev) => (prev === height ? prev : height));
  }, []);

  const folderGridContentStyle = useMemo(
    () => ({
      ...styles.gridContent,
      paddingTop: headerHeight ?? (Platform.isTV ? 40 : 16) + insets.top + (Platform.isTV ? 80 : 48),
      paddingBottom: bottomClearance + insets.bottom,
      paddingLeft: edgeLeft,
      paddingRight: edgeRight,
    }),
    [headerHeight, insets.top, insets.bottom, edgeLeft, edgeRight, bottomClearance],
  );

  // Floating folder header: absolutely positioned over the grid with a top-down scrim so the
  // scrolling posters fade under the transparent bar instead of colliding with it.
  const folderHeaderWrapStyle = useMemo(
    () => ({
      position: "absolute" as const,
      top: 0,
      left: 0,
      right: 0,
      zIndex: 10,
      paddingTop: (Platform.isTV ? 40 : 16) + insets.top,
      paddingLeft: edgeLeft,
      paddingRight: Platform.isTV ? 0 : insets.right,
    }),
    [insets.top, insets.right, edgeLeft],
  );

  // Focus-only (no blur→clear): on tvOS the incoming card's onFocus can fire before the outgoing
  // card's onBlur, so clearing on blur would race and cancel the new poster. Keep the last poster.
  const handleItemFocus = useCallback(
    (item: JellyfinItem) => {
      backdrop.focus(item);
    },
    [backdrop],
  );

  const renderItem = useCallback(
    ({ item, index }: { item: JellyfinItem; index: number }) => {
      // Top row only: pressing Up jumps to the Filters button. Lower rows keep normal up traversal.
      const nextFocusUp = isInsideFolder && index < numColumns ? filtersButtonHandle : undefined;
      // Down out of a partial last row: only the FINAL row can be short, so the stranded cards are
      // exactly those in the row above it whose column runs past the last row's end — and for every
      // one of them the nearest card downward is the final card. Collapses to an empty range when
      // the last row is full, or there is only one row.
      const lastRowStart = Math.floor((total - 1) / numColumns) * numColumns;
      const nextFocusDown = isInsideFolder && index >= total - numColumns && index < lastRowStart ? lastCardHandle : undefined;
      // Mount-time focus claim. Gated on the live screen focus so a covered screen never takes
      // the global slot, and latched off once the handoff has run: without that latch the flip
      // back to true on every screen re-focus (returning from the player) would yank focus off
      // whatever card the user left it on, since a false→true prop change re-requests focus.
      const isFocusTarget = index === focusIndex;
      const claimsFocusOnMount = isFocusTarget && isScreenFocused && !handoffDoneRef.current;
      const isLastCard = index === total - 1;
      // Stable callback refs — not in the deps, so they don't re-render memoized cards (refs
      // aren't props to arePropsEqual). Only the handoff target and the last card get one; a card
      // that is both takes the composed ref, since each role reads a different thing off the node.
      const cardRef = !IS_TV || !isInsideFolder ? undefined : isFocusTarget && isLastCard ? handleFocusAndLastCellRef : isFocusTarget ? handleFocusCellRef : isLastCard ? handleLastCellRef : undefined;
      if (isFolder(item)) {
        return (
          <FolderGridItem
            ref={cardRef}
            folder={item}
            onPress={onItemPress}
            index={index}
            onItemFocus={handleItemFocus}
            hasTVPreferredFocus={claimsFocusOnMount}
            nextFocusUp={nextFocusUp}
            nextFocusDown={nextFocusDown}
            slotOrientation={slotOrientation}
            numColumns={numColumns}
          />
        );
      }
      return (
        <VideoGridItem
          ref={cardRef}
          video={item}
          onPress={onItemPress}
          onLongPress={onItemLongPress}
          index={index}
          onItemFocus={handleItemFocus}
          hasTVPreferredFocus={claimsFocusOnMount}
          nextFocusUp={nextFocusUp}
          nextFocusDown={nextFocusDown}
          slotOrientation={slotOrientation}
          numColumns={numColumns}
        />
      );
    },
    [
      onItemPress,
      slotOrientation,
      handleItemFocus,
      onItemLongPress,
      isInsideFolder,
      numColumns,
      filtersButtonHandle,
      lastCardHandle,
      total,
      focusIndex,
      isScreenFocused,
      handleFocusCellRef,
      handleLastCellRef,
      handleFocusAndLastCellRef,
    ],
  );

  const renderFooter = useCallback(() => {
    return (
      <>
        {/* Continue Watching sits BELOW the libraries so it can appear/grow without shifting the
            library cards above it (the row renders null when there's nothing to resume). */}
        {variant === "root" && <ContinueWatchingRow />}
        {isLoadingMore && (
          <View style={styles.footerLoading}>
            <ActivityIndicator size="small" color="#FFC312" />
            <Text style={styles.footerLoadingText}>Loading more...</Text>
          </View>
        )}
      </>
    );
  }, [isLoadingMore, variant]);

  const handleLoadMore = useCallback(() => {
    if (hasMoreResults && !isLoadingMore && !isLoading) {
      onLoadMore();
    }
  }, [hasMoreResults, isLoadingMore, isLoading, onLoadMore]);

  // Initial folder load: content isn't known yet, so neither the Filters CTA nor the cards exist.
  const isFolderLoading = isInsideFolder && isLoading && items.length === 0;

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

  const listRef = useRef<FlatList<JellyfinItem> | null>(null);
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
  // scrollToIndex takes a ROW index when numColumns > 1 — FlatList's index space is rows, not
  // items (react-native/Libraries/Lists/FlatList.js, _getItem/_getItemCount).
  const focusedTargetRef = useRef<string | null>(null);
  useEffect(() => {
    if (!focusItemId || targetIndex < 0 || focusedTargetRef.current === focusItemId) return;
    if (IS_TV && !isScreenFocused) return; // covered screen — see isScreenFocused
    focusedTargetRef.current = focusItemId;
    scrollFailuresRef.current = 0;
    listRef.current?.scrollToIndex({ index: Math.floor(targetIndex / numColumns), animated: false, viewPosition: 0.5 });
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
  }, [focusItemId, targetIndex, numColumns, isScreenFocused, focusTargetCard, schedule]);

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
  // down to — the revealed screen hands focus to its first card the moment it is on top.
  useEffect(() => {
    if (!IS_TV || !isInsideFolder || handoffDoneRef.current || isLoading || !isScreenFocused) return;
    if (items.length > 0) {
      // Only release the holder once focus has actually landed: the target card may not be
      // mounted yet, and unmounting a FOCUSED holder without a destination is the original bug.
      if (!focusTargetCard()) return;
      handoffDoneRef.current = true;
      // Deliberate second phase: the holder must unmount one commit AFTER the grid mounts (post
      // native layout), which is exactly a synchronous setState in this effect.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setHolderActive(false);
    } else if (onOpenFilters || error) {
      // Loaded-empty with a Filters button, or error state with the Configure button: removing
      // the FOCUSED holder triggers UIKit's automatic focus update, which resolves to that
      // button's mount-time hasTVPreferredFocus.
      handoffDoneRef.current = true;

      setHolderActive(false);
    }
    // else: loaded-empty with no Filters button — the holder stays as the permanent anchor.
  }, [isLoading, items.length, isInsideFolder, onOpenFilters, error, isScreenFocused, focusTargetCard]);

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
      IS_TV && isInsideFolder && holderActive ? (
        <Pressable isTVSelectable hasTVPreferredFocus={isScreenFocused} onPress={() => {}} style={styles.focusHolder} accessibilityElementsHidden importantForAccessibility="no-hide-descendants" />
      ) : null,
    [isInsideFolder, holderActive, isScreenFocused],
  );

  const renderEmpty = useCallback(() => {
    if (isLoading) {
      // Folder: no spinner — the FolderLoadingBar at the bottom is the progress indicator; a faded
      // folder glyph (the empty state's icon at low opacity) anchors the center of the screen so
      // eyes landing there see the state, not a void. Root keeps its spinner.
      if (isInsideFolder) {
        return (
          <View style={styles.centerContainer} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
            <Ionicons name="folder-open-outline" size={64} color="#98989D" style={styles.loadingGlyph} />
          </View>
        );
      }
      return (
        <View style={styles.centerContainer}>
          <ActivityIndicator size="small" color="#FFC312" />
          <Text style={styles.loadingText}>Loading...</Text>
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
        <Text style={styles.emptyText}>{isInsideFolder ? (activeFilterCount > 0 ? "No items match the current filters" : "This folder is empty") : "No libraries found"}</Text>
      </View>
    );
  }, [isLoading, error, isInsideFolder, activeFilterCount, recoveryStatus, onRetry, handleSwitchServer]);

  // Breadcrumb bar with the Filters suffix action. Rendered in the loaded-empty branch too: a
  // filter selection that matches nothing must still leave the user a way back into the panel.
  // On TV the whole bar waits for the folder content (hidden while isFolderLoading): rendering it
  // early would flicker when the CTA lands and let Filters claim focus before the first card
  // exists. Those are focus-engine concerns; touch has none of them and DOES need a way back out
  // of a folder that is still loading, so the phone bar renders through the load.
  const folderHeader =
    isInsideFolder && (!IS_TV || !isFolderLoading) ? (
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
      data={items}
      renderItem={renderItem}
      keyExtractor={(item) => item.Id}
      numColumns={numColumns}
      key={numColumns}
      contentContainerStyle={isInsideFolder ? folderGridContentStyle : gridContentStyle}
      columnWrapperStyle={styles.columnWrapper}
      // Folder: the Filters bar is a pinned sibling (below), NOT a list header. Root: keep the heading.
      ListHeaderComponent={isInsideFolder ? undefined : <Text style={styles.serverHeading}>Libraries</Text>}
      showsVerticalScrollIndicator={true}
      updateCellsBatchingPeriod={50}
      initialNumToRender={Platform.isTV ? 15 : 12}
      maxToRenderPerBatch={Platform.isTV ? 15 : 12}
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

  // Floating Filters/breadcrumb bar: an absolute overlay ABOVE the grid (rendered after it for
  // paint order), always mounted, never scrolls off. The bar itself stays transparent — only the
  // gradient scrim (pointerEvents="none", so it can never block focus or touch) separates it from
  // the posters scrolling underneath. Up from the top row reaches the Filters button via
  // nextFocusUp — the search.tsx pattern that sidesteps the native scroll-focus gate (an off-top
  // list header is unfocusable, so it can't be an up-target) — unchanged by the overlay: the
  // native-handle targeting is position-independent.
  const folderHeaderOverlay = folderHeader ? (
    <View style={folderHeaderWrapStyle} onLayout={handleHeaderLayout}>
      <LinearGradient
        colors={IS_TV ? ["#141414", "#141414", "rgba(20, 20, 20, 0.55)", "transparent"] : ["rgba(20, 20, 20, 0.88)", "rgba(20, 20, 20, 0.55)", "transparent"]}
        locations={IS_TV ? [0, 0.35, 0.7, 1] : undefined}
        style={styles.headerScrim}
        pointerEvents="none"
      />
      {folderHeader}
    </View>
  ) : null;

  const inner =
    items.length === 0 ? (
      // The header is out of flow (absolute), so the empty/error block centers over the full
      // screen and nothing jumps when a folder finishes loading (loading/empty → populated).
      <View style={styles.container}>
        {renderEmpty()}
        {folderHeaderOverlay}
      </View>
    ) : isInsideFolder ? (
      <View style={styles.container}>
        {grid}
        {folderHeaderOverlay}
      </View>
    ) : (
      // No top scrim at the root: the tab bar keeps its chrome material at the
      // scroll edge (disableTransparentOnScrollEdge in (tabs)/_layout.tsx), so
      // UIKit blurs whatever passes under it. A gradient here would only be a
      // second, worse copy of that — and one the tvOS focus engine treats as
      // occlusion.
      grid
    );

  return (
    <View style={styles.container}>
      <AmbientBackground dynamic />
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
      {isInsideFolder ? <FolderLoadingBar active={isFolderLoading} title={crumbs?.[crumbs.length - 1]?.name ?? ""} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  // Horizontal padding is applied in the content-style memos (side padding + safe-area insets).
  gridContent: {},
  // Fades the canvas color down to transparent behind the floating header, running slightly past
  // its bottom edge so posters dim before emerging from under the bar.
  headerScrim: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: IS_TV ? -40 : -24,
  },
  columnWrapper: {
    justifyContent: "flex-start",
    paddingVertical: IS_TV ? 24 : 6,
  },
  // Phone matches the Search tab's 28pt title header so every tab opens the same way:
  // title at inset+8 from the top, 10pt of visible space below (4 here + the first
  // row's 6pt columnWrapper padding).
  serverHeading: {
    marginLeft: IS_TV ? 16 : 12,
    marginBottom: IS_TV ? 4 : 4,
    fontSize: 28,
    fontWeight: "700",
    color: "#FFFFFF",
  },
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
  loadingText: {
    marginTop: 36,
    fontSize: 20,
    color: "#98989D",
    fontWeight: "500",
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
