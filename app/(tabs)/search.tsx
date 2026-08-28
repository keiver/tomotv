import { AmbientBackground } from "@/components/ambient-background";
import { FocusableButton } from "@/components/FocusableButton";
import { LoadingRow } from "@/components/loading-row";
import { SearchLoadingBar } from "@/components/search-loading-bar";
import { ServerConnectScreen } from "@/components/settings/ServerConnectScreen";
import { SunkenTextInput } from "@/components/sunken-text-input";
import { SearchResultsGrid, type SearchResultsGridHandle } from "@/components/search-results-grid";
import { settingsStyles } from "@/components/settings/styles";
import { COLORS } from "@/constants/colors";
import { useAuth } from "@/contexts/AuthContext";
import { useLibrary } from "@/contexts/LibraryContext";
import { useLoadingActions } from "@/contexts/LoadingContext";
import { useColorScheme } from "@/hooks/use-color-scheme";
import { useItemLongPress } from "@/hooks/useItemLongPress";
import { useOpenShelfItem } from "@/hooks/useOpenShelfItem";
import { connectToDemoServer, searchVideos } from "@/services/jellyfinApi";
import { JellyfinVideoItem } from "@/types/jellyfin";
import { getLoadErrorMessage } from "@/utils/errorClassification";
import { logger } from "@/utils/logger";
import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { isNativeSearchAvailable, TvosSearchView } from "expo-tvos-search";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Alert, findNodeHandle, Platform, StyleSheet, Text, TextInput, TVEventControl, View } from "react-native";

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
  /** Seeds the field for screenshot capture (`?q=`); the user's typing owns it after that. */
  initialQuery?: string;
  onChangeText: (text: string) => void;
  onSubmitEditing: () => void;
  inputRef: React.RefCallback<TextInput> | React.RefObject<TextInput>;
  nextFocusDown?: number;
  isSearching: boolean;
}

const SearchHeader = React.memo(
  function SearchHeader({ initialQuery, onChangeText, onSubmitEditing, inputRef, nextFocusDown, isSearching }: SearchHeaderProps) {
    const insets = useSafeAreaInsets();

    // Horizontal padding is the shared contentContainer's job, so the field lands on the column the
    // Settings cards and the connect form use; the phone override adds only the safe-area inset.
    return (
      <View style={[styles.searchContainer, !Platform.isTV && { paddingTop: insets.top + 8, paddingLeft: insets.left, paddingRight: insets.right }]}>
        <View style={settingsStyles.contentContainer}>
          {/* Phone: a real header area above the field: the tab needs a title, not a bare input
              floating under the status bar. TV keeps its top-padded input (title would fight the
              top tab bar). */}
          {!Platform.isTV && <Text style={styles.searchTitle}>Search</Text>}
          <SunkenTextInput
            ref={inputRef}
            defaultValue={initialQuery}
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
      prevProps.initialQuery === nextProps.initialQuery &&
      prevProps.onChangeText === nextProps.onChangeText &&
      prevProps.onSubmitEditing === nextProps.onSubmitEditing &&
      prevProps.nextFocusDown === nextProps.nextFocusDown &&
      prevProps.isSearching === nextProps.isSearching
    );
  },
);

// The native view requires onSelectItem, but with children it has no cards of its own to select.
const NOOP_SELECT = () => {};

function NativeSearchScreen({ onReady, initialQuery }: { onReady: () => void; initialQuery?: string }) {
  const openItem = useOpenShelfItem();
  const openInfoPanel = useItemLongPress();
  const colorScheme = useColorScheme();
  const searchTextColor = colorScheme === "light" ? COLORS.TEXT_PRIMARY : undefined;
  const [searchResults, setSearchResults] = useState<JellyfinVideoItem[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [query, setQuery] = useState("");
  // React sizes the child against the whole native view; the results region is smaller. The view
  // measures it and reports it, so the grid packs against the box it is actually drawn in.
  const [region, setRegion] = useState<{ width: number; height: number } | null>(null);
  const searchDelayRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Doubles as the readiness edge: SwiftUI lays this region out only once NavigationView + .searchable
  // are up, so the first fire is the search bar on screen. RN's wrapper onLayout fires a commit earlier.
  const handleContentLayout = useCallback(
    (event: { nativeEvent: { width: number; height: number } }) => {
      const { width, height } = event.nativeEvent;
      setRegion((current) => (current?.width === width && current?.height === height ? current : { width, height }));
      onReady();
    },
    [onReady],
  );

  const handleSearch = useCallback((event: { nativeEvent: { query: string } }) => {
    const nextQuery = event.nativeEvent.query;
    setQuery(nextQuery);

    if (searchDelayRef.current) {
      clearTimeout(searchDelayRef.current);
    }

    if (nextQuery.trim().length < 2) {
      setSearchResults([]);
      setIsSearching(false);
      return;
    }

    setIsSearching(true);
    searchDelayRef.current = setTimeout(async () => {
      try {
        const { items } = await searchVideos(nextQuery.trim(), { limit: 60 });
        logger.debug("Search results", { service: "NativeSearchScreen", query: nextQuery.trim(), count: items.length });
        setSearchResults(items);
      } catch (error) {
        logger.error("Search failed", error, { service: "NativeSearchScreen", query: nextQuery.trim() });
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

  // The native field has no JS-settable text, so a seeded query drives the results only.
  const seeded = useRef(false);
  useEffect(() => {
    if (seeded.current || !initialQuery) return;
    seeded.current = true;
    handleSearch({ nativeEvent: { query: initialQuery } });
  }, [initialQuery, handleSearch]);

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

  return (
    // The native view keeps the search field and its on-screen keyboard; the results region is
    // this child, so search results are the same cards the Library tab draws.
    <TvosSearchView
      results={[]}
      placeholder="Search on your server"
      topInset={140}
      colorScheme="dark"
      textColor={searchTextColor}
      accentColor={searchTextColor}
      onSearch={handleSearch}
      onSelectItem={NOOP_SELECT}
      onSearchFieldFocused={handleSearchFieldFocused}
      onSearchFieldBlurred={handleSearchFieldBlurred}
      onContentLayout={handleContentLayout}
      style={styles.nativeSearchView}>
      <NativeSearchResults query={query} results={searchResults} isSearching={isSearching} region={region} onItemPress={openItem} onItemLongPress={openInfoPanel} />
    </TvosSearchView>
  );
}

/**
 * Results region of the native search view. Owns the states the native view would otherwise draw
 * for itself (prompt, spinner, no results), because children replace its whole results area.
 */
function NativeSearchResults({
  query,
  results,
  isSearching,
  region,
  onItemPress,
  onItemLongPress,
}: {
  query: string;
  results: JellyfinVideoItem[];
  isSearching: boolean;
  region: { width: number; height: number } | null;
  onItemPress: (item: JellyfinVideoItem) => void;
  onItemLongPress: (item: JellyfinVideoItem) => void;
}) {
  // Until the region is measured, flex fills whatever React thinks the box is. That lands on the
  // first layout pass, while the results are still empty.
  const body =
    results.length > 0 ? (
      // No initial focus claim: the search keyboard above owns focus until the viewer arrows down.
      // The region is already inside the tvOS safe area, so the grid adds no edge padding of its
      // own and packs against the full width, matching the Library tab's card size.
      <SearchResultsGrid items={results} onItemPress={onItemPress} onItemLongPress={onItemLongPress} availableWidth={region?.width} edgePadding={region ? 0 : undefined} />
    ) : (
      <EmptyResults query={query} isSearching={isSearching} />
    );

  return <View style={region ?? styles.regionFallback}>{body}</View>;
}

function EmptyResults({ query, isSearching }: { query: string; isSearching: boolean }) {
  return (
    <View style={styles.centerContainer}>
      {isSearching ? (
        <LoadingRow label="Searching..." />
      ) : (
        <>
          <Ionicons name="search-outline" size={64} color={COLORS.TEXT_SECONDARY} />
          <Text style={styles.emptyText}>{query.trim().length >= 2 ? `No results for "${query.trim()}"` : "Find by title, genre, artist, or year..."}</Text>
        </>
      )}
    </View>
  );
}

function NativeSearchScreenWithBackground({ initialQuery }: { initialQuery?: string }) {
  // The native search hosting controller's view is .clear (verified in
  // ExpoTvosSearchView.setupView), so the ambient canvas renders through it.
  //
  // Mounting TvosSearchView is heavy (UIHostingController init + first SwiftUI paint),
  // which leaves the tab blank for a beat on landing. The first commit paints only the
  // canvas and a centered spinner; the native view mounts one frame later and the spinner
  // leaves on the view's first onContentLayout, which is the native view telling us SwiftUI
  // has laid the results region out. The spinner overlays the native view (last sibling, on
  // top); it is unmounted on ready, so it never occludes focus once the UI is up.
  const [nativePhase, setNativePhase] = useState<"pending" | "mounted" | "ready">("pending");
  useEffect(() => {
    // Guarded one-shot deferral of the heavy native mount; not a render cascade.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setNativePhase((phase) => (phase === "pending" ? "mounted" : phase));
  }, []);
  const handleNativeReady = useCallback(() => setNativePhase("ready"), []);

  return (
    <View style={styles.container}>
      <AmbientBackground />
      {nativePhase !== "pending" && (
        <View style={styles.nativeSearchView}>
          <NativeSearchScreen onReady={handleNativeReady} initialQuery={initialQuery} />
        </View>
      )}
      {nativePhase !== "ready" && (
        <View style={[StyleSheet.absoluteFill, styles.centerContainer]} pointerEvents="none">
          <LoadingRow label="Loading..." />
        </View>
      )}
    </View>
  );
}

function ReactNativeSearchScreen({ initialQuery }: { initialQuery?: string }) {
  const router = useRouter();
  const { showGlobalLoader, hideGlobalLoader } = useLoadingActions();
  const { refreshLibrary, isLoading, error } = useLibrary();
  const [searchResults, setSearchResults] = useState<JellyfinVideoItem[]>([]);
  const [searchQuery, setSearchQuery] = useState(initialQuery ?? "");
  const seededQuery = useRef(false);
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
  const gridRef = useRef<SearchResultsGridHandle>(null);

  const handleVideoPress = useOpenShelfItem();
  const handleVideoLongPress = useItemLongPress();

  const focusFirstResult = useCallback(() => gridRef.current?.focusFirstCard(), []);

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

  // The deep link's param can land after this screen mounts, so the initial state misses it.
  useEffect(() => {
    if (seededQuery.current || !initialQuery) return;
    seededQuery.current = true;
    setSearchQuery(initialQuery);
  }, [initialQuery]);

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

  const [searchInputHandle, setSearchInputHandle] = useState<number | undefined>(undefined);

  const searchInputCallbackRef = useCallback((node: TextInput | null) => {
    setSearchInputHandle(getNativeHandle(node));
    // Assign to ref for imperative access
    searchInputRef.current = node;
  }, []);

  const renderFooter = useCallback(() => {
    if (isLoadingMore) {
      return <LoadingRow label="Loading more..." style={styles.footerLoading} labelStyle={styles.footerLoadingText} />;
    }
    return null;
  }, [isLoadingMore]);

  const renderEmpty = useCallback(() => {
    if (hasSearchQuery) {
      if (isSearching) {
        return (
          <View style={styles.centerContainer}>
            <LoadingRow label="Searching..." />
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
          <LoadingRow label="Loading..." />
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
    () => (
      <SearchHeader
        initialQuery={initialQuery}
        onChangeText={setSearchQuery}
        onSubmitEditing={handleSubmitEditing}
        inputRef={searchInputCallbackRef}
        nextFocusDown={firstResultHandle}
        isSearching={isSearching}
      />
    ),
    [initialQuery, handleSubmitEditing, searchInputCallbackRef, firstResultHandle, isSearching],
  );

  return (
    <View style={styles.container}>
      <AmbientBackground />
      {headerComponent}

      {shouldShowResults ? (
        <SearchResultsGrid
          ref={gridRef}
          items={searchResults}
          onItemPress={handleVideoPress}
          onItemLongPress={handleVideoLongPress}
          nextFocusUpHandle={searchInputHandle}
          claimInitialFocus
          onFirstCardHandleChange={setFirstResultHandle}
          onEndReached={handleLoadMore}
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
  // Capture deep-links `?q=` so the screenshot tool never has to type into the simulator.
  const { q } = useLocalSearchParams<{ q?: string }>();

  // Logged-out Search: the same full-screen connect widget the Library tab shows. The tab
  // trigger stays visible and selectable; hiding or disabling it at runtime restructures the
  // native tab navigator and breaks layout/focus on tvOS (see (tabs)/_layout.tsx).
  if (!isReady) return null;
  if (!isConnected) {
    return <ServerConnectScreen title="Search" />;
  }
  if (isNativeSearchAvailable()) {
    return <NativeSearchScreenWithBackground initialQuery={q} />;
  }
  return <ReactNativeSearchScreen initialQuery={q} />;
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  nativeSearchView: {
    flex: 1,
  },
  // Until the native view reports its results region, fill whatever box React gave the child.
  regionFallback: {
    flex: 1,
  },
  emptyContainer: {
    flex: 1,
  },
  // No horizontal padding of its own: settingsStyles.contentContainer inside it owns the
  // column, which is what keeps this field the same width as a Settings card. The vertical
  // padding stays here; 150 on TV is manually clearing the top tab bar, since this header
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
    marginBottom: 18,
  },
  // Full width of the shared column. SunkenTextInput supplies the card, the inset shadow and the
  // gold focus ring on both platforms, so there is no cap to apply here.
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
  },
  rowWrapper: {
    flexDirection: "row",
    justifyContent: "flex-start",
    paddingVertical: Platform.isTV ? 24 : 6,
  },
  centerContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: 40,
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
  footerLoading: {
    justifyContent: "center",
    paddingVertical: 20,
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
