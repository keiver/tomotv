import { FocusableButton } from "@/components/FocusableButton";
import { getFolderCache } from "@/services/folderContentsCache";
import { fetchFolderContents, getPhotoUrl, isPhoto } from "@/services/jellyfinApi";
import { JellyfinItem } from "@/types/jellyfin";
import { logger } from "@/utils/logger";
import { Ionicons } from "@expo/vector-icons";
import { Image } from "expo-image";
import { useLocalSearchParams, useRouter } from "expo-router";
import React, { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, BackHandler, Platform, Pressable, StyleSheet, Text, TouchableOpacity, useTVEventHandler, View } from "react-native";

/**
 * Full-screen photo viewer for Jellyfin Photo items. Fed from the folder cache the user just
 * browsed (falls back to a fetch if the cache expired). Left/right on the remote steps photos;
 * Menu exits. On touch platforms the left/right screen halves step and a close button exits.
 */
export default function PhotoViewerScreen() {
  const params = useLocalSearchParams<{ folderId: string; photoId: string }>();
  const router = useRouter();

  const [photos, setPhotos] = useState<JellyfinItem[]>([]);
  const [index, setIndex] = useState(0);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    const applyPhotos = (items: JellyfinItem[]) => {
      const photoItems = items.filter(isPhoto);
      const start = photoItems.findIndex((p) => p.Id === params.photoId);
      setPhotos(photoItems);
      setIndex(start >= 0 ? start : 0);
    };

    // The folder screen that pushed this route already fetched the items; even a stale
    // cache entry is the exact list the user was just looking at.
    const cached = getFolderCache(params.folderId);
    if (cached && cached.items.some((item) => item.Id === params.photoId)) {
      applyPhotos(cached.items);
      return;
    }

    fetchFolderContents(params.folderId)
      .then((result) => {
        if (!cancelled) applyPhotos(result.items);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Failed to load photos");
        logger.error("Error loading photos for viewer", err, { service: "PhotoViewer", folderId: params.folderId });
      });

    return () => {
      cancelled = true;
    };
  }, [params.folderId, params.photoId]);

  const goStep = useCallback(
    (delta: number) => {
      setIndex((current) => Math.min(Math.max(current + delta, 0), Math.max(photos.length - 1, 0)));
    },
    [photos.length],
  );

  // Handle TV remote events
  useTVEventHandler(
    useCallback(
      (evt: { eventType: string }) => {
        if (evt.eventType === "menu") {
          router.back();
        } else if (evt.eventType === "left" || evt.eventType === "swipeLeft") {
          goStep(-1);
        } else if (evt.eventType === "right" || evt.eventType === "swipeRight") {
          goStep(1);
        }
      },
      [router, goStep],
    ),
  );

  // Handle Android TV back button
  useEffect(() => {
    if (Platform.OS === "android") {
      const backHandler = BackHandler.addEventListener("hardwareBackPress", () => {
        router.back();
        return true;
      });

      return () => backHandler.remove();
    }
  }, [router]);

  // Warm the neighbors so stepping feels instant
  useEffect(() => {
    [photos[index - 1], photos[index + 1]].forEach((photo) => {
      if (!photo) return;
      const url = getPhotoUrl(photo.Id);
      if (url) Image.prefetch(url);
    });
  }, [index, photos]);

  if (error) {
    return (
      <View style={styles.errorContainer}>
        <Ionicons name="alert-circle-outline" size={64} color="#FF3B30" />
        <Text style={styles.errorTitle}>Unable to Load Photos</Text>
        <Text style={styles.errorText}>{error}</Text>
        <FocusableButton title="Go Back" onPress={() => router.back()} variant="secondary" style={styles.button} hasTVPreferredFocus={true} />
      </View>
    );
  }

  const current = photos[index];

  return (
    <View style={styles.container}>
      {current ? (
        <Image source={{ uri: getPhotoUrl(current.Id) }} style={styles.photo} contentFit="contain" transition={150} />
      ) : (
        <ActivityIndicator size="large" color="#FFFFFF" style={styles.loader} />
      )}

      {/* Invisible focus holder so the tvOS focus engine stays on this screen */}
      {Platform.isTV && <Pressable style={StyleSheet.absoluteFill} isTVSelectable={true} hasTVPreferredFocus={true} />}

      {/* Tap zones for touch platforms */}
      {!Platform.isTV && (
        <>
          <Pressable style={[styles.tapZone, styles.tapZoneLeft]} onPress={() => goStep(-1)} accessibilityLabel="Previous photo" accessibilityRole="button" />
          <Pressable style={[styles.tapZone, styles.tapZoneRight]} onPress={() => goStep(1)} accessibilityLabel="Next photo" accessibilityRole="button" />
          <TouchableOpacity
            style={styles.iosBackButton}
            onPress={() => router.back()}
            accessibilityLabel="Close"
            accessibilityRole="button"
            accessibilityHint="Close photo viewer and return to library">
            <Ionicons name="close" size={30} color="#FFFFFF" />
          </TouchableOpacity>
        </>
      )}

      {current && (
        <View style={styles.infoPill}>
          <Text style={styles.infoName} numberOfLines={1}>
            {current.Name}
          </Text>
          {photos.length > 1 && (
            <Text style={styles.infoCounter}>
              {index + 1} / {photos.length}
            </Text>
          )}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#000000",
  },
  photo: {
    flex: 1,
    width: "100%",
    height: "100%",
  },
  loader: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    justifyContent: "center",
    alignItems: "center",
  },
  tapZone: {
    position: "absolute",
    top: 0,
    bottom: 0,
    width: "35%",
  },
  tapZoneLeft: {
    left: 0,
  },
  tapZoneRight: {
    right: 0,
  },
  iosBackButton: {
    position: "absolute",
    top: 50,
    left: 20,
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: "rgba(0, 0, 0, 0.7)",
    justifyContent: "center",
    alignItems: "center",
    zIndex: 1000,
  },
  infoPill: {
    position: "absolute",
    bottom: Platform.isTV ? 48 : 32,
    alignSelf: "center",
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    maxWidth: "70%",
    paddingHorizontal: 18,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: "rgba(28, 28, 30, 0.65)",
  },
  infoName: {
    flexShrink: 1,
    fontSize: Platform.isTV ? 22 : 15,
    color: "#FFFFFF",
  },
  infoCounter: {
    fontSize: Platform.isTV ? 20 : 14,
    color: "#98989D",
  },
  errorContainer: {
    flex: 1,
    backgroundColor: "#000000",
    justifyContent: "center",
    alignItems: "center",
    padding: 40,
    gap: 24,
  },
  errorTitle: {
    marginTop: 16,
    fontSize: 28,
    fontWeight: "700",
    color: "#FFFFFF",
    textAlign: "center",
  },
  errorText: {
    fontSize: 18,
    color: "#98989D",
    textAlign: "center",
    lineHeight: 26,
  },
  button: {
    minWidth: Platform.isTV ? 300 : 250,
  },
});
