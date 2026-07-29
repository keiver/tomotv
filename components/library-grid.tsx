import { AmbientBackground } from "@/components/ambient-background";
import { ContinueWatchingRow } from "@/components/continue-watching-row";
import { FocusableButton } from "@/components/FocusableButton";
import { FolderGridItem } from "@/components/folder-grid-item";
import { LibraryHeader } from "@/components/library-header";
import { VideoGridItem } from "@/components/video-grid-item";
import { slotColumns, type SlotOrientation } from "@/constants/app";
import { usePosterBackdropDispatch } from "@/contexts/PosterBackdropContext";
import { isFolder } from "@/services/jellyfinApi";
import { FolderStackEntry, JellyfinItem } from "@/types/jellyfin";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import React, { useCallback, useMemo, useState } from "react";
import { ActivityIndicator, findNodeHandle, FlatList, Platform, Pressable, StyleSheet, Text, TVFocusGuideView, View } from "react-native";
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
  /** Go up one level — wired to the touch back row. On TV the Menu button handles back natively. */
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
  const backdrop = usePosterBackdropDispatch();
  const isInsideFolder = variant === "folder";

  // Handle of the header's Filters button, so pressing Up from a top-row card jumps straight to it
  // (deterministic nextFocusUp, not the fragile geometry/guide redirect). The header sets the node
  // via onFiltersButtonRef once it mounts.
  const [filtersButtonHandle, setFiltersButtonHandle] = useState<number | undefined>(undefined);
  const handleFiltersButtonRef = useCallback((node: View | null) => setFiltersButtonHandle(getNativeHandle(node)), []);

  // Pick the grid's slot shape from the folder's dominant content orientation.
  const slotOrientation = useMemo<SlotOrientation>(() => {
    const rated = items.filter((i) => i.PrimaryImageAspectRatio != null);
    if (rated.length === 0) return "portrait";
    const landscape = rated.filter((i) => (i.PrimaryImageAspectRatio as number) >= 1).length;
    return landscape > rated.length / 2 ? "landscape" : "portrait";
  }, [items]);

  const numColumns = useMemo(() => slotColumns(slotOrientation, IS_TV), [slotOrientation]);

  const gridContentStyle = useMemo(
    () => ({
      ...styles.gridContent,
      paddingTop: (Platform.isTV ? 20 : 10) + insets.top + 80,
      paddingBottom: TAB_BAR_HEIGHT + insets.bottom + 20,
    }),
    [insets.top, insets.bottom],
  );

  // Folder grid: the Filters/breadcrumb bar is a pinned sibling above the list (it owns the top
  // clearance), so the list itself starts just below it — no +insets.top/+80 here. The columnWrapper's
  // paddingVertical gives the first row its gap.
  const folderGridContentStyle = useMemo(
    () => ({
      ...styles.gridContent,
      paddingBottom: TAB_BAR_HEIGHT + insets.bottom + 20,
    }),
    [insets.bottom],
  );

  // Tight top clearance for the pinned, floating folder header — just enough to clear the top edge,
  // no tall dead space above the Filters button / breadcrumb.
  const folderHeaderWrapStyle = useMemo(
    () => ({
      paddingTop: (Platform.isTV ? 40 : 16) + insets.top,
      paddingLeft: Platform.isTV ? 80 : 60,
    }),
    [insets.top],
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
      if (isFolder(item)) {
        return (
          <FolderGridItem
            folder={item}
            onPress={onItemPress}
            index={index}
            onItemFocus={handleItemFocus}
            hasTVPreferredFocus={index === 0}
            nextFocusUp={nextFocusUp}
            slotOrientation={slotOrientation}
          />
        );
      }
      return (
        <VideoGridItem
          video={item}
          onPress={onItemPress}
          onLongPress={onItemLongPress}
          index={index}
          onItemFocus={handleItemFocus}
          hasTVPreferredFocus={index === 0}
          nextFocusUp={nextFocusUp}
          slotOrientation={slotOrientation}
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

  // On tvOS the focus engine must always have a VISIBLE target. During loading/empty the visible
  // Filters button (rendered in the empty branch below) owns focus, and the outer trapFocusUp keeps
  // focus on the screen — so no invisible holder is needed there. The holder remains ONLY as a
  // fallback for the rare folder with no Filters button (!onOpenFilters): without any focusable the
  // engine would bounce up to the tab bar and drop the route. Root never bounces (bottom of the
  // stack), so it gets no holder either. The holder must never be an alternative to a visible CTA —
  // focus landing on a transparent, non-interactive view reads as "focus lost".
  const focusHolder = useMemo(
    () =>
      IS_TV && isInsideFolder && !onOpenFilters ? (
        <Pressable isTVSelectable hasTVPreferredFocus onPress={() => {}} style={styles.focusHolder} accessibilityElementsHidden importantForAccessibility="no-hide-descendants" />
      ) : null,
    [isInsideFolder, onOpenFilters],
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

  // Breadcrumb bar with the Filters suffix action. Rendered in the empty branch too: a filter
  // selection that matches nothing must still leave the user a way back into the panel.
  const folderHeader = isInsideFolder ? (
    <LibraryHeader
      stack={crumbs ?? []}
      onBack={onBack ?? (() => {})}
      onOpenFilters={onOpenFilters}
      activeFilterCount={activeFilterCount}
      onFiltersButtonRef={handleFiltersButtonRef}
      // Anchor focus on the visible Filters button whenever there is no card to focus — both during
      // the loading spinner and the loaded-empty state — so focus is always on-screen and visible.
      // When items arrive the grid's first card takes preferred focus (a visible, expected move).
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
      removeClippedSubviews={false}
      onEndReached={handleLoadMore}
      onEndReachedThreshold={0.5}
      ListFooterComponent={renderFooter}
    />
  );

  const inner =
    items.length === 0 ? (
      // Same tight top clearance as the loaded header so the Filters button doesn't jump when a
      // folder finishes loading (loading/empty → populated). The wrap is on the HEADER only — at the
      // library root there is no header, and inheriting its padding would push the empty/error block
      // off-center.
      <View style={styles.container}>
        {folderHeader ? <View style={folderHeaderWrapStyle}>{folderHeader}</View> : null}
        {renderEmpty()}
      </View>
    ) : isInsideFolder ? (
      <View style={styles.container}>
        {/* Pinned Filters/breadcrumb bar: a sibling ABOVE the list, always mounted, never scrolls off.
            Up from the top row reaches it via nextFocusUp — the search.tsx pattern that sidesteps the
            native scroll-focus gate (an off-top list header is unfocusable, so it can't be an up-target).
            Transparent (floats over the ambient canvas); tight top clearance, no heavy chrome. */}
        <View style={folderHeaderWrapStyle}>{folderHeader}</View>
        {grid}
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
  gridContent: {
    // Symmetric horizontal padding so the content column is centered under the (OS-centered) tab bar.
    paddingLeft: Platform.isTV ? 80 : 60,
    paddingRight: Platform.isTV ? 80 : 60,
  },
  columnWrapper: {
    justifyContent: "flex-start",
    paddingVertical: 24,
  },
  serverHeading: {
    marginLeft: IS_TV ? 16 : 8,
    marginBottom: IS_TV ? 4 : 2,
    fontSize: IS_TV ? 28 : 18,
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
