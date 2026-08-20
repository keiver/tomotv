import { CloseOverlayButton } from "@/components/close-overlay-button";
import { FocusableButton } from "@/components/FocusableButton";
import { COLORS } from "@/constants/colors";
import { useLibraryFilters } from "@/contexts/LibraryFiltersContext";
import { getFolderCache } from "@/services/folderContentsCache";
import { fetchFilteredVideos, fetchFolderContents, getPhotoUrl, isPhoto } from "@/services/jellyfinApi";
import { countActiveFilters, JellyfinItem } from "@/types/jellyfin";
import { getLoadErrorMessage } from "@/utils/errorClassification";
import { logger } from "@/utils/logger";
import { Ionicons } from "@expo/vector-icons";
import { Image } from "expo-image";
import { useLocalSearchParams, useRouter } from "expo-router";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, BackHandler, Dimensions, Platform, Pressable, StyleSheet, Text, TouchableOpacity, useTVEventHandler, View } from "react-native";
import { Gesture, GestureDetector, GestureHandlerRootView } from "react-native-gesture-handler";
import Animated, { Easing, cancelAnimation, runOnJS, useAnimatedStyle, useReducedMotion, useSharedValue, withTiming } from "react-native-reanimated";

const SCREEN_WIDTH = Dimensions.get("window").width;
const SLIDE_DURATION_MS = 300;
const FADE_DURATION_MS = 650;
const SLIDESHOW_INTERVAL_MS = 5000;
const COUNTDOWN_WIDTH = 240;
// Drag-to-navigate: commit the step past this fraction of the screen, or on a flick
// faster than this (pt/s) in the reveal direction.
const DRAG_COMMIT_FRACTION = 0.35;
const DRAG_COMMIT_VELOCITY = 700;

/**
 * Style for one photo buffer. Front buffer slides in from the pressed direction (or fades in
 * during the slideshow); back buffer fades out underneath.
 */
function bufferLayerStyle(isFront: boolean, progressValue: number, direction: number, mode: number) {
  "worklet";
  if (isFront) {
    if (mode === 1) {
      return { opacity: 1, transform: [{ translateX: (1 - progressValue) * direction * SCREEN_WIDTH }] };
    }
    return { opacity: progressValue, transform: [{ translateX: 0 }] };
  }
  return { opacity: 1 - progressValue, transform: [{ translateX: 0 }] };
}

type BufferState = {
  index: number;
  imageA: JellyfinItem | null;
  imageB: JellyfinItem | null;
  frontIsA: boolean;
  mode: "slide" | "fade";
  transitionId: number; // 0 = initial photo, no transition to run
  // Drag-initiated step: the finger drives `progress`, so the commit effect must arm the
  // pan instead of running withTiming.
  interactive: boolean;
};

/**
 * Full-screen photo viewer for Jellyfin Photo items. Fed from the folder cache the user just
 * browsed (falls back to a fetch if the cache expired). Left/right steps photos with a slide,
 * play/pause or select toggles a slideshow that crossfades every 5s behind a countdown bar.
 * Menu pops the screen natively (no handler — this screen must stay a regular push, not a
 * modal, or TV remote events never reach it). On touch platforms the screen halves step and
 * dedicated buttons close / toggle the slideshow.
 *
 * Transitions are worklet-driven (shared values + withTiming) over TWO PERSISTENT buffer
 * layers that never remount. On Fabric a freshly mounted Animated.View renders its static
 * styles first and attaches the useAnimatedStyle node a frame later (reanimated #6865,
 * #7354), so any per-step remount flashes the incoming photo at rest before animating.
 * Stepping only mutates shared values (already-attached nodes, applied same-frame) and swaps
 * the hidden buffer's Image source. Layout animations (entering/exiting) are unreliable in
 * native-stack screens and are not used here.
 */
export default function PhotoViewerScreen() {
  const params = useLocalSearchParams<{ folderId: string; photoId: string; libraryId?: string }>();
  const router = useRouter();

  // Filters live on the entered library (the grid scopes them to crumbs[0]), so the viewer reads
  // the same selection the grid was showing when the photo was pressed.
  const { getFilters } = useLibraryFilters();
  const filters = getFilters(params.libraryId ?? params.folderId);
  const isFiltered = countActiveFilters(filters) > 0;

  const [photos, setPhotos] = useState<JellyfinItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [buffers, setBuffers] = useState<BufferState>({ index: 0, imageA: null, imageB: null, frontIsA: true, mode: "slide", transitionId: 0, interactive: false });
  const [isPlaying, setIsPlaying] = useState(false);
  // Reduce Motion: replace the screen-wide slide with a dissolve (Apple's recommended substitute)
  const reducedMotion = useReducedMotion();

  // Refs mirror state so remote-event callbacks never act on stale closures
  const photosRef = useRef<JellyfinItem[]>([]);
  const indexRef = useRef(0);
  const frontIsARef = useRef(true);
  const isPlayingRef = useRef(false);
  const advanceRef = useRef<() => void>(() => {});

  const progress = useSharedValue(1); // 0 → 1 per transition
  const directionSV = useSharedValue(1); // 1 = forward, -1 = backward
  const modeSV = useSharedValue(1); // 1 = slide, 0 = fade
  const frontSV = useSharedValue(0); // 0 = buffer A is the incoming/front layer, 1 = buffer B
  const countdown = useSharedValue(0); // 0 → 1 over the slideshow interval

  useEffect(() => {
    let cancelled = false;

    const applyPhotos = (items: JellyfinItem[]) => {
      const photoItems = items.filter(isPhoto);
      const start = photoItems.findIndex((p) => p.Id === params.photoId);
      photosRef.current = photoItems;
      indexRef.current = start >= 0 ? start : 0;
      frontIsARef.current = true;
      frontSV.set(0);
      progress.set(1);
      setPhotos(photoItems);
      setBuffers({ index: indexRef.current, imageA: photoItems[indexRef.current] ?? null, imageB: null, frontIsA: true, mode: "slide", transitionId: 0, interactive: false });
    };

    // Filtered: swipe the filtered set, not the folder. The folder cache is unfiltered by
    // definition (useFolderContents never caches a filtered view), so reading it here is what
    // put the whole library back under the user's thumb. Fetch the complete filtered set
    // instead — the same call the filtered play queue uses — and keep the photos.
    if (isFiltered) {
      fetchFilteredVideos(params.folderId, filters)
        .then((items) => {
          if (!cancelled) applyPhotos(items);
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
        setError(getLoadErrorMessage(err));
        logger.error("Error loading photos for viewer", err, { service: "PhotoViewer", folderId: params.folderId });
      });

    return () => {
      cancelled = true;
    };
    // filters is a fresh object per render from the context map; isFiltered + the ids are the
    // real inputs, and the selection can't change while this pushed screen is on top.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.folderId, params.photoId, isFiltered, frontSV, progress]);

  // Shared values first (already-attached style nodes apply them same-frame): the buffer
  // flipped to front is hidden before anything else changes, and the old front — now the
  // fading back layer — keeps showing the current photo untouched until the new source
  // commits. Nothing mounts, so the Fabric first-frame style gap can never flash.
  const stepTo = useCallback(
    (nextIndex: number, direction: 1 | -1, mode: "slide" | "fade", interactive = false) => {
      const list = photosRef.current;
      const prevIndex = indexRef.current;
      if (nextIndex === prevIndex || nextIndex < 0 || nextIndex >= list.length) return;
      indexRef.current = nextIndex;
      const nextFrontIsA = !frontIsARef.current;
      frontIsARef.current = nextFrontIsA;
      progress.set(0);
      directionSV.set(direction);
      modeSV.set(mode === "slide" ? 1 : 0);
      frontSV.set(nextFrontIsA ? 0 : 1);
      setBuffers((prev) => ({
        index: nextIndex,
        imageA: nextFrontIsA ? (list[nextIndex] ?? null) : prev.imageA,
        imageB: nextFrontIsA ? prev.imageB : (list[nextIndex] ?? null),
        frontIsA: nextFrontIsA,
        mode,
        transitionId: prev.transitionId + 1,
        interactive,
      }));
    },
    [directionSV, modeSV, progress, frontSV],
  );

  // Run the transition once the new source is committed into the (hidden) front buffer.
  // Interactive (drag) steps arm the pan instead: the front buffer must be committed before
  // the finger may pull it on screen, or the first frames would drag stale buffer content.
  const dragReady = useSharedValue(0);
  useEffect(() => {
    if (buffers.transitionId === 0) return;
    if (buffers.interactive) {
      dragReady.set(1);
      return;
    }
    progress.set(withTiming(1, { duration: buffers.mode === "slide" ? SLIDE_DURATION_MS : FADE_DURATION_MS }));
  }, [buffers, progress, dragReady]);

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
    stepTo((indexRef.current + 1) % list.length, 1, "fade");
    startCountdown();
  }, [stepTo, startCountdown]);

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

  const goStep = useCallback(
    (delta: 1 | -1) => {
      const next = indexRef.current + delta;
      if (next < 0 || next >= photosRef.current.length) return;
      stepTo(next, delta, reducedMotion ? "fade" : "slide");
      if (isPlayingRef.current) startCountdown();
    },
    [stepTo, startCountdown, reducedMotion],
  );

  // ── Drag-to-navigate (phone) ──────────────────────────────────────────────────────────────
  // The pan drives the SAME buffer transition the tap zones use: on activation the target photo
  // is committed into the hidden front buffer (stepTo, interactive), then the finger owns
  // `progress` (0 → 1 = fully revealed). Release commits past DRAG_COMMIT_FRACTION or on a
  // fast flick, else the front animates back off screen and the buffers flip back — that flip
  // runs inside the timing callback ON THE UI THREAD, because a JS-side flip of frontSV and
  // progress could render an intermediate frame with the next photo fully visible.
  const dragDirSV = useSharedValue<1 | -1>(1);
  const dragActiveRef = useRef(false);
  const dragDirectionRef = useRef<1 | -1>(1);

  const beginDrag = useCallback(
    (direction: 1 | -1) => {
      if (progress.get() !== 1) return; // a transition is still running; ignore this drag
      const next = indexRef.current + direction;
      if (next < 0 || next >= photosRef.current.length) return;
      dragActiveRef.current = true;
      dragDirectionRef.current = direction;
      dragDirSV.set(direction);
      if (isPlayingRef.current) cancelAnimation(countdown); // no auto-advance mid-drag
      stepTo(next, direction, "slide", true);
    },
    [progress, dragDirSV, countdown, stepTo],
  );

  // JS-side bookkeeping after a canceled drag's UI-thread buffer flip-back.
  const revertDragState = useCallback(() => {
    indexRef.current = indexRef.current - dragDirectionRef.current;
    frontIsARef.current = !frontIsARef.current;
    setBuffers((prev) => ({ ...prev, index: indexRef.current, frontIsA: frontIsARef.current, interactive: false }));
  }, []);

  const handleDragEnd = useCallback(
    (translationX: number, velocityX: number) => {
      if (!dragActiveRef.current) return; // pan activated but no target (at either end)
      dragActiveRef.current = false;
      dragReady.set(0);
      const direction = dragDirectionRef.current;
      const fraction = Math.min(Math.max((-translationX * direction) / SCREEN_WIDTH, 0), 1);
      const flick = -velocityX * direction; // + = toward reveal, - = back toward rest
      const commit = flick > DRAG_COMMIT_VELOCITY ? true : flick < -DRAG_COMMIT_VELOCITY ? false : fraction > DRAG_COMMIT_FRACTION;
      if (commit) {
        progress.set(withTiming(1, { duration: Math.max(80, SLIDE_DURATION_MS * (1 - fraction)) }));
        if (isPlayingRef.current) startCountdown();
      } else {
        progress.set(
          withTiming(0, { duration: Math.max(80, SLIDE_DURATION_MS * fraction) }, (finished) => {
            if (!finished) return;
            frontSV.set(frontSV.get() === 0 ? 1 : 0);
            progress.set(1);
            runOnJS(revertDragState)();
          }),
        );
        if (isPlayingRef.current) startCountdown();
      }
    },
    [dragReady, progress, frontSV, startCountdown, revertDragState],
  );

  // The gesture callbacks run on pan events, never during render; react-hooks/refs can't see
  // through RNGH's builder and flags the ref-reading JS handlers they dispatch to.
  const panGesture = React.useMemo(
    () =>
      Gesture.Pan()
        .activeOffsetX([-12, 12])
        .failOffsetY([-16, 16])
        // eslint-disable-next-line react-hooks/refs
        .onStart((e) => {
          "worklet";
          runOnJS(beginDrag)(e.translationX <= 0 ? 1 : -1);
        })
        .onUpdate((e) => {
          "worklet";
          if (dragReady.get() !== 1) return;
          progress.set(Math.min(Math.max((-e.translationX * dragDirSV.get()) / SCREEN_WIDTH, 0), 1));
        })
        // eslint-disable-next-line react-hooks/refs
        .onEnd((e) => {
          "worklet";
          runOnJS(handleDragEnd)(e.translationX, e.velocityX);
        }),
    [beginDrag, handleDragEnd, dragReady, dragDirSV, progress],
  );

  // Handle TV remote events. Menu is deliberately NOT handled: the native stack pops it.
  useTVEventHandler(
    useCallback(
      (evt: { eventType: string }) => {
        if (evt.eventType === "right" || evt.eventType === "swipeRight") {
          goStep(1);
        } else if (evt.eventType === "left" || evt.eventType === "swipeLeft") {
          goStep(-1);
        } else if (evt.eventType === "playPause") {
          toggleSlideshow();
        }
      },
      [goStep, toggleSlideshow],
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

  // Stop animations when leaving the screen
  useEffect(() => {
    return () => {
      cancelAnimation(countdown);
      cancelAnimation(progress);
    };
  }, [countdown, progress]);

  // Warm the neighbors so stepping feels instant
  useEffect(() => {
    [photos[buffers.index - 1], photos[buffers.index + 1]].forEach((photo) => {
      if (!photo) return;
      const url = getPhotoUrl(photo.Id);
      if (url) Image.prefetch(url);
    });
  }, [buffers.index, photos]);

  const layerAStyle = useAnimatedStyle(() => bufferLayerStyle(frontSV.value === 0, progress.value, directionSV.value, modeSV.value));
  const layerBStyle = useAnimatedStyle(() => bufferLayerStyle(frontSV.value === 1, progress.value, directionSV.value, modeSV.value));

  const countdownStyle = useAnimatedStyle(() => ({
    width: (1 - countdown.value) * COUNTDOWN_WIDTH,
  }));

  if (error) {
    return (
      <View style={styles.errorContainer}>
        <Ionicons name="alert-circle-outline" size={64} color={COLORS.DESTRUCTIVE} />
        <Text style={styles.errorTitle}>Unable to Load Photos</Text>
        <Text style={styles.errorText}>{error}</Text>
        <FocusableButton title="Go Back" onPress={() => router.back()} variant="secondary" style={styles.button} hasTVPreferredFocus={true} />
      </View>
    );
  }

  const current = photos[buffers.index];
  // getPhotoUrl returns "" until config is loaded; don't render an Image with an empty uri.
  const uriA = buffers.imageA ? getPhotoUrl(buffers.imageA.Id) : "";
  const uriB = buffers.imageB ? getPhotoUrl(buffers.imageB.Id) : "";

  const content = (
    <View style={styles.container}>
      {/* Persistent photo buffers: never remounted, only their sources swap. zIndex follows
          the role flip in the same commit as the source swap, so the incoming buffer always
          slides in ON TOP of the fading outgoing one. */}
      {uriA || uriB ? (
        <>
          <Animated.View style={[styles.photoLayer, { zIndex: buffers.frontIsA ? 2 : 1 }, layerAStyle]} pointerEvents="none">
            {uriA ? <Image source={{ uri: uriA }} style={styles.photo} contentFit="contain" /> : null}
          </Animated.View>
          <Animated.View style={[styles.photoLayer, { zIndex: buffers.frontIsA ? 1 : 2 }, layerBStyle]} pointerEvents="none">
            {uriB ? <Image source={{ uri: uriB }} style={styles.photo} contentFit="contain" /> : null}
          </Animated.View>
        </>
      ) : (
        <ActivityIndicator size="large" color={COLORS.TEXT_PRIMARY} style={styles.loader} />
      )}

      {/* Focus holder: keeps the tvOS focus engine on this screen; select toggles the slideshow
          (select is delivered as onPress to the focused view, never as a TV event). MUST sit
          above the zIndexed photo buffers: the focus engine treats a fully occluded view as
          non-focusable, and with nothing focusable UIKit drops every press unsent (menu too). */}
      {Platform.isTV && (
        <Pressable
          style={[StyleSheet.absoluteFill, styles.focusHolder]}
          isTVSelectable={true}
          hasTVPreferredFocus={true}
          onPress={toggleSlideshow}
          accessibilityRole="button"
          accessibilityLabel={current ? `Photo: ${current.Name}` : "Photo viewer"}
          accessibilityHint={isPlaying ? "Press select to pause the slideshow" : "Press select to start the slideshow"}
        />
      )}

      {/* Touch controls for phone */}
      {!Platform.isTV && (
        <>
          <Pressable style={[styles.tapZone, styles.tapZoneLeft]} onPress={() => goStep(-1)} accessibilityLabel="Previous photo" accessibilityRole="button" />
          <Pressable style={[styles.tapZone, styles.tapZoneRight]} onPress={() => goStep(1)} accessibilityLabel="Next photo" accessibilityRole="button" />
          <CloseOverlayButton style={styles.iosBackButton} onPress={() => router.back()} accessibilityHint="Close photo viewer and return to library" />
          <TouchableOpacity style={styles.iosPlayButton} onPress={toggleSlideshow} accessibilityLabel={isPlaying ? "Pause slideshow" : "Play slideshow"} accessibilityRole="button">
            <Ionicons name={isPlaying ? "pause" : "play"} size={26} color={COLORS.TEXT_PRIMARY} />
          </TouchableOpacity>
        </>
      )}

      {isPlaying && (
        <View style={styles.countdownTrack} pointerEvents="none">
          <Animated.View style={[styles.countdownFill, countdownStyle]} />
        </View>
      )}

      {current && (
        <View style={styles.infoPill} pointerEvents="none">
          {isPlaying && <Ionicons name="play" size={Platform.isTV ? 20 : 14} color={COLORS.ACCENT} />}
          <Text style={styles.infoName} numberOfLines={1}>
            {current.Name}
          </Text>
          {photos.length > 1 && (
            <Text style={styles.infoCounter}>
              {buffers.index + 1} / {photos.length}
            </Text>
          )}
        </View>
      )}
    </View>
  );

  // TV navigates by remote; the gesture tree (and RNGH's root view, mounted nowhere else in
  // the app) exists only on touch platforms.
  if (Platform.isTV) return content;
  return (
    <GestureHandlerRootView style={styles.container}>
      <GestureDetector gesture={panGesture}>{content}</GestureDetector>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.MEDIA_BACKGROUND,
  },
  photoLayer: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
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
  focusHolder: {
    zIndex: 5,
  },
  tapZone: {
    position: "absolute",
    top: 0,
    bottom: 0,
    width: "35%",
    zIndex: 5,
  },
  tapZoneLeft: {
    left: 0,
  },
  tapZoneRight: {
    right: 0,
  },
  // Placement only — the circle itself is CloseOverlayButton's.
  iosBackButton: {
    position: "absolute",
    top: 50,
    left: 20,
  },
  iosPlayButton: {
    position: "absolute",
    top: 50,
    right: 20,
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: "rgba(0, 0, 0, 0.7)",
    justifyContent: "center",
    alignItems: "center",
    zIndex: 1000,
  },
  countdownTrack: {
    position: "absolute",
    bottom: Platform.isTV ? 116 : 88,
    alignSelf: "center",
    width: COUNTDOWN_WIDTH,
    height: 4,
    borderRadius: 2,
    backgroundColor: "rgba(255, 255, 255, 0.2)",
    overflow: "hidden",
    zIndex: 10,
  },
  countdownFill: {
    height: "100%",
    borderRadius: 2,
    backgroundColor: COLORS.ACCENT,
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
    zIndex: 10,
  },
  infoName: {
    flexShrink: 1,
    fontSize: Platform.isTV ? 22 : 15,
    color: COLORS.TEXT_PRIMARY,
  },
  infoCounter: {
    fontSize: Platform.isTV ? 20 : 14,
    color: COLORS.TEXT_SECONDARY,
  },
  errorContainer: {
    flex: 1,
    backgroundColor: COLORS.MEDIA_BACKGROUND,
    justifyContent: "center",
    alignItems: "center",
    padding: 40,
    gap: 24,
  },
  errorTitle: {
    marginTop: 16,
    fontSize: 28,
    fontWeight: "700",
    color: COLORS.TEXT_PRIMARY,
    textAlign: "center",
  },
  errorText: {
    fontSize: 18,
    color: COLORS.TEXT_SECONDARY,
    textAlign: "center",
    lineHeight: 26,
  },
  button: {
    minWidth: Platform.isTV ? 300 : 250,
  },
});
