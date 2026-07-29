import { AmbientBackground } from "@/components/ambient-background";
import { FocusableButton } from "@/components/FocusableButton";
import { VideoGridItem } from "@/components/video-grid-item";
import { CARD_FOCUS, DESIGN, GRID, slotColumns, slotRatio, type SlotOrientation } from "@/constants/app";
import { useLibrary } from "@/contexts/LibraryContext";
import { useLoading } from "@/contexts/LoadingContext";
import { useColorScheme } from "@/hooks/use-color-scheme";
import { connectToDemoServer, getPosterUrl, searchVideos } from "@/services/jellyfinApi";
import { JellyfinVideoItem } from "@/types/jellyfin";
import { logger } from "@/utils/logger";
import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect, useRouter } from "expo-router";
import { isNativeSearchAvailable, SearchResult, TvosSearchView } from "expo-tvos-search";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Alert, findNodeHandle, FlatList, Platform, StyleSheet, Text, TextInput, TVEventControl, View } from "react-native";

/**
 * Gets the native node handle for TV focus management.
 * Note: findNodeHandle is deprecated in React Native for the Fabric architecture,
 * but there's no replacement for TV focus management (nextFocusUp/nextFocusDown)
 * in react-native-tvos yet. This wrapper makes migration easier when an alternative
 * is available.
 */
function getNativeHandle<T>(node: T | null): number | undefined {
  if (!node || !Platform.isTV) return undefined;

  const handle = findNodeHandle(node as unknown as React.Component);
  return handle ?? undefined;
}

interface SearchHeaderProps {
  onChangeText: (text: string) => void;
  onSubmitEditing: () => void;
  inputRef: React.RefCallback<TextInput> | React.RefObject<TextInput>;
  nextFocusDown?: number;
}

const SearchHeader = React.memo(
  function SearchHeader({ onChangeText, onSubmitEditing, inputRef, nextFocusDown }: SearchHeaderProps) {
    const [isInputFocused, setIsInputFocused] = useState(false);

    return (
      <View style={styles.searchContainer}>
        <View style={[styles.searchInputWrapper, isInputFocused && styles.searchInputWrapperFocused]}>
          <TextInput
            ref={inputRef}
            placeholder="Search by title, path, or year (e.g. action 2023)"
            placeholderTextColor="#98989D"
            accessibilityLabel="Search"
            autoCorrect={false}
            autoCapitalize="none"
            onChangeText={onChangeText}
            onFocus={() => setIsInputFocused(true)}
            onBlur={() => setIsInputFocused(false)}
            onSubmitEditing={onSubmitEditing}
            style={styles.searchInput}
            multiline={false}
            numberOfLines={1}
            returnKeyType="search"
            nextFocusDown={nextFocusDown}
          />
        </View>
      </View>
    );
  },
  (prevProps, nextProps) => {
    return prevProps.onChangeText === nextProps.onChangeText && prevProps.onSubmitEditing === nextProps.onSubmitEditing && prevProps.nextFocusDown === nextProps.nextFocusDown;
  },
);

const CARD_MARGIN = 32;

// Usable width inside the native grid at 1920pt. The library hardcodes
// .padding(.horizontal, 60) on its grid, and tvOS adds its own overscan safe area
// inside the hosting controller that JS can't measure. Measured empirically from
// the rendered grid: cards sat on a ~336pt pitch at columns=5 / cardMargin=40,
// so 5 x 296 + 4 x 40 = 1640. Nudge this if cards overflow or leave a gutter.
const NATIVE_GRID_WIDTH = 1640;

function NativeSearchScreen() {
  const router = useRouter();
  const { showGlobalLoader } = useLoading();
  const colorScheme = useColorScheme();
  const searchTextColor = colorScheme === "light" ? "#FFFFFF" : undefined;
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const searchDelayRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleSearch = useCallback((event: { nativeEvent: { query: string } }) => {
    const query = event.nativeEvent.query;

    if (searchDelayRef.current) {
      clearTimeout(searchDelayRef.current);
    }

    if (query.trim().length < 2) {
      setSearchResults([]);
      setIsSearching(false);
      return;
    }

    setIsSearching(true);
    searchDelayRef.current = setTimeout(async () => {
      try {
        const { items } = await searchVideos(query.trim(), { limit: 60 });
        setSearchResults(
          items.map((item) => ({
            id: item.Id,
            title: item.Name,
            subtitle: item.PremiereDate ? new Date(item.PremiereDate).getFullYear().toString() : undefined,
            imageUrl: getPosterUrl(item.Id, 300),
            // Drives both the grid's orientation vote and each card's own shape.
            // Episode/music-video thumbs are 16:9, movie posters 2:3, album art 1:1.
            aspectRatio: item.PrimaryImageAspectRatio,
          })),
        );
      } catch (error) {
        logger.error("Search failed", error, { service: "NativeSearchScreen", query: query.trim() });
        setSearchResults([]);
        // Show alert for connection errors so user knows something went wrong
        const message = error instanceof Error ? error.message : "Unable to search. Please check your connection.";
        if (message.includes("not configured") || message.includes("network") || message.includes("timeout")) {
          Alert.alert("Search Error", message);
        }
      } finally {
        setIsSearching(false);
      }
    }, 300);
  }, []);

  const handleSelectItem = useCallback(
    (event: { nativeEvent: { id: string } }) => {
      const videoId = event.nativeEvent.id;
      const video = searchResults.find((r) => r.id === videoId);
      showGlobalLoader();
      router.push({
        pathname: "/player" as const,
        params: { videoId, videoName: video?.title ?? "Video" },
      });
    },
    [router, showGlobalLoader, searchResults],
  );

  // Fallback handlers for tvOS keyboard input
  // The library attempts to disable RN gesture handlers automatically,
  // but if that doesn't work, these callbacks provide a JS-based fallback
  const handleSearchFieldFocused = useCallback(() => {
    if (TVEventControl?.disableGestureHandlersCancelTouches) {
      TVEventControl.disableGestureHandlersCancelTouches();
      logger.debug("TVEventControl: disabled gesture handlers (search field focused)", { service: "NativeSearchScreen" });
    }
  }, []);

  const handleSearchFieldBlurred = useCallback(() => {
    if (TVEventControl?.enableGestureHandlersCancelTouches) {
      TVEventControl.enableGestureHandlersCancelTouches();
      logger.debug("TVEventControl: enabled gesture handlers (search field blurred)", { service: "NativeSearchScreen" });
    }
  }, []);

  // Safety net: when search screen regains focus (e.g., after modal dismissal),
  // ensure TVEventControl gesture handlers are in their default enabled state.
  useFocusEffect(
    useCallback(() => {
      if (TVEventControl?.enableGestureHandlersCancelTouches) {
        TVEventControl.enableGestureHandlersCancelTouches();
      }
    }, []),
  );

  // Majority orientation sets the grid: column count, cell size, focus geometry.
  // Individual cards still render in their own orientation (cardSizing="perItem").
  //
  // Uses `> 1`, not the `>= 1` of ReactNativeSearchScreen/LibraryGrid: square album
  // art is not landscape, and the card sizing below puts squares in the portrait
  // bucket. If the vote counted them as landscape the two would disagree and a
  // square-heavy library would get narrow portrait cards in wide landscape cells.
  const slotOrientation = useMemo<SlotOrientation>(() => {
    const rated = searchResults.filter((r) => r.aspectRatio != null);
    if (rated.length === 0) return "portrait";
    const landscape = rated.filter((r) => (r.aspectRatio as number) > 1).length;
    return landscape > rated.length / 2 ? "landscape" : "portrait";
  }, [searchResults]);

  // The native card size is fixed in points, so it has to be derived rather than
  // flexed. Cards sit centered in their grid column, so rounding down is invisible.
  const grid = useMemo(() => {
    const columns = slotColumns(slotOrientation, true);
    const columnWidth = (NATIVE_GRID_WIDTH - CARD_MARGIN * (columns - 1)) / columns;
    const cardWidth = Math.floor(columnWidth);
    return { columns, cardWidth, cardHeight: Math.round(cardWidth / slotRatio(slotOrientation)) };
  }, [slotOrientation]);

  return (
    <TvosSearchView
      results={searchResults}
      columns={grid.columns}
      cardWidth={grid.cardWidth}
      cardHeight={grid.cardHeight}
      cardMargin={CARD_MARGIN}
      placeholder="Search library"
      emptyStateText="Find by title, season, or year..."
      isLoading={isSearching}
      topInset={140}
      colorScheme="dark"
      textColor={searchTextColor}
      accentColor={searchTextColor}

      // Each card takes its own image's orientation: landscape images get a
      // landscape card, everything else (including square album art) a portrait
      // one. The grid cell stays uniform, so columns and focus are unaffected —
      // an off-orientation card just draws smaller, centered in its cell.
      cardSizing="perItem"
      landscapeCardRatio={GRID.LANDSCAPE_RATIO}
      portraitCardRatio={GRID.PORTRAIT_RATIO}
      // The card now matches the image's orientation, so fill is correct and
      // there is no letterboxing to avoid. "adaptive" would re-introduce the
      // top-banding it was added to prevent.
      imageContentMode="fill"

      // Card styling mirrors VideoGridItem so native search results and the
      // JS grids read as the same component. Tokens come from CARD_FOCUS/DESIGN
      // rather than being duplicated here.
      cardCornerRadius={DESIGN.BORDER_RADIUS_CARD}
      cardBackgroundColor="#2C2C2E"
      borderWidth={CARD_FOCUS.BORDER_WIDTH}
      // Hex equivalent of CARD_FOCUS.BORDER_COLOR — the native side parses hex, not rgba()
      borderColor="#26FFFFFF"

      // Apple's card lift/parallax would sit on top of the border and glow
      focusStyle="custom"
      showFocusBorder
      focusBorderWidth={CARD_FOCUS.BORDER_WIDTH_FOCUSED}
      focusGlowColor={CARD_FOCUS.GLOW_COLOR}
      focusGlowOpacity={CARD_FOCUS.GLOW_OPACITY}
      focusGlowRadius={CARD_FOCUS.GLOW_RADIUS.tv}

      // Title sliver: dark blur at rest, solid gold with warm-brown text on focus
      overlayHeight={46}
      overlayTitleSize={22}
      overlayTitleWeight="bold"
      overlayTextColor="#FFFFFF"
      overlayBackgroundColorFocused={CARD_FOCUS.TITLE_BG_FOCUSED}
      overlayTextColorFocused={CARD_FOCUS.TITLE_TEXT_FOCUSED}

      marqueeDelay={0.3}
      marqueeSpeed={60}
      marqueeMode="bounce"

      onSearch={handleSearch}
      onSelectItem={handleSelectItem}
      onSearchFieldFocused={handleSearchFieldFocused}
      onSearchFieldBlurred={handleSearchFieldBlurred}
      style={styles.nativeSearchView}
    />
  );
}

function ReactNativeSearchScreen() {
  const router = useRouter();
  const { showGlobalLoader, hideGlobalLoader } = useLoading();
  const { refreshLibrary, isLoading, error } = useLibrary();
  const [searchResults, setSearchResults] = useState<JellyfinVideoItem[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [activeQuery, setActiveQuery] = useState("");
  const [isSearching, setIsSearching] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [hasMoreResults, setHasMoreResults] = useState(false);
  const [firstResultHandle, setFirstResultHandle] = useState<number | undefined>(undefined);
  const [isConnectingToDemo, setIsConnectingToDemo] = useState(false);
  const searchInputRef = useRef<TextInput>(null);
  const searchDelayRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const nextStartIndexRef = useRef(0);
  const firstResultNodeRef = useRef<View | null>(null);
  const firstResultRef = useCallback((node: View | null) => {
    firstResultNodeRef.current = node;
    const handle = getNativeHandle(node);
    setFirstResultHandle(handle);
  }, []);

  const handleVideoPress = useCallback(
    (video: JellyfinVideoItem) => {
      showGlobalLoader();
      router.push({
        pathname: "/player" as const,
        params: { videoId: video.Id, videoName: video.Name },
      });
    },
    [router, showGlobalLoader],
  );

  const focusFirstResult = useCallback(() => {
    if (Platform.isTV && firstResultNodeRef.current) {
      // Cast to access TV-specific focus method
      const tvNode = firstResultNodeRef.current as unknown as { requestTVFocus?: () => void };
      tvNode.requestTVFocus?.();
    }
  }, []);

  useEffect(() => {
    if (isLoading && searchError) {
      // Guarded one-shot reset when a fresh load starts; not a render cascade.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setSearchError(null);
    }
  }, [isLoading, searchError]);

  const executeSearch = useCallback(async (term: string, append: boolean = false) => {
    const trimmed = term.trim();
    if (!trimmed) return;

    if (append) {
      setIsLoadingMore(true);
    } else {
      setIsSearching(true);
      setSearchError(null);
      nextStartIndexRef.current = 0;
      setHasMoreResults(false);
    }

    try {
      const startIndex = append ? nextStartIndexRef.current : 0;
      const pageSize = 60;
      const { items, total } = await searchVideos(trimmed, { limit: pageSize, startIndex });

      if (append) {
        setSearchResults((prev) => {
          const newResults = [...prev, ...items];
          setHasMoreResults(total !== undefined && newResults.length < total);
          return newResults;
        });
      } else {
        setSearchResults(items);
        setHasMoreResults(total !== undefined && items.length < total);
      }
      nextStartIndexRef.current = startIndex + items.length;
      setActiveQuery(trimmed);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unable to search. Please try again.";
      setSearchError(message);
      if (!append) setSearchResults([]);
    } finally {
      if (append) {
        setIsLoadingMore(false);
      } else {
        setIsSearching(false);
      }
    }
  }, []);

  const handleRetrySearch = useCallback(() => {
    if (searchQuery.trim().length >= 2) {
      executeSearch(searchQuery.trim());
    }
  }, [searchQuery, executeSearch]);

  const handleLoadMore = useCallback(() => {
    if (hasMoreResults && !isLoadingMore && !isSearching && activeQuery) {
      executeSearch(activeQuery, true);
    }
  }, [hasMoreResults, isLoadingMore, isSearching, activeQuery, executeSearch]);

  const handleTryDemo = useCallback(async () => {
    if (isConnectingToDemo) return; // Prevent double-click

    setIsConnectingToDemo(true);
    let connected = false;

    try {
      showGlobalLoader();
      await connectToDemoServer();
      connected = true;

      await refreshLibrary();

      hideGlobalLoader();

      Alert.alert("Demo Server Connected", "You're now browsing Jellyfin's demo library. You can switch to your own server in Settings.", [{ text: "OK" }]);
    } catch (error) {
      hideGlobalLoader();

      if (connected) {
        // Connection succeeded but refresh failed
        Alert.alert("Connected to Demo", "Connected to demo server, but couldn't load the library. Please check your internet connection and try navigating again.", [{ text: "OK" }]);
      } else {
        // Connection failed
        Alert.alert("Connection Failed", error instanceof Error ? error.message : "Unable to connect to demo server", [{ text: "OK" }]);
      }
    } finally {
      setIsConnectingToDemo(false);
    }
  }, [isConnectingToDemo, showGlobalLoader, hideGlobalLoader, refreshLibrary]);

  useEffect(() => {
    if (searchDelayRef.current) {
      clearTimeout(searchDelayRef.current);
    }

    const trimmed = searchQuery.trim();
    if (trimmed.length < 2) {
      // Guarded reset when the query is cleared; not a render cascade.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setSearchResults([]);
      setSearchError(null);
      setIsSearching(false);
      return;
    }

    searchDelayRef.current = setTimeout(() => executeSearch(trimmed), 300);
    return () => {
      if (searchDelayRef.current) clearTimeout(searchDelayRef.current);
    };
  }, [searchQuery, executeSearch]);

  const hasSearchQuery = searchQuery.trim().length >= 2;
  const shouldShowResults = hasSearchQuery && searchResults.length > 0;

  const slotOrientation = useMemo<SlotOrientation>(() => {
    const rated = searchResults.filter((i) => i.PrimaryImageAspectRatio != null);
    if (rated.length === 0) return "portrait";
    const landscape = rated.filter((i) => (i.PrimaryImageAspectRatio as number) >= 1).length;
    return landscape > rated.length / 2 ? "landscape" : "portrait";
  }, [searchResults]);

  const numColumns = useMemo(() => slotColumns(slotOrientation, Platform.isTV), [slotOrientation]);

  const itemDimensions = useMemo(() => {
    const screenWidth = Platform.isTV ? 1080 : 400;
    const itemWidth = screenWidth / numColumns;
    const itemHeight = itemWidth / slotRatio(slotOrientation) + 40;
    return { itemHeight };
  }, [numColumns, slotOrientation]);

  const getItemLayout = useCallback(
    (_: ArrayLike<JellyfinVideoItem> | null | undefined, index: number) => {
      const rowPadding = (Platform.isTV ? 24 : 12) * 2; // columnWrapper paddingVertical (top + bottom)
      const rowHeight = itemDimensions.itemHeight + rowPadding;
      return {
        length: rowHeight,
        offset: rowHeight * Math.floor(index / numColumns),
        index,
      };
    },
    [itemDimensions, numColumns],
  );

  const [searchInputHandle, setSearchInputHandle] = useState<number | undefined>(undefined);

  const searchInputCallbackRef = useCallback((node: TextInput | null) => {
    setSearchInputHandle(getNativeHandle(node));
    // Assign to ref for imperative access
    searchInputRef.current = node;
  }, []);

  const renderItem = useCallback(
    ({ item, index }: { item: JellyfinVideoItem; index: number }) => {
      const isFirstRow = index < numColumns;
      return (
        <VideoGridItem
          ref={index === 0 ? firstResultRef : undefined}
          video={item}
          onPress={handleVideoPress}
          index={index}
          hasTVPreferredFocus={index === 0 && shouldShowResults}
          nextFocusUp={isFirstRow ? searchInputHandle : undefined}
          slotOrientation={slotOrientation}
        />
      );
    },
    [handleVideoPress, shouldShowResults, numColumns, searchInputHandle, firstResultRef, slotOrientation],
  );

  const renderFooter = useCallback(() => {
    if (isLoadingMore) {
      return (
        <View style={styles.footerLoading}>
          <ActivityIndicator size="small" color="#FFC312" />
          <Text style={styles.footerLoadingText}>Loading more...</Text>
        </View>
      );
    }
    return (
      <Text style={styles.resultsLabel}>
        {searchResults.length} {searchResults.length === 1 ? "result" : "results"}
      </Text>
    );
  }, [isLoadingMore, searchResults.length]);

  const renderEmpty = useCallback(() => {
    if (hasSearchQuery) {
      if (isSearching) {
        return (
          <View style={styles.centerContainer}>
            <ActivityIndicator size="small" color="#FFC312" />
            <Text style={styles.loadingText}>Searching...</Text>
          </View>
        );
      }
      if (searchError) {
        return (
          <View style={styles.centerContainer}>
            <Ionicons name="alert-circle-outline" size={64} color="#FF3B30" />
            <Text style={styles.errorTitle}>Search Failed</Text>
            <Text style={styles.errorText}>{searchError}</Text>
            <FocusableButton title="Try Again" variant="retry" onPress={handleRetrySearch} hasTVPreferredFocus />
          </View>
        );
      }
      return (
        <View style={styles.centerContainer}>
          <Ionicons name="search-outline" size={64} color="#98989D" />
          <Text style={styles.emptyText}>No results for &quot;{searchQuery}&quot;</Text>
        </View>
      );
    }

    if (isLoading) {
      return (
        <View style={styles.centerContainer}>
          <ActivityIndicator size="small" color="#FFC312" />
          <Text style={styles.loadingText}>Loading...</Text>
        </View>
      );
    }

    if (error) {
      return (
        <View style={styles.centerContainer}>
          <Ionicons name="alert-circle-outline" size={64} color="#FF3B30" />
          <Text style={styles.errorTitle}>Unable to Load</Text>
          <Text style={styles.errorText}>{error}</Text>

          <View style={styles.buttonGroup}>
            <FocusableButton
              title="Try Demo Server"
              variant="secondary"
              onPress={handleTryDemo}
              disabled={isConnectingToDemo}
              icon={<Ionicons name="play-circle-outline" size={Platform.isTV ? 24 : 20} color="#FFC312" />}
              hasTVPreferredFocus={true}
            />
            <FocusableButton
              title="Go to Settings"
              variant="primary"
              onPress={() => router.push("/(tabs)/settings")}
              icon={<Ionicons name="settings-outline" size={Platform.isTV ? 24 : 20} color="#000000" />}
            />
          </View>
        </View>
      );
    }

    return (
      <View style={styles.centerContainer}>
        <Ionicons name="search-outline" size={64} color="#98989D" />
        <Text style={styles.emptyText}>Search by title, path, or year</Text>
      </View>
    );
  }, [hasSearchQuery, isSearching, searchError, searchQuery, isLoading, error, isConnectingToDemo, router, handleRetrySearch, handleTryDemo]);

  const handleSubmitEditing = useCallback(() => {
    if (shouldShowResults) {
      focusFirstResult();
    }
  }, [shouldShowResults, focusFirstResult]);

  const headerComponent = useMemo(
    () => <SearchHeader onChangeText={setSearchQuery} onSubmitEditing={handleSubmitEditing} inputRef={searchInputCallbackRef} nextFocusDown={firstResultHandle} />,
    [handleSubmitEditing, searchInputCallbackRef, firstResultHandle],
  );

  return (
    <View style={styles.container}>
      <AmbientBackground />
      {headerComponent}

      {shouldShowResults ? (
        <FlatList
          data={searchResults}
          renderItem={renderItem}
          keyExtractor={(item) => item.Id}
          getItemLayout={getItemLayout}
          numColumns={numColumns}
          key={numColumns}
          contentContainerStyle={styles.gridContent}
          columnWrapperStyle={styles.columnWrapper}
          showsVerticalScrollIndicator
          initialNumToRender={10}
          maxToRenderPerBatch={10}
          windowSize={3}
          removeClippedSubviews={!Platform.isTV}
          onEndReached={handleLoadMore}
          onEndReachedThreshold={0.5}
          ListFooterComponent={renderFooter}
        />
      ) : (
        <View style={styles.emptyContainer}>{renderEmpty()}</View>
      )}
    </View>
  );
}

export default function SearchScreen() {
  if (isNativeSearchAvailable()) {
    return <NativeSearchScreen />;
  }
  return <ReactNativeSearchScreen />;
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  nativeSearchView: {
    flex: 1,
    // Native tvOS search is an opaque native view; glows can't render behind it.
    // Match the ambient canvas base color for consistency.
    backgroundColor: "#141414",
  },
  emptyContainer: {
    flex: 1,
  },
  searchContainer: {
    paddingTop: Platform.isTV ? 150 : 60,
    paddingHorizontal: Platform.isTV ? 80 : 16,
    paddingBottom: Platform.isTV ? 24 : 16,
    alignItems: "center",
  },
  searchInputWrapper: {
    width: "100%",
    maxWidth: 800,
    borderRadius: Platform.isTV ? 28 : 25,
    overflow: "hidden",
    borderWidth: 2,
    borderColor: "#3A3A3C",
  },
  searchInputWrapperFocused: {
    borderColor: "#FFC312",
  },
  searchInput: {
    width: "100%",
    minHeight: Platform.isTV ? 56 : 50,
    backgroundColor: "#2C2C2E",
    paddingHorizontal: Platform.isTV ? 28 : 20,
    fontSize: Platform.isTV ? 28 : 20,
    color: "#FFFFFF",
  },
  gridContent: {
    paddingBottom: Platform.isTV ? 120 : 100,
    paddingHorizontal: Platform.isTV ? 40 : 16,
  },
  columnWrapper: {
    justifyContent: "flex-start",
    paddingVertical: Platform.isTV ? 24 : 12,
  },
  centerContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: 40,
  },
  loadingText: {
    marginTop: 24,
    fontSize: Platform.isTV ? 20 : 16,
    color: "#98989D",
    fontWeight: "500",
  },
  errorTitle: {
    marginTop: 16,
    fontSize: Platform.isTV ? 24 : 20,
    fontWeight: "700",
    color: "#FFFFFF",
  },
  errorText: {
    marginTop: 8,
    fontSize: Platform.isTV ? 18 : 15,
    color: "#98989D",
    textAlign: "center",
    lineHeight: 24,
  },
  emptyText: {
    marginTop: 16,
    fontSize: Platform.isTV ? 20 : 16,
    color: "#98989D",
    textAlign: "center",
  },
  resultsLabel: {
    marginTop: -8,
    marginLeft: 16,
    fontSize: Platform.isTV ? 16 : 13,
    color: "#98989D",
  },
  footerLoading: {
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
    paddingVertical: 20,
    gap: 12,
  },
  footerLoadingText: {
    fontSize: Platform.isTV ? 18 : 15,
    color: "#98989D",
  },
  buttonGroup: {
    gap: Platform.isTV ? 16 : 12,
    marginTop: Platform.isTV ? 32 : 24,
    width: "100%",
    maxWidth: 400,
    alignItems: "center",
  },
});
