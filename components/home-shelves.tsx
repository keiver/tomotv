import { AmbientBackground } from "@/components/ambient-background";
import { ContinueWatchingRow } from "@/components/continue-watching-row";
import { FocusableButton } from "@/components/FocusableButton";
import { FolderGridItem } from "@/components/folder-grid-item";
import { ItemShelf } from "@/components/item-shelf";
import { MediaShelf } from "@/components/media-shelf";
import { VideoGridItem } from "@/components/video-grid-item";
import { gridEdgePadding } from "@/constants/app";
import { usePosterBackdropDispatch } from "@/contexts/PosterBackdropContext";
import { getRecoveryStatus, RecoveryStatus, subscribeRecoveryStatus } from "@/services/connectionRecovery";
import { fetchFavoriteItems, fetchLatestItems, isFolder, signOut } from "@/services/jellyfinApi";
import { JellyfinItem } from "@/types/jellyfin";
import { Ionicons } from "@expo/vector-icons";
import { useIsFocused, useRouter } from "expo-router";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Platform, ScrollView, StyleSheet, Text, View } from "react-native";
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
 * ambient backdrop. Libraries lead because they load synchronously from cache, so the top of
 * the screen and the launch focus target never jump while the async shelves arrive; empty
 * shelves below collapse to nothing. Must be rendered inside a PosterBackdropProvider.
 */
export function HomeShelves({ libraries, isLoading, error, onRetry, onLibraryPress }: HomeShelvesProps) {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const backdrop = usePosterBackdropDispatch();

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

  // Focus-only (no blur→clear): on tvOS the incoming card's onFocus can fire before the
  // outgoing card's onBlur, so clearing on blur would race and cancel the new poster.
  // Phone has no focus engine; its canvas is static (see AmbientBackground).
  const handleItemFocus = useCallback(
    (item: JellyfinItem) => {
      if (!IS_TV) return;
      setFocusClaimed(true);
      backdrop.focus(item);
    },
    [backdrop],
  );

  const renderLibrary = useCallback(
    (item: JellyfinItem, index: number, cardHeight: number) => {
      const claimsFocusOnMount = index === 0 && isScreenFocused && !focusClaimed;
      return isFolder(item) ? (
        <FolderGridItem
          folder={item}
          onPress={onLibraryPress}
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
          index={index}
          onItemFocus={handleItemFocus}
          hasTVPreferredFocus={claimsFocusOnMount}
          cardHeight={cardHeight}
          fitArtwork
          slotOrientation="landscape"
        />
      );
    },
    [onLibraryPress, handleItemFocus, isScreenFocused, focusClaimed],
  );

  const keyExtractor = useCallback((item: JellyfinItem) => item.Id, []);

  // Edge padding subsumes the safe-area inset so shelves fill the safe area; the shelves
  // derive their card widths from the same formula, keeping every row on one column grid.
  // Bottom clearance: the tab bar is at the BOTTOM only on phone — padding the TV scroll
  // by the bar height creates a phantom band of scrollable space below the last shelf.
  const scrollContentStyle = useMemo(
    () => ({
      paddingTop: (IS_TV ? 20 : 8) + insets.top,
      paddingBottom: (IS_TV ? 40 : TAB_BAR_HEIGHT + 20) + insets.bottom,
      paddingLeft: gridEdgePadding(insets.left, IS_TV),
      paddingRight: gridEdgePadding(insets.right, IS_TV),
    }),
    [insets.top, insets.bottom, insets.left, insets.right],
  );

  const status = useMemo(() => {
    if (isLoading) {
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
            <FocusableButton title="Retry" variant="primary" onPress={onRetry} icon={<Ionicons name="refresh-outline" size={IS_TV ? 24 : 20} color="#000000" />} hasTVPreferredFocus={true} />
            <FocusableButton title="Switch Server" variant="secondary" onPress={handleSwitchServer} icon={<Ionicons name="swap-horizontal-outline" size={IS_TV ? 24 : 20} color="#FFC312" />} />
          </View>
        </View>
      );
    }
    return (
      <View style={styles.centerContainer}>
        <Ionicons name="folder-open-outline" size={64} color="#98989D" />
        <Text style={styles.emptyText}>No libraries found</Text>
      </View>
    );
  }, [isLoading, error, recoveryStatus, onRetry, handleSwitchServer]);

  return (
    <View style={styles.container}>
      {/* The poster wash follows focus, so it belongs to the platform that has focus. Touch has
          only presses, and a wash driven by presses is a wash that shows the last thing you
          poked. Phone gets the static canvas. */}
      <AmbientBackground dynamic={IS_TV} />
      {libraries.length === 0 ? (
        status
      ) : (
        <ScrollView contentContainerStyle={scrollContentStyle} contentInsetAdjustmentBehavior="never" showsVerticalScrollIndicator={false}>
          <MediaShelf title="Libraries" data={libraries} renderItem={renderLibrary} keyExtractor={keyExtractor} />
          <ContinueWatchingRow onItemFocus={handleItemFocus} />
          <ItemShelf title="New" fetch={fetchLatestItems} onItemFocus={handleItemFocus} />
          <ItemShelf title="Favorites" fetch={fetchFavoriteItems} refreshOnFavoriteChange onItemFocus={handleItemFocus} />
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
  buttonGroup: {
    gap: IS_TV ? 16 : 12,
    marginTop: IS_TV ? 32 : 24,
    width: "100%",
    maxWidth: 400,
    alignItems: "center",
  },
});
