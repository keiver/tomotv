import { FocusableButton } from "@/components/FocusableButton";
import { GlassSurface } from "@/components/glass-surface";
import { INFO_PILL_RADIUS, PageViewer, VIEWER_CHROME_TINT, pageViewerStyles, type PageViewerHandle } from "@/components/page-viewer";
import { COLORS } from "@/constants/colors";
import { useLibraryFilters } from "@/contexts/LibraryFiltersContext";
import { getFolderCache } from "@/services/folderContentsCache";
import { fetchFolderPhotos, fetchFilteredVideos, fetchItemDetails, fetchRecursivePhotos, getPhotoPreviewUrl, getPhotoUrl, isPhoto } from "@/services/jellyfinApi";
import { countActiveFilters, JellyfinItem } from "@/types/jellyfin";
import { getLoadErrorMessage } from "@/utils/errorClassification";
import { logger } from "@/utils/logger";
import { Ionicons } from "@expo/vector-icons";
import { Image } from "expo-image";
import { useLocalSearchParams, useRouter } from "expo-router";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, BackHandler, Platform, StyleSheet, Text, View } from "react-native";
import Animated, { Easing, cancelAnimation, runOnJS, useAnimatedStyle, useSharedValue, withTiming } from "react-native-reanimated";
import { t } from "@/services/i18n";

const SLIDESHOW_INTERVAL_MS = 5000;
const COUNTDOWN_WIDTH = 240;
const COUNTDOWN_HEIGHT = 8;
const COUNTDOWN_FILL_INSET = 2;

/** JPEG unless the file may animate: a PNG source otherwise comes back as PNG, 4.1 MB against 0.84 MB. */
const fullPhotoUrl = (photo: JellyfinItem) => getPhotoUrl(photo.Id, undefined, photo.Path && !/\.gif$/i.test(photo.Path) ? "Jpg" : undefined);

/**
 * Full-screen photo viewer for Jellyfin Photo items. Fed from the folder cache the user just
 * browsed (falls back to a fetch if the cache expired). The page viewer steps and zooms;
 * play/pause or select toggles a slideshow that crossfades every 5s behind a countdown bar.
 */
export default function PhotoViewerScreen() {
  // recursive: sweep the whole subtree instead of the folder's own children, and start at its
  // first photo (no photoId). slideshow: start playing as soon as they land. Both come from the
  // info panel's Slideshow CTA, which is offered off a recursive count.
  // folderId is absent when the photo was opened off a shelf card that carries no ParentId;
  // the viewer then holds that one photo.
  const params = useLocalSearchParams<{ folderId?: string; photoId?: string; libraryId?: string; recursive?: string; slideshow?: string }>();
  const router = useRouter();

  // Filters live on the entered library (the grid scopes them to crumbs[0]), so the viewer reads
  // the same selection the grid was showing when the photo was pressed.
  const { getFilters } = useLibraryFilters();
  const filters = getFilters(params.libraryId ?? params.folderId ?? "");
  const isFiltered = countActiveFilters(filters) > 0;

  const [photos, setPhotos] = useState<JellyfinItem[]>([]);
  const [startIndex, setStartIndex] = useState<number | null>(null);
  const [index, setIndex] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);

  // Refs mirror state so remote-event callbacks never act on stale closures
  const photosRef = useRef<JellyfinItem[]>([]);
  const isPlayingRef = useRef(false);
  const viewerRef = useRef<PageViewerHandle>(null);
  const advanceRef = useRef<() => void>(() => {});

  const countdown = useSharedValue(0); // 0 → 1 over the slideshow interval

  useEffect(() => {
    let cancelled = false;

    const applyPhotos = (items: JellyfinItem[]) => {
      const photoItems = items.filter(isPhoto);
      const start = photoItems.findIndex((p) => p.Id === params.photoId);
      photosRef.current = photoItems;
      setPhotos(photoItems);
      setStartIndex(start >= 0 ? start : 0);
      setIndex(start >= 0 ? start : 0);
      return start >= 0;
    };

    // The set answered without the photo that was pressed. Opening its index 0 shows a
    // DIFFERENT photo, so the pressed one is fetched and stands alone instead.
    const openRequestedAlone = () => {
      if (!params.photoId) return;
      fetchItemDetails(params.photoId)
        .then((item) => {
          if (!cancelled) applyPhotos(item ? [item] : []);
        })
        .catch((err) => {
          if (cancelled) return;
          setError(getLoadErrorMessage(err));
          logger.error("Error loading photo for viewer", err, { service: "PhotoViewer", photoId: params.photoId });
        });
    };

    // Re-seat the shown photo in a wider list without disturbing the viewer: the cache paints
    // one page, the folder sweep that follows it holds every photo.
    const widenPhotos = (items: JellyfinItem[]) => {
      const photoItems = items.filter(isPhoto);
      const shownId = photosRef.current[viewerRef.current?.index() ?? 0]?.Id;
      const next = photoItems.findIndex((p) => p.Id === shownId);
      if (next < 0) {
        if (!applyPhotos(items)) openRequestedAlone();
        return;
      }
      photosRef.current = photoItems;
      setPhotos(photoItems);
      if (next !== (viewerRef.current?.index() ?? 0)) {
        viewerRef.current?.goTo(next, 1, "fade");
      }
    };

    // No folder to step through: the shelf card that opened this carried no ParentId, so the
    // set is the photo itself.
    if (!params.folderId) {
      openRequestedAlone();

      return () => {
        cancelled = true;
      };
    }

    const folderId = params.folderId;

    // Filtered: swipe the filtered set, not the folder. The folder cache is unfiltered by
    // definition (useFolderContents never caches a filtered view), so reading it here is what
    // put the whole library back under the user's thumb. Fetch the complete filtered set
    // instead, the same call the filtered play queue uses, and keep the photos.
    if (isFiltered) {
      fetchFilteredVideos(folderId, filters)
        .then((items) => {
          if (!cancelled && !applyPhotos(items) && params.photoId) openRequestedAlone();
        })
        .catch((err) => {
          if (cancelled) return;
          setError(getLoadErrorMessage(err));
          logger.error("Error loading filtered photos for viewer", err, { service: "PhotoViewer", folderId: params.folderId });
        });

      return () => {
        cancelled = true;
      };
    }

    // Recursive: the folder's own children are only part of the set, a photo library keeps
    // most of its photos inside albums, and the CTA that opened this was offered off the
    // recursive count. The folder cache holds direct children, so it is skipped here.
    if (params.recursive === "true") {
      fetchRecursivePhotos(folderId)
        .then((items) => {
          if (!cancelled && !applyPhotos(items) && params.photoId) openRequestedAlone();
        })
        .catch((err) => {
          if (cancelled) return;
          setError(getLoadErrorMessage(err));
          logger.error("Error loading photos for viewer", err, { service: "PhotoViewer", folderId: params.folderId });
        });

      return () => {
        cancelled = true;
      };
    }

    // The folder screen that pushed this route already fetched the items; even a stale cache
    // entry is the exact list the user was just looking at, so it paints frame one. It holds
    // the pages the grid had loaded, never the whole folder, so the sweep still runs.
    const cached = getFolderCache(folderId);
    let painted = false;
    if (cached && cached.items.some((item) => item.Id === params.photoId)) {
      applyPhotos(cached.items);
      painted = true;
    }

    fetchFolderPhotos(folderId)
      .then((items) => {
        if (!cancelled) widenPhotos(items);
      })
      .catch((err) => {
        if (cancelled) return;
        if (!painted) setError(getLoadErrorMessage(err));
        logger.error("Error loading photos for viewer", err, { service: "PhotoViewer", folderId });
      });

    return () => {
      cancelled = true;
    };
    // filters is a fresh object per render from the context map; isFiltered + the ids are the
    // real inputs, and the selection can't change while this pushed screen is on top.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.folderId, params.photoId, params.recursive, isFiltered]);

  // Single clock: the countdown drives both the visual bar and the auto-advance
  const callAdvance = useCallback(() => advanceRef.current(), []);

  const startCountdown = useCallback(() => {
    countdown.set(0);
    countdown.set(
      withTiming(1, { duration: SLIDESHOW_INTERVAL_MS, easing: Easing.linear }, (finished) => {
        if (finished) runOnJS(callAdvance)();
      }),
    );
  }, [countdown, callAdvance]);

  const advance = useCallback(() => {
    const list = photosRef.current;
    if (!isPlayingRef.current || list.length < 2) return;
    const current = viewerRef.current?.index() ?? 0;
    viewerRef.current?.goTo((current + 1) % list.length, 1, "fade");
    startCountdown();
  }, [startCountdown]);

  useEffect(() => {
    advanceRef.current = advance;
  }, [advance]);

  const toggleSlideshow = useCallback(() => {
    if (isPlayingRef.current) {
      isPlayingRef.current = false;
      setIsPlaying(false);
      cancelAnimation(countdown);
      countdown.set(0);
    } else {
      if (photosRef.current.length < 2) return;
      isPlayingRef.current = true;
      setIsPlaying(true);
      startCountdown();
    }
  }, [countdown, startCountdown]);

  // Arrived from the Slideshow CTA: start once the photos are in, and never again, the
  // pause button owns it from then on.
  const autoStarted = useRef(false);
  useEffect(() => {
    if (params.slideshow !== "true" || autoStarted.current || photos.length < 2) return;
    autoStarted.current = true;
    toggleSlideshow();
  }, [params.slideshow, photos.length, toggleSlideshow]);

  const leaveViewer = useCallback(() => router.back(), [router]);

  // A step by the user restarts the slideshow clock.
  const handleIndexChange = useCallback(
    (next: number) => {
      setIndex(next);
      if (isPlayingRef.current) startCountdown();
    },
    [startCountdown],
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

  // Stop animations when leaving the screen
  useEffect(() => {
    return () => {
      cancelAnimation(countdown);
    };
  }, [countdown]);

  // Warm the neighbors, previews first, so stepping lands on a picture
  useEffect(() => {
    const neighbors = [photos[index - 1], photos[index + 1]].filter((photo): photo is JellyfinItem => !!photo);
    const urls = [...neighbors.map((photo) => getPhotoPreviewUrl(photo.Id)), ...neighbors.map(fullPhotoUrl)].filter(Boolean);
    if (urls.length) Image.prefetch(urls);
  }, [index, photos]);

  const countdownStyle = useAnimatedStyle(() => ({
    // Minus the fill's own inset on both sides, so a full bar stops inside the pill.
    width: (1 - countdown.value) * (COUNTDOWN_WIDTH - 2 * COUNTDOWN_FILL_INSET),
  }));

  // getPhotoUrl returns "" until config is loaded; the viewer shows its spinner for "".
  const uriAt = useCallback((at: number) => (photos[at] ? fullPhotoUrl(photos[at]) : ""), [photos]);
  const previewAt = useCallback((at: number) => (photos[at] ? getPhotoPreviewUrl(photos[at].Id) : ""), [photos]);

  if (error) {
    return (
      <View style={pageViewerStyles.errorContainer}>
        <Ionicons name="alert-circle-outline" size={64} color={COLORS.DESTRUCTIVE} />
        <Text style={pageViewerStyles.errorTitle}>{t("photos.unableToLoad")}</Text>
        <Text style={pageViewerStyles.errorText}>{error}</Text>
        <FocusableButton title={t("common.goBack")} onPress={() => router.back()} variant="secondary" style={pageViewerStyles.button} hasTVPreferredFocus={true} />
      </View>
    );
  }

  const current = photos[index];

  const overlay = (
    <>
      {isPlaying && (
        <GlassSurface style={styles.countdownTrack} radius={COUNTDOWN_HEIGHT / 2} tintColor={VIEWER_CHROME_TINT} pointerEvents="none">
          <Animated.View style={[styles.countdownFill, countdownStyle]} />
        </GlassSurface>
      )}

      {current && (
        <GlassSurface style={pageViewerStyles.infoPill} radius={INFO_PILL_RADIUS} tintColor={VIEWER_CHROME_TINT} pointerEvents="none">
          {isPlaying && <Ionicons name="play" size={Platform.isTV ? 20 : 14} color={COLORS.ACCENT} />}
          <Text style={pageViewerStyles.infoName} numberOfLines={1}>
            {current.Name}
          </Text>
          {photos.length > 1 && (
            <Text style={pageViewerStyles.infoCounter}>
              {index + 1} / {photos.length}
            </Text>
          )}
        </GlassSurface>
      )}
    </>
  );

  // The viewer mounts once the set is known: its initial index is fixed at mount.
  if (startIndex === null) {
    return (
      <View style={[styles.container, styles.loading]}>
        <ActivityIndicator size="large" color={COLORS.TEXT_PRIMARY} />
      </View>
    );
  }

  return (
    <PageViewer
      ref={viewerRef}
      pages={photos.length}
      uriAt={uriAt}
      previewAt={previewAt}
      initialIndex={startIndex}
      onIndexChange={handleIndexChange}
      onLeave={leaveViewer}
      onSelect={toggleSlideshow}
      onPlayPause={toggleSlideshow}
      actions={[{ key: "slideshow", icon: isPlaying ? "pause" : "play", label: isPlaying ? t("photos.pauseSlideshow") : t("photos.playSlideshow"), onPress: toggleSlideshow }]}
      triggerLabel={t("photos.photoActions")}
      overlay={overlay}
      zoomMode="image"
      accessibilityLabel={current ? t("photos.photoName").replace("{name}", current.Name) : t("photos.photoViewer")}
      accessibilityHint={isPlaying ? t("photos.pressToPause") : t("photos.pressToStart")}
      previousLabel={t("photos.previous")}
      nextLabel={t("photos.next")}
      keyOwner="photo-viewer"
    />
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.MEDIA_BACKGROUND,
  },
  loading: {
    alignItems: "center",
    justifyContent: "center",
  },
  countdownTrack: {
    position: "absolute",
    bottom: Platform.isTV ? 116 : 88,
    alignSelf: "center",
    width: COUNTDOWN_WIDTH,
    height: COUNTDOWN_HEIGHT,
    justifyContent: "center",
    zIndex: 10,
  },
  countdownFill: {
    height: COUNTDOWN_HEIGHT - 2 * COUNTDOWN_FILL_INSET,
    marginHorizontal: COUNTDOWN_FILL_INSET,
    borderRadius: COUNTDOWN_FILL_INSET,
    backgroundColor: COLORS.ACCENT,
  },
});
