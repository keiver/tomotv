import { AmbientBackground } from "@/components/ambient-background";
import { FocusableButton } from "@/components/FocusableButton";
import { FolderLoadingBar } from "@/components/folder-loading-bar";
import { LoadingRow } from "@/components/loading-row";
import { localeScreen } from "@/components/locale-boundary";
import { SearchLoadingBar } from "@/components/search-loading-bar";
import { ServerConnectScreen } from "@/components/settings/ServerConnectScreen";
import { SunkenTextInput } from "@/components/sunken-text-input";
import { SearchResultsGrid, type SearchResultsGridHandle } from "@/components/search-results-grid";
import { IS_PAD, settingsStyles } from "@/components/settings/styles";
import { COLORS } from "@/constants/colors";
import { useAuth } from "@/contexts/AuthContext";
import { useLibrary } from "@/contexts/LibraryContext";
import { useLoadingActions } from "@/contexts/LoadingContext";
import { useColorScheme } from "@/hooks/use-color-scheme";
import { useCardPalette } from "@/hooks/useCardPalette";
import { useItemLongPress } from "@/hooks/useItemLongPress";
import { useLiveTvSearchRefresh } from "@/hooks/useLiveTvSearchRefresh";
import { useOpenShelfItem } from "@/hooks/useOpenShelfItem";
import { useServerSearch } from "@/hooks/useServerSearch";
import { connectToDemoServer } from "@/services/jellyfinApi";
import { JellyfinVideoItem } from "@/types/jellyfin";
import { logger } from "@/utils/logger";
import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { isNativeSearchAvailable, TvosSearchView } from "expo-tvos-search";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Alert, findNodeHandle, Platform, StyleSheet, Text, TextInput, TVEventControl, View } from "react-native";
import { t } from "@/services/i18n";
import { takeSearchFocusRequest } from "@/services/searchFocus";

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
      <View style={[styles.searchContainer, !Platform.isTV && { paddingTop: insets.top + (IS_PAD ? 20 : 8), paddingLeft: insets.left, paddingRight: insets.right }]}>
        <View style={settingsStyles.contentContainer}>
          {/* Phone: a real header area above the field: the tab needs a title, not a bare input
              floating under the status bar. TV keeps its top-padded input (title would fight the
              top tab bar). */}
          {!Platform.isTV && <Text style={styles.searchTitle}>{t("tab.search")}</Text>}
          <SunkenTextInput
            ref={inputRef}
            defaultValue={initialQuery}
            containerStyle={styles.searchInputWrapper}
            placeholder={t("search.findInServer")}
            placeholderTextColor={COLORS.TEXT_SECONDARY}
            accessibilityLabel={t("tab.search")}
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
  const handleSearchResults = useCallback((term: string, count: number, live: number) => {
    logger.debug("Search results", { service: "NativeSearchScreen", query: term, count, live });
  }, []);
  const handleSearchError = useCallback((error: unknown, term: string) => {
    logger.error("Search failed", error, { service: "NativeSearchScreen", query: term });
    // Show alert for connection errors so user knows something went wrong
    const message = error instanceof Error ? error.message : t("search.unableBody");
    if (message.includes("not configured") || message.includes("network") || message.includes("timeout")) {
      Alert.alert(t("search.error"), message);
    }
  }, []);
  const { query, items, offerLiveResults, isSearching, isLiveSearching, isLoadingMore, search, loadMore } = useServerSearch({
    waitOnEveryChange: true,
    onResults: handleSearchResults,
    onError: handleSearchError,
  });
  // React sizes the child against the whole native view; the results region is smaller. The view
  // measures it and reports it, so the grid packs against the box it is actually drawn in.
  const [region, setRegion] = useState<{ width: number; height: number } | null>(null);
  useLiveTvSearchRefresh(query, (_term, found) => offerLiveResults(found));

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

  const handleSearch = useCallback((event: { nativeEvent: { query: string } }) => search(event.nativeEvent.query), [search]);

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
    <>
      {/* The native view keeps the search field and its on-screen keyboard; the results region is
          its child, so search results are the same cards the Library tab draws. */}
      <TvosSearchView
        results={[]}
        placeholder={t("search.onServer")}
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
        <NativeSearchResults
          query={query}
          items={items}
          isSearching={isSearching}
          isLoadingMore={isLoadingMore}
          region={region}
          onItemPress={openItem}
          onItemLongPress={openInfoPanel}
          onEndReached={loadMore}
        />
      </TvosSearchView>
      {/* Bottom loading bar, hosted exactly as library-grid hosts it: last child of the
          screen-level container, mounted for the whole lifetime so the complete-then-fade
          handoff plays over the arriving cards. */}
      <FolderLoadingBar active={isSearching || isLiveSearching} title={isSearching ? query.trim() : t("search.gatheringLive")} />
    </>
  );
}

/**
 * Results region of the native search view. Owns the states the native view would otherwise draw
 * for itself (prompt, spinner, no results), because children replace its whole results area.
 */
function NativeSearchResults({
  query,
  items,
  isSearching,
  isLoadingMore,
  region,
  onItemPress,
  onItemLongPress,
  onEndReached,
}: {
  query: string;
  items: JellyfinVideoItem[];
  isSearching: boolean;
  isLoadingMore: boolean;
  region: { width: number; height: number } | null;
  onItemPress: (item: JellyfinVideoItem) => void;
  onItemLongPress: (item: JellyfinVideoItem) => void;
  onEndReached: () => void;
}) {
  // Until the region is measured, flex fills whatever React thinks the box is. That lands on the
  // first layout pass, while the results are still empty.
  const body =
    items.length > 0 ? (
      // No initial focus claim: the search keyboard above owns focus until the viewer arrows down.
      // The region is already inside the tvOS safe area, so the grid adds no edge padding of its
      // own and packs against the full width, matching the Library tab's card size.
      <SearchResultsGrid
        items={items}
        onItemPress={onItemPress}
        onItemLongPress={onItemLongPress}
        availableWidth={region?.width}
        edgePadding={region ? 0 : undefined}
        onEndReached={onEndReached}
        ListFooterComponent={
          isLoadingMore ? (
            <View style={styles.footerLoading}>
              <LoadingRow label={t("search.loadingMore")} />
            </View>
          ) : null
        }
      />
    ) : (
      <EmptyResults query={query} isSearching={isSearching} />
    );

  return <View style={region ?? styles.regionFallback}>{body}</View>;
}

function EmptyResults({ query, isSearching }: { query: string; isSearching: boolean }) {
  return (
    <View style={styles.centerContainer}>
      {isSearching ? (
        <LoadingRow label={t("search.searching")} />
      ) : (
        <>
          <Ionicons name="search-outline" size={64} color={COLORS.TEXT_SECONDARY} />
          <Text style={styles.emptyText}>{query.trim().length >= 2 ? `${t("search.noResultsFor")} "${query.trim()}"` : t("search.emptyHint")}</Text>
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
          <LoadingRow label={t("search.loading")} />
        </View>
      )}
    </View>
  );
}

function ReactNativeSearchScreen({ initialQuery }: { initialQuery?: string }) {
  const router = useRouter();
  const palette = useCardPalette();
  const { showGlobalLoader, hideGlobalLoader } = useLoadingActions();
  const { refreshLibrary, isLoading, error } = useLibrary();
  const {
    query: searchQuery,
    activeQuery,
    items,
    offerLiveResults,
    isSearching,
    isLiveSearching,
    isLoadingMore,
    error: searchError,
    search,
    retry: handleRetrySearch,
    loadMore: handleLoadMore,
    clearError,
  } = useServerSearch({ initialQuery });
  const seededQuery = useRef(false);
  const [firstResultHandle, setFirstResultHandle] = useState<number | undefined>(undefined);
  const [isConnectingToDemo, setIsConnectingToDemo] = useState(false);
  const searchInputRef = useRef<TextInput>(null);
  const gridRef = useRef<SearchResultsGridHandle>(null);

  const handleVideoPress = useOpenShelfItem();
  const handleVideoLongPress = useItemLongPress();
  useLiveTvSearchRefresh(activeQuery, (_term, found) => offerLiveResults(found));

  const focusFirstResult = useCallback(() => gridRef.current?.focusFirstCard(), []);

  useEffect(() => {
    if (isLoading && searchError) clearError();
  }, [isLoading, searchError, clearError]);

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

      Alert.alert(t("search.demoConnected"), t("search.demoBody"), [{ text: "OK" }]);
    } catch (error) {
      hideGlobalLoader();

      if (connected) {
        // Connection succeeded but refresh failed
        Alert.alert(t("search.connectedToDemo"), t("search.demoLoadFailed"), [{ text: "OK" }]);
      } else {
        // Connection failed
        Alert.alert(t("search.connectionFailed"), error instanceof Error ? error.message : t("search.demoFailedTitle"), [{ text: "OK" }]);
      }
    } finally {
      setIsConnectingToDemo(false);
    }
  }, [isConnectingToDemo, showGlobalLoader, hideGlobalLoader, refreshLibrary]);

  // The deep link's param can land after this screen mounts, so the initial state misses it.
  useEffect(() => {
    if (seededQuery.current || !initialQuery) return;
    seededQuery.current = true;
    search(initialQuery);
  }, [initialQuery, search]);

  const hasSearchQuery = searchQuery.trim().length >= 2;
  const shouldShowResults = hasSearchQuery && items.length > 0;

  const [searchInputHandle, setSearchInputHandle] = useState<number | undefined>(undefined);

  const searchInputCallbackRef = useCallback((node: TextInput | null) => {
    setSearchInputHandle(getNativeHandle(node));
    // Assign to ref for imperative access
    searchInputRef.current = node;
  }, []);

  // A screen's search button lands here with the field focused.
  useFocusEffect(
    useCallback(() => {
      if (takeSearchFocusRequest()) searchInputRef.current?.focus();
    }, []),
  );

  const renderFooter = useCallback(() => {
    if (isLoadingMore) {
      return (
        <View style={styles.footerLoading}>
          <LoadingRow label={t("search.loadingMore")} />
        </View>
      );
    }
    return null;
  }, [isLoadingMore]);

  const renderEmpty = useCallback(() => {
    if (hasSearchQuery) {
      if (isSearching) {
        return (
          <View style={styles.centerContainer}>
            <LoadingRow label={t("search.searching")} />
          </View>
        );
      }
      if (searchError) {
        return (
          <View style={styles.centerContainer}>
            <Ionicons name="alert-circle-outline" size={64} color={COLORS.DESTRUCTIVE} />
            <Text style={styles.errorTitle}>{t("search.failed")}</Text>
            <Text style={styles.errorText}>{searchError}</Text>
            <FocusableButton title={t("common.tryAgain")} variant="retry" onPress={handleRetrySearch} hasTVPreferredFocus />
          </View>
        );
      }
      return (
        <View style={styles.centerContainer}>
          <Ionicons name="search-outline" size={64} color={COLORS.TEXT_SECONDARY} />
          <Text style={styles.emptyText}>{`${t("search.noResultsFor")} "${searchQuery}"`}</Text>
        </View>
      );
    }

    if (isLoading) {
      return (
        <View style={styles.centerContainer}>
          <LoadingRow label={t("search.loadingLibrary")} />
        </View>
      );
    }

    if (error) {
      return (
        <View style={styles.centerContainer}>
          <Ionicons name="alert-circle-outline" size={64} color={COLORS.DESTRUCTIVE} />
          <Text style={styles.errorTitle}>{t("common.unableToLoad")}</Text>
          <Text style={styles.errorText}>{error}</Text>

          <View style={styles.buttonGroup}>
            <FocusableButton
              title={t("search.tryDemo")}
              variant="secondary"
              onPress={handleTryDemo}
              disabled={isConnectingToDemo}
              icon={<Ionicons name="play-circle-outline" size={Platform.isTV ? 24 : 20} color={palette.accent} />}
              hasTVPreferredFocus={true}
            />
            <FocusableButton
              title={t("search.goToSettings")}
              variant="primary"
              onPress={() => router.push("/(tabs)/settings")}
              icon={<Ionicons name="settings-outline" size={Platform.isTV ? 24 : 20} color={palette.onAccent} />}
            />
          </View>
        </View>
      );
    }

    return (
      <View style={styles.centerContainer}>
        <Ionicons name="search-outline" size={64} color={COLORS.TEXT_SECONDARY} />
        <Text style={styles.emptyText}>{t("search.placeholder")}</Text>
      </View>
    );
  }, [hasSearchQuery, isSearching, searchError, searchQuery, isLoading, error, isConnectingToDemo, router, handleRetrySearch, handleTryDemo, palette]);

  const handleSubmitEditing = useCallback(() => {
    if (shouldShowResults) {
      focusFirstResult();
    }
  }, [shouldShowResults, focusFirstResult]);

  const headerComponent = useMemo(
    () => (
      <SearchHeader
        initialQuery={initialQuery}
        onChangeText={search}
        onSubmitEditing={handleSubmitEditing}
        inputRef={searchInputCallbackRef}
        nextFocusDown={firstResultHandle}
        isSearching={isSearching || isLiveSearching}
      />
    ),
    [initialQuery, search, handleSubmitEditing, searchInputCallbackRef, firstResultHandle, isSearching, isLiveSearching],
  );

  return (
    <View style={styles.container}>
      <AmbientBackground />
      {headerComponent}

      {shouldShowResults ? (
        <SearchResultsGrid
          ref={gridRef}
          items={items}
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

export default localeScreen(SearchScreen);

function SearchScreen() {
  const { isConnected, isReady } = useAuth();
  // Capture deep-links `?q=` so the screenshot tool never has to type into the simulator.
  const { q } = useLocalSearchParams<{ q?: string }>();

  // Logged-out Search: the same full-screen connect widget the Library tab shows. The tab
  // trigger stays visible and selectable; hiding or disabling it at runtime restructures the
  // native tab navigator and breaks layout/focus on tvOS (see (tabs)/_layout.tsx).
  if (!isReady) return null;
  if (!isConnected) {
    return <ServerConnectScreen title={t("tab.search")} />;
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
  buttonGroup: {
    gap: Platform.isTV ? 16 : 12,
    marginTop: Platform.isTV ? 32 : 24,
    width: "100%",
    maxWidth: 400,
    alignItems: "center",
  },
});
