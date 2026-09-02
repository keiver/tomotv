import { AmbientBackground } from "@/components/ambient-background";
import { ContinueWatchingRow } from "@/components/continue-watching-row";
import { FocusableButton } from "@/components/FocusableButton";
import { LoadingBar } from "@/components/loading-bar";
import { FolderGridItem } from "@/components/folder-grid-item";
import { ItemShelf } from "@/components/item-shelf";
import { MediaShelf } from "@/components/media-shelf";
import { VideoGridItem } from "@/components/video-grid-item";
import { ArtworkSlotShape, GRID, gridEdgePadding, itemSlotShape } from "@/constants/app";
import { COLORS } from "@/constants/colors";
import { useItemLongPress } from "@/hooks/useItemLongPress";
import { getRecoveryStatus, RecoveryStatus, subscribeRecoveryStatus } from "@/services/connectionRecovery";
import { fetchFavoriteItems, fetchLatestItems, isFolder, signOut } from "@/services/jellyfinApi";
import { JellyfinItem } from "@/types/jellyfin";
import { cardResumeProgress } from "@/utils/resumeProgress";
import { Ionicons } from "@expo/vector-icons";
import { useIsFocused, useRouter } from "expo-router";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Platform, ScrollView, StyleSheet, Text, useWindowDimensions, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

const IS_TV = Platform.isTV;

// TV tab bar is at the top and already inside insets.top; phone bar is ~49px at the bottom.
const TAB_BAR_HEIGHT = IS_TV ? 210 : 49;

interface HomeShelvesProps {
  /** The user's library views, loaded by the host route (useFolderContents(null)). */
  libraries: JellyfinItem[];
  isLoading: boolean;
  error: string | null;
  /** Re-runs the libraries load from the error state's Retry button. */
  onRetry: () => void;
  /** Press on a Libraries-row card — navigation belongs to the route screen. */
  onLibraryPress: (item: JellyfinItem) => void;
}

/**
 * The Home tab body: four horizontal shelves — Libraries, Continue, New, Favorites — over the
 * static ambient canvas. Libraries lead because they load synchronously from cache, so the top
 * of the screen and the launch focus target never jump while the async shelves arrive; empty
 * shelves below collapse to nothing.
 */
export function HomeShelves({ libraries, isLoading, error, onRetry, onLibraryPress }: HomeShelvesProps) {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { width: windowWidth, height: windowHeight } = useWindowDimensions();
  // iPadOS renders the tab bar at the TOP, inside insets.top, so a tablet has no bottom bar
  // to clear and reserving one leaves a dead band under the last shelf.
  const isTablet = !IS_TV && Math.min(windowWidth, windowHeight) >= GRID.PHONE_WIDE_MIN_WIDTH;

  // Gates the first card's mount-time focus claim: a covered screen must never take the
  // app-wide preferred-focus slot (see library-grid.tsx's isScreenFocused notes).
  const isScreenFocused = useIsFocused();

  // One-shot latch: once focus is inside the screen, the first card's mount-time claim is
  // retired — a claim left standing is re-requested by UIKit on later layout passes and
  // would yank focus back on every reveal (e.g. returning from the player).
  const [focusClaimed, setFocusClaimed] = useState(false);

  // Connection recovery runs in the background after a network-classified load failure;
  // while it is looking for the server the error state shows progress instead of dead-end
  // actions. A recovered connection refreshes the load via the auth-change subscription.
  const [recoveryStatus, setRecoveryStatus] = useState<RecoveryStatus>(getRecoveryStatus());
  useEffect(() => subscribeRecoveryStatus(setRecoveryStatus), []);

  // Switching servers from the error state is an explicit choice to leave this server, so no
  // extra confirmation. dismissTo, not navigate — see hooks/useFinishLogin.ts.
  const handleSwitchServer = useCallback(async () => {
    await signOut();
    router.dismissTo("/");
  }, [router]);

  // Retires the first card's mount-time claim the moment focus is inside the screen.
  // Phone has no focus engine (this same handler is the press-in path there).
  const handleItemFocus = useCallback(() => {
    if (!IS_TV) return;
    setFocusClaimed(true);
  }, []);

  // The shared card menu (View Info / Show In Folder / favorite / watched) — every home
  // row carries it; on a library root Show In Folder alerts gracefully (no ancestor path).
  const onItemLongPress = useItemLongPress();

  const renderLibrary = useCallback(
    (item: JellyfinItem, index: number, cardHeight: number) => {
      const claimsFocusOnMount = index === 0 && isScreenFocused && !focusClaimed;
      return isFolder(item) ? (
        <FolderGridItem
          folder={item}
          onPress={onLibraryPress}
          onLongPress={onItemLongPress}
          index={index}
          onItemFocus={handleItemFocus}
          hasTVPreferredFocus={claimsFocusOnMount}
          cardHeight={cardHeight}
          fitArtwork
          slotOrientation="landscape"
        />
      ) : (
        <VideoGridItem
          video={item}
          onPress={onLibraryPress}
          onLongPress={onItemLongPress}
          index={index}
          onItemFocus={handleItemFocus}
          hasTVPreferredFocus={claimsFocusOnMount}
          cardHeight={cardHeight}
          fitArtwork
          slotOrientation="landscape"
          progressPercent={cardResumeProgress(item)}
        />
      );
    },
    [onLibraryPress, onItemLongPress, handleItemFocus, isScreenFocused, focusClaimed],
  );

  const keyExtractor = useCallback((item: JellyfinItem) => item.Id, []);

  // Same mapping the cards render with (square no-art fallback) — see itemSlotShape.
  const slotShapeFor = useCallback((item: JellyfinItem): ArtworkSlotShape => itemSlotShape(item.PrimaryImageAspectRatio), []);

  // Edge padding subsumes the safe-area inset so shelves fill the safe area; the shelves
  // derive their card widths from the same formula, keeping every row on one column grid.
  // Bottom clearance: the tab bar is at the BOTTOM only on phone — padding the TV scroll
  // by the bar height creates a phantom band of scrollable space below the last shelf.
  const scrollContentStyle = useMemo(
    () => ({
      paddingTop: (IS_TV ? 20 : 8) + insets.top,
      paddingBottom: (IS_TV || isTablet ? 40 : TAB_BAR_HEIGHT + 20) + insets.bottom,
      paddingLeft: gridEdgePadding(insets.left, IS_TV),
      paddingRight: gridEdgePadding(insets.right, IS_TV),
    }),
    [insets.top, insets.bottom, insets.left, insets.right, isTablet],
  );

  const status = useMemo(() => {
    if (isLoading) {
      return (
        <View style={styles.centerContainer}>
          <LoadingBar label="Loading your libraries" />
        </View>
      );
    }
    if (error) {
      if (recoveryStatus === "running") {
        return (
          <View style={styles.centerContainer}>
            <LoadingBar label="Looking for your server" />
            <Text style={styles.errorText}>Checking this network for your Jellyfin server</Text>
          </View>
        );
      }
      return (
        <View style={styles.centerContainer}>
          <Ionicons name="alert-circle-outline" size={64} color={COLORS.DESTRUCTIVE} />
          <Text style={styles.errorTitle}>Unable to Load</Text>
          <Text style={styles.errorText}>{error}</Text>

          <View style={styles.buttonGroup}>
            <FocusableButton title="Retry" variant="primary" onPress={onRetry} icon={<Ionicons name="refresh-outline" size={IS_TV ? 24 : 20} color={COLORS.ON_ACCENT} />} hasTVPreferredFocus={true} />
            <FocusableButton title="Switch Server" variant="secondary" onPress={handleSwitchServer} icon={<Ionicons name="swap-horizontal-outline" size={IS_TV ? 24 : 20} color={COLORS.ACCENT} />} />
          </View>
        </View>
      );
    }
    return (
      <View style={styles.centerContainer}>
        <Ionicons name="folder-open-outline" size={64} color={COLORS.TEXT_SECONDARY} />
        <Text style={styles.emptyText}>No libraries found</Text>
      </View>
    );
  }, [isLoading, error, recoveryStatus, onRetry, handleSwitchServer]);

  return (
    <View style={styles.container}>
      <AmbientBackground />
      {libraries.length === 0 ? (
        status
      ) : (
        <ScrollView contentContainerStyle={scrollContentStyle} contentInsetAdjustmentBehavior="never" showsVerticalScrollIndicator={false}>
          <MediaShelf title="Libraries" data={libraries} slotShapeFor={slotShapeFor} renderItem={renderLibrary} keyExtractor={keyExtractor} />
          <ContinueWatchingRow onItemFocus={handleItemFocus} />
          <ItemShelf title="Favorites" fetch={fetchFavoriteItems} refreshOnFavoriteChange onItemFocus={handleItemFocus} />
          <ItemShelf title="New" fetch={fetchLatestItems} onItemFocus={handleItemFocus} />
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  centerContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: 40,
  },
  errorTitle: {
    marginTop: 16,
    fontSize: 24,
    fontWeight: "700",
    color: COLORS.TEXT_PRIMARY,
    textAlign: "center",
  },
  errorText: {
    marginTop: 18,
    fontSize: 17,
    color: COLORS.TEXT_SECONDARY,
    textAlign: "center",
    lineHeight: 24,
  },
  emptyText: {
    marginTop: 16,
    fontSize: 20,
    color: COLORS.TEXT_SECONDARY,
    textAlign: "center",
  },
  buttonGroup: {
    gap: IS_TV ? 16 : 12,
    marginTop: IS_TV ? 32 : 24,
    width: "100%",
    maxWidth: 400,
    alignItems: "center",
  },
});
