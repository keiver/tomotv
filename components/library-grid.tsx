import { AmbientBackground } from "@/components/ambient-background";
import { ContinueWatchingRow } from "@/components/continue-watching-row";
import { FocusableButton } from "@/components/FocusableButton";
import { FolderGridItem } from "@/components/folder-grid-item";
import { LibraryHeader } from "@/components/library-header";
import { VideoGridItem } from "@/components/video-grid-item";
import { GRID, slotColumns, type SlotOrientation } from "@/constants/app";
import { usePosterBackdropDispatch } from "@/contexts/PosterBackdropContext";
import { isFolder } from "@/services/jellyfinApi";
import { FolderStackEntry, JellyfinItem } from "@/types/jellyfin";
import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { useFocusEffect, useRouter } from "expo-router";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  findNodeHandle,
  FlatList,
  LayoutChangeEvent,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TouchableOpacity,
  TVEventHandler,
  TVFocusGuideView,
  useWindowDimensions,
  View,
} from "react-native";
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
  /** Go up one level — wired to the touch back row; on TV the grid's Menu-key handler calls it. */
  onBack?: () => void;
  /** Opens the Filters panel. Renders the header Filters button only when provided ("folder" variant). */
  onOpenFilters?: () => void;
  /** Number of active filter selections, shown on the Filters button. */
  activeFilterCount?: number;
  /** Long-press on a video card (folder variant) — e.g. the favorite toggle menu. */
  onItemLongPress?: (item: JellyfinItem) => void;
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
}: LibraryGridProps) {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { width: windowWidth } = useWindowDimensions();
  const backdrop = usePosterBackdropDispatch();
  const isInsideFolder = variant === "folder";

  // Handle of the header's Filters button, so pressing Up from a top-row card jumps straight to it
  // (deterministic nextFocusUp, not the fragile geometry/guide redirect). The header sets the node
  // via onFiltersButtonRef once it mounts.
  const [filtersButtonHandle, setFiltersButtonHandle] = useState<number | undefined>(undefined);
  const handleFiltersButtonRef = useCallback((node: View | null) => setFiltersButtonHandle(getNativeHandle(node)), []);

  // Menu-key "back to top" (folder variant, TV): where focus currently sits in the grid. The
  // Filters button counts as the top (index 0) — from the top, Menu pops the screen; anywhere
  // deeper it rewinds the grid first (see the useFocusEffect below).
  const focusedIndexRef = useRef(0);
  const firstCardRef = useRef<React.ElementRef<typeof TouchableOpacity> | null>(null);
  const flatListRef = useRef<FlatList<JellyfinItem>>(null);
  const refocusTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const itemCountRef = useRef(items.length);
  const onBackRef = useRef(onBack);
  useEffect(() => {
    itemCountRef.current = items.length;
    onBackRef.current = onBack;
  }, [items.length, onBack]);

  // Intercept the remote's Menu/back key while a folder screen is focused. Below the first item,
  // a press rewinds the grid (animated scroll to top + focus the first card) instead of popping;
  // from the top (first card or Filters button) it pops via onBack. Verified mechanics
  // (RCTTVRemoteHandler.m + BackHandler.ios.js): enableTVMenuKey attaches a gesture recognizer
  // that consumes the press before UIKit, so the native UINavigationController never pops, and
  // the tvOS BackHandler default action is a no-op — the handler must therefore drive the pop
  // itself and return true; returning false would swallow the press entirely.
  // useFocusEffect scopes the interception to the focused screen: pushing Filters/player/photo
  // viewer or switching tabs runs the cleanup and restores native Menu behavior everywhere else.
  useFocusEffect(
    useCallback(() => {
      if (!IS_TV || !isInsideFolder) return;
      const onMenuPress = () => {
        if (itemCountRef.current > 0 && focusedIndexRef.current > 0) {
          flatListRef.current?.scrollToOffset({ offset: 0, animated: true });
          // Best-effort refocus of the still-mounted first card after the scroll animation.
          // The delay is a heuristic, not a guarantee: if it fires too early the focus call
          // simply lands where it lands, focusedIndexRef stays > 0, and the next Menu press
          // repeats the rewind. A virtualized-out first card doesn't need it at all — it
          // grabs focus on remount via mount-time hasTVPreferredFocus.
          if (refocusTimerRef.current) clearTimeout(refocusTimerRef.current);
          refocusTimerRef.current = setTimeout(() => {
            (firstCardRef.current as unknown as { requestTVFocus?: () => void } | null)?.requestTVFocus?.();
          }, 450);
          return true;
        }
        onBackRef.current?.();
        return true;
      };
      TVEventControl.enableTVMenuKey();
      const subscription = BackHandler.addEventListener("hardwareBackPress", onMenuPress);
      return () => {
        subscription.remove();
        TVEventControl.disableTVMenuKey();
        if (refocusTimerRef.current) clearTimeout(refocusTimerRef.current);
      };
    }, [isInsideFolder]),
  );

  const handleFiltersFocus = useCallback(() => {
    focusedIndexRef.current = 0;
  }, []);

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
  const sidePadding = IS_TV ? GRID.SIDE_PADDING.tv : GRID.SIDE_PADDING.phone;
  const gridContentStyle = useMemo(
    () => ({
      ...styles.gridContent,
      paddingTop: Platform.isTV ? 20 + insets.top + 80 : 8 + insets.top,
      paddingBottom: bottomClearance + insets.bottom,
      paddingLeft: sidePadding + insets.left,
      paddingRight: sidePadding + insets.right,
    }),
    [insets.top, insets.bottom, insets.left, insets.right, sidePadding, bottomClearance],
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
      paddingLeft: sidePadding + insets.left,
      paddingRight: sidePadding + insets.right,
    }),
    [headerHeight, insets.top, insets.bottom, insets.left, insets.right, sidePadding, bottomClearance],
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
      paddingLeft: sidePadding + insets.left,
      paddingRight: Platform.isTV ? 0 : insets.right,
    }),
    [insets.top, insets.left, insets.right, sidePadding],
  );

  // Focus-only (no blur→clear): on tvOS the incoming card's onFocus can fire before the outgoing
  // card's onBlur, so clearing on blur would race and cancel the new poster. Keep the last poster.
  // Also tracks the focused index for the Menu-key back-to-top interception.
  const handleItemFocus = useCallback(
    (item: JellyfinItem, index: number) => {
      focusedIndexRef.current = index;
      backdrop.focus(item);
    },
    [backdrop],
  );

  const renderItem = useCallback(
    ({ item, index }: { item: JellyfinItem; index: number }) => {
      // Top row only: pressing Up jumps to the Filters button. Lower rows keep normal up traversal.
      const nextFocusUp = isInsideFolder && index < numColumns ? filtersButtonHandle : undefined;
      const firstCardFocus = index === 0;
      // The first card's node is kept for the Menu-key rewind (requestTVFocus after scroll-to-top).
      const cardRef = index === 0 ? firstCardRef : undefined;
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

  // On tvOS the focus engine must always have a target, and the outer trapFocusUp keeps it on the
  // screen. During the initial folder load NOTHING visible is rendered but the spinner — the
  // header (and its focusable Filters CTA) waits for the content, because folder content arrives
  // too late and an early Filters button would claim focus before the first card exists and keep
  // it. The invisible holder anchors focus through that window; when content lands, the header and
  // the cards mount together in one commit, the holder unmounts with them, and the focus engine
  // re-resolves onto the first card's mount-time preferred focus — no handoff, no extra frame.
  // The holder also remains the fallback for a folder with no Filters button at all
  // (!onOpenFilters) — without any focusable the engine would bounce up to the tab bar and drop
  // the route. Root never bounces (bottom of the stack), so it gets no holder.
  const focusHolder = useMemo(
    () =>
      IS_TV && isInsideFolder && (!onOpenFilters || isFolderLoading) ? (
        <Pressable isTVSelectable hasTVPreferredFocus onPress={() => {}} style={styles.focusHolder} accessibilityElementsHidden importantForAccessibility="no-hide-descendants" />
      ) : null,
    [isInsideFolder, onOpenFilters, isFolderLoading],
  );

  const renderEmpty = useCallback(() => {
    if (isLoading) {
      return (
        <View style={styles.centerContainer}>
          {focusHolder}
          <ActivityIndicator size="small" color="#FFC312" />
          <Text style={styles.loadingText}>Loading...</Text>
        </View>
      );
    }

    if (error) {
      return (
        <View style={styles.centerContainer}>
          <Ionicons name="alert-circle-outline" size={64} color="#FF3B30" />
          <Text style={styles.errorTitle}>Error</Text>
          <Text style={styles.errorText}>{error}</Text>

          <View style={styles.buttonGroup}>
            <FocusableButton
              title="Configure"
              variant="primary"
              onPress={() => router.push("/(tabs)/settings")}
              icon={<Ionicons name="settings-outline" size={Platform.isTV ? 24 : 20} color="#000000" />}
              hasTVPreferredFocus={true}
            />
          </View>
        </View>
      );
    }

    return (
      <View style={styles.centerContainer}>
        {focusHolder}
        <Ionicons name="folder-open-outline" size={64} color="#98989D" />
        <Text style={styles.emptyText}>{isInsideFolder ? (activeFilterCount > 0 ? "No items match the current filters" : "This folder is empty") : "No libraries found"}</Text>
      </View>
    );
  }, [isLoading, error, router, focusHolder, isInsideFolder, activeFilterCount]);

  // Breadcrumb bar with the Filters suffix action. Rendered in the loaded-empty branch too: a
  // filter selection that matches nothing must still leave the user a way back into the panel.
  // The whole bar waits for the folder content (hidden while isFolderLoading): rendering it early
  // would flicker when the CTA lands and let Filters claim focus before the first card exists.
  const folderHeader =
    isInsideFolder && !isFolderLoading ? (
      <LibraryHeader
        stack={crumbs ?? []}
        onBack={onBack ?? (() => {})}
        onOpenFilters={onOpenFilters}
        activeFilterCount={activeFilterCount}
        onFiltersButtonRef={handleFiltersButtonRef}
        onFiltersFocus={handleFiltersFocus}
        // Loaded-empty only (the bar doesn't render while loading): keeps focus on a visible
        // control when there is no card to take it.
        filtersButtonHasPreferredFocus={items.length === 0}
      />
    ) : null;

  const grid = (
    <FlatList
      ref={flatListRef}
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
      removeClippedSubviews={false}
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
        <LinearGradient
          colors={["#141414", "#141414", "rgba(20, 20, 20, 0.55)", "transparent"]}
          locations={[0, 0.35, 0.7, 1]}
          style={[styles.rootTopScrim, { height: insets.top + 170 }]}
          pointerEvents="none"
        />
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
        </TVFocusGuideView>
      ) : (
        inner
      )}
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
  // Root (TV): fixed-height top scrim over the grid — no header bar here, just
  // the fade that keeps scrolled content from colliding with the top tab bar.
  rootTopScrim: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    zIndex: 10,
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
