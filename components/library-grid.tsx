import { AmbientBackground } from "@/components/ambient-background";
import { ContinueWatchingRow } from "@/components/continue-watching-row";
import { FocusableButton } from "@/components/FocusableButton";
import { FolderGridItem } from "@/components/folder-grid-item";
import { FolderLoadingBar } from "@/components/folder-loading-bar";
import { LibraryHeader } from "@/components/library-header";
import { TopScrim } from "@/components/top-scrim";
import { VideoGridItem } from "@/components/video-grid-item";
import { gridEdgePadding, slotColumns, type SlotOrientation } from "@/constants/app";
import { usePosterBackdropDispatch } from "@/contexts/PosterBackdropContext";
import { getRecoveryStatus, RecoveryStatus, subscribeRecoveryStatus } from "@/services/connectionRecovery";
import { isFolder, signOut } from "@/services/jellyfinApi";
import { FolderStackEntry, JellyfinItem } from "@/types/jellyfin";
import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { useRouter } from "expo-router";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, findNodeHandle, FlatList, LayoutChangeEvent, Platform, Pressable, StyleSheet, Text, TVFocusGuideView, useWindowDimensions, View } from "react-native";
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
}: LibraryGridProps) {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { width: windowWidth } = useWindowDimensions();
  const backdrop = usePosterBackdropDispatch();
  const isInsideFolder = variant === "folder";

  // Connection recovery runs in the background after a network-classified load
  // failure; while it is looking for the server the error state shows progress
  // instead of dead-end actions. A recovered connection refreshes the load via
  // the auth-change subscription, which clears `error` and leaves this branch.
  const [recoveryStatus, setRecoveryStatus] = useState<RecoveryStatus>(getRecoveryStatus());
  useEffect(() => subscribeRecoveryStatus(setRecoveryStatus), []);

  // Switching servers from the error state is an explicit choice to leave this
  // server, so no extra confirmation. Sign-out flips isConnected and the
  // Library root swaps to the connect screen; navigate home so a pushed folder
  // route doesn't linger on a dead grid.
  const handleSwitchServer = useCallback(async () => {
    await signOut();
    router.navigate("/");
  }, [router]);

  // Handle of the header's Filters button, so pressing Up from a top-row card jumps straight to it
  // (deterministic nextFocusUp, not the fragile geometry/guide redirect). The header sets the node
  // via onFiltersButtonRef once it mounts.
  const [filtersButtonHandle, setFiltersButtonHandle] = useState<number | undefined>(undefined);
  const handleFiltersButtonRef = useCallback((node: View | null) => setFiltersButtonHandle(getNativeHandle(node)), []);

  // First grid card's native node (TV folder variant only), for the post-load focus handoff.
  const cell0Ref = useRef<View | null>(null);
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

  // The +80 clears the tvOS top tab bar; the phone bar sits at the bottom, so the
  // phone list starts right under the status bar inset. Left/right insets keep the
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
      paddingTop: Platform.isTV ? 20 + insets.top + 80 : 8 + insets.top,
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
      const firstCardFocus = index === 0;
      // Stable ref object — not in the deps, doesn't re-render memoized cards (refs aren't props
      // to arePropsEqual). Only the handoff target card gets it.
      const cardRef = IS_TV && isInsideFolder && firstCardFocus ? cell0Ref : undefined;
      if (isFolder(item)) {
        return (
          <FolderGridItem
            ref={cardRef}
            folder={item}
            onPress={onItemPress}
            index={index}
            onItemFocus={handleItemFocus}
            hasTVPreferredFocus={firstCardFocus}
            nextFocusUp={nextFocusUp}
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
          hasTVPreferredFocus={firstCardFocus}
          nextFocusUp={nextFocusUp}
          slotOrientation={slotOrientation}
          numColumns={numColumns}
        />
      );
    },
    [onItemPress, slotOrientation, handleItemFocus, onItemLongPress, isInsideFolder, numColumns, filtersButtonHandle],
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

  // Two-phase focus handoff. Removing the FOCUSED holder in the SAME commit that first mounts the
  // grid made the focus engine race the native layout of 15 fresh cells; when it lost, focus sat
  // nowhere until some unrelated later event (header onLayout, filtersButtonHandle update,
  // favorites re-annotation) happened to trigger another focus pass — the "content shown, focus
  // arrives much later" bug. Instead the holder SURVIVES that commit (it's invisible and already
  // holds focus, so nothing is racy), and this post-commit effect — by which point Fabric has
  // mounted and laid out the cells — explicitly hands focus to the first card, then unmounts the
  // holder (now a non-focused view, whose removal UIKit ignores).
  useEffect(() => {
    if (!IS_TV || !isInsideFolder || handoffDoneRef.current || isLoading) return;
    if (items.length > 0) {
      const tvNode = cell0Ref.current as unknown as { requestTVFocus?: () => void } | null;
      tvNode?.requestTVFocus?.();
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
  }, [isLoading, items.length, isInsideFolder, onOpenFilters, error]);

  // On tvOS the focus engine must always have a target, and the outer trapFocusUp keeps it on the
  // screen. During the initial folder load nothing focusable is rendered — the header (and its
  // focusable Filters CTA) waits for the content, because an early Filters button would claim
  // focus before the first card exists and keep it. The invisible holder anchors focus through
  // that window and through the commit that mounts the grid; the handoff effect above then moves
  // focus onto the first card and dismisses it. Rendered as a stable sibling of {inner} (NOT
  // inside renderEmpty) so the loading→loaded branch switch never remounts it — a remount would
  // re-fire its hasTVPreferredFocus and race the cards. Root never bounces (bottom of the stack),
  // so it gets no holder.
  const focusHolder = useMemo(
    () =>
      IS_TV && isInsideFolder && holderActive ? (
        <Pressable isTVSelectable hasTVPreferredFocus onPress={() => {}} style={styles.focusHolder} accessibilityElementsHidden importantForAccessibility="no-hide-descendants" />
      ) : null,
    [isInsideFolder, holderActive],
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
        // control when there is no card to take it.
        filtersButtonHasPreferredFocus={items.length === 0}
      />
    ) : null;

  const grid = (
    <FlatList
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
    ) : IS_TV ? (
      // Root on TV: same top scrim the folder header uses, so content that
      // scrolls up (e.g. when the Continue Watching row takes focus) fades
      // under the translucent top tab bar instead of colliding with it.
      <View style={styles.container}>
        {grid}
        {/* Longer fade than the shared default: this grid already pads its
            content to insets.top + 100, so the extra 70 lands on the posters
            rather than on a card that starts at the top. */}
        <TopScrim height={insets.top + 170} />
      </View>
    ) : (
      grid
    );

  return (
    <View style={styles.container}>
      <AmbientBackground dynamic />
      {/* Inside a folder: trapFocusUp keeps Up from the top row from escaping to the native tab bar
          (which would pop the nested Stack). No autoFocus/destinations — the pinned Filters bar is an
          always-mounted sibling reached deterministically via nextFocusUp from the top row, so the
          focus environment never depends on guide recovery (unreliable on Fabric/tvOS after first use).
          Root keeps normal Up-to-tab-bar behavior for switching tabs. */}
      {isInsideFolder && IS_TV ? (
        <TVFocusGuideView style={styles.container} trapFocusUp>
          {inner}
          {focusHolder}
        </TVFocusGuideView>
      ) : (
        inner
      )}
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
