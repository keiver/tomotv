import { AmbientBackground } from "@/components/ambient-background";
import { ContinueWatchingRow } from "@/components/continue-watching-row";
import { FavoritesRow } from "@/components/favorites-row";
import { FocusableButton } from "@/components/FocusableButton";
import { FolderGridItem } from "@/components/folder-grid-item";
import { LibraryHeader } from "@/components/library-header";
import { VideoGridItem } from "@/components/video-grid-item";
import { slotColumns, type SlotOrientation } from "@/constants/app";
import { usePosterBackdropDispatch } from "@/contexts/PosterBackdropContext";
import { isFolder, markVideoAsFavorite } from "@/services/jellyfinApi";
import { FolderStackEntry, JellyfinItem } from "@/types/jellyfin";
import { logger } from "@/utils/logger";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import React, { useCallback, useMemo } from "react";
import { ActivityIndicator, Alert, FlatList, Platform, Pressable, StyleSheet, Text, TVFocusGuideView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

const IS_TV = Platform.isTV;

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
}

/**
 * Presentational library/folder grid. Pure UI: it receives items + callbacks and renders the grid,
 * header, and empty/error states. Navigation and data loading live in the route screens that use it.
 * Must be rendered inside a PosterBackdropProvider (it drives the dynamic backdrop on focus).
 */
export function LibraryGrid({ items, isLoading, isLoadingMore, hasMoreResults, error, onItemPress, onLoadMore, variant, crumbs, onBack }: LibraryGridProps) {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const backdrop = usePosterBackdropDispatch();
  const isInsideFolder = variant === "folder";

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

  // Focus-only (no blur→clear): on tvOS the incoming card's onFocus can fire before the outgoing
  // card's onBlur, so clearing on blur would race and cancel the new poster. Keep the last poster.
  const handleItemFocus = useCallback((item: JellyfinItem) => backdrop.focus(item), [backdrop]);

  const handleVideoLongPress = useCallback((item: JellyfinItem) => {
    Alert.alert(item.Name || "Video", undefined, [
      {
        text: "Mark as Favorite",
        onPress: async () => {
          try {
            await markVideoAsFavorite(item.Id);
          } catch (err) {
            logger.warn("Failed to mark video as favorite", err, { service: "LibraryGrid", videoId: item.Id });
          }
        },
      },
      { text: "Cancel", style: "cancel" },
    ]);
  }, []);

  const renderItem = useCallback(
    ({ item, index }: { item: JellyfinItem; index: number }) => {
      if (isFolder(item)) {
        return <FolderGridItem folder={item} onPress={onItemPress} index={index} onItemFocus={handleItemFocus} hasTVPreferredFocus={index === 0} slotOrientation={slotOrientation} />;
      }
      return (
        <VideoGridItem
          video={item}
          onPress={onItemPress}
          onLongPress={handleVideoLongPress}
          index={index}
          onItemFocus={handleItemFocus}
          hasTVPreferredFocus={index === 0}
          slotOrientation={slotOrientation}
        />
      );
    },
    [onItemPress, slotOrientation, handleItemFocus, handleVideoLongPress],
  );

  const renderFooter = useCallback(() => {
    return (
      <>
        {/* Continue Watching sits BELOW the libraries so it can appear/grow without shifting the
            library cards above it (the row renders null when there's nothing to resume). */}
        {variant === "root" && <ContinueWatchingRow />}
        {variant === "root" && <FavoritesRow />}
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

  // On tvOS the focus engine must always have something focusable. A folder route whose content is
  // still loading (or is empty) has no focusable view, so the engine bounces focus up to the tab bar
  // and the route gets dropped. This invisible holder keeps focus on the screen without showing a
  // back control — going up stays the native Menu pop, exactly like a folder that has content. Once
  // items load the grid's first card takes preferred focus and this is gone. Root never bounces (it
  // is the bottom of the stack), so it gets no holder.
  const focusHolder = useMemo(
    () =>
      IS_TV && isInsideFolder ? (
        <Pressable isTVSelectable hasTVPreferredFocus onPress={() => {}} style={styles.focusHolder} accessibilityElementsHidden importantForAccessibility="no-hide-descendants" />
      ) : null,
    [isInsideFolder],
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
              title="Go to Settings"
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
        <Text style={styles.emptyText}>{isInsideFolder ? "This folder is empty" : "No libraries found"}</Text>
      </View>
    );
  }, [isLoading, error, router, focusHolder, isInsideFolder]);

  const inner =
    items.length === 0 ? (
      <View style={[styles.container, { paddingTop: (Platform.isTV ? 20 : 10) + insets.top + 80, paddingLeft: Platform.isTV ? 80 : 60 }]}>
        {isInsideFolder && <LibraryHeader stack={crumbs ?? []} onBack={onBack ?? (() => {})} />}
        {renderEmpty()}
      </View>
    ) : (
      <FlatList
        testID="library-list"
        data={items}
        renderItem={renderItem}
        keyExtractor={(item) => item.Id}
        numColumns={numColumns}
        key={numColumns}
        contentContainerStyle={gridContentStyle}
        columnWrapperStyle={styles.columnWrapper}
        ListHeaderComponent={isInsideFolder ? <LibraryHeader stack={crumbs ?? []} onBack={onBack ?? (() => {})} /> : <Text style={styles.serverHeading}>Libraries</Text>}
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

  return (
    <View style={styles.container}>
      <AmbientBackground dynamic />
      {/* Inside a folder, trap upward focus so pressing Up from the top grid row stays on the screen
          instead of escaping to the native tab bar — focusing the active tab pops the nested Stack
          back to the libraries root. Root keeps normal Up-to-tab-bar behavior for switching tabs. */}
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
    paddingLeft: Platform.isTV ? 80 : 60,
    paddingRight: Platform.isTV ? 40 : 20,
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
    padding: 40,
    paddingLeft: Platform.isTV ? 80 : 60,
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
