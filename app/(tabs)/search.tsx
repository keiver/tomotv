import { AmbientBackground } from "@/components/ambient-background";
import { FocusableButton } from "@/components/FocusableButton";
import { SearchLoadingBar } from "@/components/search-loading-bar";
import { ServerConnectScreen } from "@/components/settings/ServerConnectScreen";
import { SunkenTextInput } from "@/components/sunken-text-input";
import { VideoGridItem } from "@/components/video-grid-item";
import { settingsStyles } from "@/components/settings/styles";
import { CARD_FOCUS, DESIGN, GRID, gridEdgePadding, slotColumns, slotRatio, type SlotOrientation } from "@/constants/app";
import { COLORS } from "@/constants/colors";
import { useAuth } from "@/contexts/AuthContext";
import { useLibrary } from "@/contexts/LibraryContext";
import { useLoadingActions } from "@/contexts/LoadingContext";
import { useColorScheme } from "@/hooks/use-color-scheme";
import { useItemLongPress } from "@/hooks/useItemLongPress";
import { useOpenShelfItem } from "@/hooks/useOpenShelfItem";
import { connectToDemoServer, getPosterUrl, searchVideos } from "@/services/jellyfinApi";
import { JellyfinVideoItem } from "@/types/jellyfin";
import { getLoadErrorMessage } from "@/utils/errorClassification";
import { logger } from "@/utils/logger";
import { cardResumeProgress } from "@/utils/resumeProgress";
import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect, useRouter } from "expo-router";
import { isNativeSearchAvailable, SearchResult, TvosSearchView } from "expo-tvos-search";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Alert, findNodeHandle, FlatList, Platform, StyleSheet, Text, TextInput, TVEventControl, useWindowDimensions, View } from "react-native";

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
  isSearching: boolean;
}

const SearchHeader = React.memo(
  function SearchHeader({ onChangeText, onSubmitEditing, inputRef, nextFocusDown, isSearching }: SearchHeaderProps) {
    const insets = useSafeAreaInsets();

    // Horizontal padding is the shared contentContainer's job now, so the field lands on
    // exactly the column the Settings cards and the logged-out connect form use. The inline
    // phone override contributes only the safe-area inset on top of that — it used to add a
    // second 20pt gutter of its own, which is what made this column disagree with the
    // other tabs.
    return (
      <View style={[styles.searchContainer, !Platform.isTV && { paddingTop: insets.top + 8, paddingLeft: insets.left, paddingRight: insets.right }]}>
        <View style={settingsStyles.contentContainer}>
          {/* Phone: a real header area above the field — the tab needs a title, not a bare input
              floating under the status bar. TV keeps its top-padded input (title would fight the
              top tab bar). */}
          {!Platform.isTV && <Text style={styles.searchTitle}>Search</Text>}
          <SunkenTextInput
            ref={inputRef}
            containerStyle={styles.searchInputWrapper}
            placeholder="Find in your server"
            placeholderTextColor={COLORS.TEXT_SECONDARY}
            accessibilityLabel="Search"
            autoCorrect={false}
            autoCapitalize="none"
            onChangeText={onChangeText}
            onSubmitEditing={onSubmitEditing}
            style={styles.searchInput}
            multiline={false}
            numberOfLines={1}
            returnKeyType="search"
            nextFocusDown={nextFocusDown}>
            <SearchLoadingBar active={isSearching} />
          </SunkenTextInput>
        </View>
      </View>
    );
  },
  (prevProps, nextProps) => {
    return (
      prevProps.onChangeText === nextProps.onChangeText &&
      prevProps.onSubmitEditing === nextProps.onSubmitEditing &&
      prevProps.nextFocusDown === nextProps.nextFocusDown &&
      prevProps.isSearching === nextProps.isSearching
    );
  },
);

/**
 * One slot shape for the whole result set, dominant orientation wins. Same vote
 * as ReactNativeSearchScreen and LibraryGrid, kept on the raw Jellyfin items
 * because PrimaryImageAspectRatio doesn't survive the map to SearchResult.
 */
function dominantOrientation(items: JellyfinVideoItem[]): SlotOrientation {
  const rated = items.filter((i) => i.PrimaryImageAspectRatio != null);
  if (rated.length === 0) return "portrait";
  const landscape = rated.filter((i) => (i.PrimaryImageAspectRatio as number) >= 1).length;
  return landscape > rated.length / 2 ? "landscape" : "portrait";
}

const CARD_MARGIN = 32;

// Usable width inside the native grid at 1920pt. The library hardcodes
// .padding(.horizontal, 60) on its grid, and tvOS adds its own overscan safe area
// inside the hosting controller that JS can't measure. Measured empirically from
// the rendered grid: cards sat on a ~336pt pitch at columns=5 / cardMargin=40,
// so 5 x 296 + 4 x 40 = 1640. Nudge this if cards overflow or leave a gutter.
const NATIVE_GRID_WIDTH = 1640;

function NativeSearchScreen() {
  const openItem = useOpenShelfItem();
  const openInfoPanel = useItemLongPress();
  const colorScheme = useColorScheme();
  const searchTextColor = colorScheme === "light" ? COLORS.TEXT_PRIMARY : undefined;
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [slotOrientation, setSlotOrientation] = useState<SlotOrientation>("portrait");
  const [isSearching, setIsSearching] = useState(false);
  const searchDelayRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // The native list only carries the mapped display shape; the raw items are
  // kept here so a selection can route audio to the audio player.
  const rawItemsRef = useRef<Map<string, JellyfinVideoItem>>(new Map());

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
        rawItemsRef.current = new Map(items.map((item) => [item.Id, item]));
        // Voted from the raw items, before they lose PrimaryImageAspectRatio in the map
        setSlotOrientation(dominantOrientation(items));
        setSearchResults(
          items.map((item) => ({
            id: item.Id,
            title: item.Name,
            subtitle: item.PremiereDate ? new Date(item.PremiereDate).getFullYear().toString() : undefined,
            imageUrl: getPosterUrl(item.Id, 300),
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
      const item = rawItemsRef.current.get(event.nativeEvent.id);
      if (item) openItem(item);
    },
    [openItem],
  );

  const handleLongSelectItem = useCallback(
    (event: { nativeEvent: { id: string } }) => {
      const item = rawItemsRef.current.get(event.nativeEvent.id);
      if (item) openInfoPanel(item);
    },
    [openInfoPanel],
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
      placeholder="Search on your server"
      emptyStateText="Find by title, genre, artist, or year..."
      isLoading={isSearching}
      topInset={140}
      colorScheme="dark"
      textColor={searchTextColor}
      accentColor={searchTextColor}

      // Card styling mirrors VideoGridItem so native search results and the
      // JS grids read as the same component. Tokens come from CARD_FOCUS/DESIGN
      // rather than being duplicated here.
      cardCornerRadius={DESIGN.BORDER_RADIUS_CARD}
      cardBackgroundColor={COLORS.SURFACE}
      borderWidth={CARD_FOCUS.BORDER_WIDTH}
      // Hex equivalent of CARD_FOCUS.BORDER_COLOR — the native side parses hex, not rgba()
      borderColor={COLORS.BORDER_RESTING_ARGB}

      // Apple's card lift/parallax would sit on top of the border and glow
      focusStyle="custom"
      showFocusBorder
      focusBorderWidth={CARD_FOCUS.BORDER_WIDTH_FOCUSED}
      focusGlowColor={CARD_FOCUS.GLOW_COLOR}
      focusGlowOpacity={CARD_FOCUS.GLOW_OPACITY}
      focusGlowRadius={CARD_FOCUS.GLOW_RADIUS.tv}

      // Title sliver: sunken bar with gold text at rest, gold bar with warm-brown text on focus
      overlayHeight={46}
      overlayTitleSize={22}
      overlayTitleWeight="bold"
      overlayBackgroundColor={COLORS.SURFACE_SUNKEN}
      overlayTextColor={COLORS.ACCENT}
      overlayBackgroundColorFocused={CARD_FOCUS.TITLE_BG_FOCUSED}
      overlayTextColorFocused={CARD_FOCUS.TITLE_TEXT_FOCUSED}

      marqueeDelay={0.3}
      marqueeSpeed={60}
      marqueeMode="bounce"

      onSearch={handleSearch}
      onSelectItem={handleSelectItem}
      // Held select opens the info panel, same as a long press on a JS card
      enableLongPress
      onLongSelectItem={handleLongSelectItem}
      onSearchFieldFocused={handleSearchFieldFocused}
      onSearchFieldBlurred={handleSearchFieldBlurred}
      style={styles.nativeSearchView}
    />
  );
}

function NativeSearchScreenWithBackground() {
  // The native search hosting controller's view is .clear (verified in
  // ExpoTvosSearchView.setupView), so the ambient canvas renders through it.
  //
  // Mounting TvosSearchView is heavy (UIHostingController init + first SwiftUI paint),
  // which leaves the tab blank for a beat on landing. The first commit paints only the
  // canvas and a centered spinner; the native view mounts one frame later and the spinner
  // leaves once that commit lays out. The spinner overlays the native view (last sibling,
  // on top) — it is unmounted on ready, so it never occludes focus once the UI is up.
  const [nativePhase, setNativePhase] = useState<"pending" | "mounted" | "ready">("pending");
  useEffect(() => {
    // Guarded one-shot deferral of the heavy native mount; not a render cascade.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setNativePhase((phase) => (phase === "pending" ? "mounted" : phase));
  }, []);
  const handleNativeLayout = useCallback(() => setNativePhase("ready"), []);

  return (
    <View style={styles.container}>
      <AmbientBackground />
      {nativePhase !== "pending" && (
        <View style={styles.nativeSearchView} onLayout={handleNativeLayout}>
          <NativeSearchScreen />
        </View>
      )}
      {nativePhase !== "ready" && (
        <View style={[StyleSheet.absoluteFill, styles.centerContainer]} pointerEvents="none">
          <ActivityIndicator size="small" color={COLORS.ACCENT} />
          <Text style={styles.loadingText}>Loading...</Text>
        </View>
      )}
    </View>
  );
}

function ReactNativeSearchScreen() {
  const router = useRouter();
  const { width: windowWidth } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const { showGlobalLoader, hideGlobalLoader } = useLoadingActions();
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

  const handleVideoPress = useOpenShelfItem();
  const handleVideoLongPress = useItemLongPress();

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
      setSearchError(getLoadErrorMessage(err));
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

  const numColumns = useMemo(() => slotColumns(slotOrientation, Platform.isTV, windowWidth), [slotOrientation, windowWidth]);

  const itemDimensions = useMemo(() => {
    // Phone uses the live window width so getItemLayout matches real cell heights
    // on any device or orientation; a hardcoded 400 mis-sized rows on wide screens.
    const screenWidth = Platform.isTV ? 1080 : windowWidth;
    const itemWidth = screenWidth / numColumns;
    const itemHeight = itemWidth / slotRatio(slotOrientation) + 40;
    return { itemHeight };
  }, [numColumns, slotOrientation, windowWidth]);

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
          onLongPress={handleVideoLongPress}
          index={index}
          hasTVPreferredFocus={index === 0 && shouldShowResults}
          nextFocusUp={isFirstRow ? searchInputHandle : undefined}
          slotOrientation={slotOrientation}
          numColumns={numColumns}
          progressPercent={cardResumeProgress(item)}
        />
      );
    },
    [handleVideoPress, handleVideoLongPress, shouldShowResults, numColumns, searchInputHandle, firstResultRef, slotOrientation],
  );

  const renderFooter = useCallback(() => {
    if (isLoadingMore) {
      return (
        <View style={styles.footerLoading}>
          <ActivityIndicator size="small" color={COLORS.ACCENT} />
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
            <ActivityIndicator size="small" color={COLORS.ACCENT} />
            <Text style={styles.loadingText}>Searching...</Text>
          </View>
        );
      }
      if (searchError) {
        return (
          <View style={styles.centerContainer}>
            <Ionicons name="alert-circle-outline" size={64} color={COLORS.DESTRUCTIVE} />
            <Text style={styles.errorTitle}>Search Failed</Text>
            <Text style={styles.errorText}>{searchError}</Text>
            <FocusableButton title="Try Again" variant="retry" onPress={handleRetrySearch} hasTVPreferredFocus />
          </View>
        );
      }
      return (
        <View style={styles.centerContainer}>
          <Ionicons name="search-outline" size={64} color={COLORS.TEXT_SECONDARY} />
          <Text style={styles.emptyText}>No results for &quot;{searchQuery}&quot;</Text>
        </View>
      );
    }

    if (isLoading) {
      return (
        <View style={styles.centerContainer}>
          <ActivityIndicator size="small" color={COLORS.ACCENT} />
          <Text style={styles.loadingText}>Loading...</Text>
        </View>
      );
    }

    if (error) {
      return (
        <View style={styles.centerContainer}>
          <Ionicons name="alert-circle-outline" size={64} color={COLORS.DESTRUCTIVE} />
          <Text style={styles.errorTitle}>Unable to Load</Text>
          <Text style={styles.errorText}>{error}</Text>

          <View style={styles.buttonGroup}>
            <FocusableButton
              title="Try Demo Server"
              variant="secondary"
              onPress={handleTryDemo}
              disabled={isConnectingToDemo}
              icon={<Ionicons name="play-circle-outline" size={Platform.isTV ? 24 : 20} color={COLORS.ACCENT} />}
              hasTVPreferredFocus={true}
            />
            <FocusableButton
              title="Go to Settings"
              variant="primary"
              onPress={() => router.push("/(tabs)/settings")}
              icon={<Ionicons name="settings-outline" size={Platform.isTV ? 24 : 20} color={COLORS.ON_ACCENT} />}
            />
          </View>
        </View>
      );
    }

    return (
      <View style={styles.centerContainer}>
        <Ionicons name="search-outline" size={64} color={COLORS.TEXT_SECONDARY} />
        <Text style={styles.emptyText}>Search by title, genre, artist, or year</Text>
      </View>
    );
  }, [hasSearchQuery, isSearching, searchError, searchQuery, isLoading, error, isConnectingToDemo, router, handleRetrySearch, handleTryDemo]);

  const handleSubmitEditing = useCallback(() => {
    if (shouldShowResults) {
      focusFirstResult();
    }
  }, [shouldShowResults, focusFirstResult]);

  const headerComponent = useMemo(
    () => <SearchHeader onChangeText={setSearchQuery} onSubmitEditing={handleSubmitEditing} inputRef={searchInputCallbackRef} nextFocusDown={firstResultHandle} isSearching={isSearching} />,
    [handleSubmitEditing, searchInputCallbackRef, firstResultHandle, isSearching],
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
          contentContainerStyle={[styles.gridContent, !Platform.isTV && { paddingLeft: gridEdgePadding(insets.left, false), paddingRight: gridEdgePadding(insets.right, false) }]}
          columnWrapperStyle={styles.columnWrapper}
          showsVerticalScrollIndicator={false}
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
  const { isConnected, isReady } = useAuth();

  // Logged-out Search: the same full-screen connect widget the Library tab shows. The tab
  // trigger stays visible and selectable — hiding or disabling it at runtime restructures the
  // native tab navigator and breaks layout/focus on tvOS (see (tabs)/_layout.tsx).
  if (!isReady) return null;
  if (!isConnected) {
    return <ServerConnectScreen title="Search" />;
  }
  if (isNativeSearchAvailable()) {
    return <NativeSearchScreenWithBackground />;
  }
  return <ReactNativeSearchScreen />;
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  nativeSearchView: {
    flex: 1,
  },
  emptyContainer: {
    flex: 1,
  },
  // No horizontal padding of its own: settingsStyles.contentContainer inside it owns the
  // column, which is what keeps this field the same width as a Settings card. The vertical
  // padding stays here — 150 on TV is manually clearing the top tab bar, since this header
  // rides in a FlatList rather than a ScrollView with contentInsetAdjustmentBehavior.
  searchContainer: {
    paddingTop: Platform.isTV ? 150 : 60, // phone overrides inline with the safe-area inset
    paddingBottom: Platform.isTV ? 24 : 16,
    alignItems: "center",
  },
  searchTitle: {
    fontSize: 28,
    fontWeight: "700",
    color: COLORS.TEXT_PRIMARY,
    marginLeft: 8,
    marginBottom: 18,
  },
  // Full width of the shared column. SunkenTextInput supplies the card, the inset shadow
  // and the gold focus ring on both platforms, so there is no cap to apply here — the one
  // that used to live here (800 on TV) was 80pt narrower than every other screen's column.
  searchInputWrapper: {
    width: "100%",
  },
  // Transparent: an opaque field paints over the wrapper's inset shadow. The
  // wrapper owns the height (one control tall, matching a FocusableButton).
  searchInput: {
    width: "100%",
    flex: 1,
    backgroundColor: "transparent",
    paddingHorizontal: Platform.isTV ? 28 : 20,
    fontSize: Platform.isTV ? 28 : 20,
    color: COLORS.TEXT_PRIMARY,
  },
  gridContent: {
    paddingBottom: Platform.isTV ? 120 : 100,
    paddingHorizontal: Platform.isTV ? 40 : GRID.SIDE_PADDING.phone,
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
    color: COLORS.TEXT_SECONDARY,
    fontWeight: "500",
  },
  errorTitle: {
    marginTop: 16,
    fontSize: Platform.isTV ? 24 : 20,
    fontWeight: "700",
    color: COLORS.TEXT_PRIMARY,
  },
  errorText: {
    marginTop: 8,
    fontSize: Platform.isTV ? 18 : 15,
    color: COLORS.TEXT_SECONDARY,
    textAlign: "center",
    lineHeight: 24,
  },
  emptyText: {
    marginTop: 16,
    fontSize: Platform.isTV ? 20 : 16,
    color: COLORS.TEXT_SECONDARY,
    textAlign: "center",
  },
  resultsLabel: {
    marginTop: -8,
    marginLeft: 16,
    fontSize: Platform.isTV ? 16 : 13,
    color: COLORS.TEXT_SECONDARY,
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
    color: COLORS.TEXT_SECONDARY,
  },
  buttonGroup: {
    gap: Platform.isTV ? 16 : 12,
    marginTop: Platform.isTV ? 32 : 24,
    width: "100%",
    maxWidth: 400,
    alignItems: "center",
  },
});
