import { FocusableButton } from "@/components/FocusableButton";
import { GlassActionCluster } from "@/components/glass-action-cluster";
import { GlassSurface } from "@/components/glass-surface";
import { leavingByPan } from "@/components/dismiss-pan";
import { COLORS } from "@/constants/colors";
import { useLibraryFilters } from "@/contexts/LibraryFiltersContext";
import { getFolderCache } from "@/services/folderContentsCache";
import { fetchFolderPhotos, fetchFilteredVideos, fetchItemDetails, fetchRecursivePhotos, getPhotoUrl, isPhoto } from "@/services/jellyfinApi";
import { countActiveFilters, JellyfinItem } from "@/types/jellyfin";
import { getLoadErrorMessage } from "@/utils/errorClassification";
import { claimMacContextKeys, subscribeMacKeyCommand } from "@/services/macKeyCommands";
import { logger } from "@/utils/logger";
import { Ionicons } from "@expo/vector-icons";
import { Image } from "expo-image";
import { useLocalSearchParams, useRouter } from "expo-router";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, BackHandler, Platform, Pressable, StyleSheet, Text, useTVEventHandler, useWindowDimensions, View } from "react-native";
import { Gesture, GestureDetector, GestureHandlerRootView } from "react-native-gesture-handler";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Animated, { Easing, cancelAnimation, runOnJS, useAnimatedStyle, useReducedMotion, useSharedValue, withTiming } from "react-native-reanimated";

const SLIDE_DURATION_MS = 300;
const MAX_ZOOM = 6;
const DOUBLE_TAP_ZOOM = 2.5;
const ZOOM_DURATION_MS = 220;
// Chrome auto-hide: the close and slideshow buttons ride the viewer's activity, so a still
// photo is shown whole and a moved pointer or any press brings them straight back.
const CHROME_HIDE_DELAY_MS = 2600;
const CHROME_FADE_MS = 260;
const FADE_DURATION_MS = 650;
const SLIDESHOW_INTERVAL_MS = 5000;
const COUNTDOWN_WIDTH = 240;
const COUNTDOWN_HEIGHT = 8;
const COUNTDOWN_FILL_INSET = 2;
const INFO_PILL_RADIUS = 999;
/** One material for every piece of viewer chrome, matching GlassIconButton's. */
const CHROME_TINT = "rgba(18, 18, 20, 0.30)";
/** The cluster's gap from the safe area, the same on both axes. */
const CHROME_INSET = 20;
// Drag-to-navigate: commit the step past this fraction of the screen, or on a flick
// faster than this (pt/s) in the reveal direction.
const DRAG_COMMIT_FRACTION = 0.35;
const DRAG_COMMIT_VELOCITY = 700;

/**
 * Keep the zoomed photo's pan inside the screen box: a scale of s can travel half the screen
 * per unit of scale before its edge crosses the middle.
 */
function clampTranslate(value: number, scale: number, extent: number) {
  "worklet";
  const limit = Math.max(0, ((scale - 1) * extent) / 2);
  return Math.min(Math.max(value, -limit), limit);
}

/**
 * Style for one photo buffer. Front buffer slides in from the pressed direction (or fades in
 * during the slideshow); back buffer fades out underneath.
 */
function bufferLayerStyle(isFront: boolean, progressValue: number, direction: number, mode: number, width: number) {
  "worklet";
  if (isFront) {
    if (mode === 1) {
      return { opacity: 1, transform: [{ translateX: (1 - progressValue) * direction * width }] };
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
 * modal, or TV remote events never reach it). On touch platforms a drag steps the photo and
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
  // recursive: sweep the whole subtree instead of the folder's own children, and start at its
  // first photo (no photoId). slideshow: start playing as soon as they land. Both come from the
  // info panel's Slideshow CTA, which is offered off a recursive count.
  // folderId is absent when the photo was opened off a shelf card that carries no ParentId;
  // the viewer then holds that one photo.
  const params = useLocalSearchParams<{ folderId?: string; photoId?: string; libraryId?: string; recursive?: string; slideshow?: string }>();
  const router = useRouter();

  // Filters live on the entered library (the grid scopes them to crumbs[0]), so the viewer reads
  // the same selection the grid was showing when the photo was pressed.
  const insets = useSafeAreaInsets();
  const { getFilters } = useLibraryFilters();
  const filters = getFilters(params.libraryId ?? params.folderId ?? "");
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

  // Free zoom (phone). Screen-space transform over both buffers, so a step out of a zoom
  // resets it rather than carrying the crop onto the next photo.
  const zoomScale = useSharedValue(1);
  const zoomTx = useSharedValue(0);
  const zoomTy = useSharedValue(0);
  const savedScale = useSharedValue(1);
  const savedTx = useSharedValue(0);
  const savedTy = useSharedValue(0);
  const focalX = useSharedValue(0);
  const focalY = useSharedValue(0);
  // 1 = the pan is moving a zoomed photo, 0 = it is dragging to the next one.
  const panMode = useSharedValue(0);
  // Mirrors zoomScale > 1 on the JS side: the pan's activation offsets are build-time config,
  // and a zoomed photo has to pan vertically too.
  const [zoomed, setZoomed] = useState(false);

  // The zoom clamps and the double tap's focal point measure against the CURRENT viewport.
  // Every geometry the slide and the zoom measure against. Read live, not from Dimensions at
  // module load, which after a rotation describes the axis the screen no longer has.
  const { width: viewportWidth, height: viewportHeight } = useWindowDimensions();
  const viewportW = useSharedValue(viewportWidth);
  const viewportH = useSharedValue(viewportHeight);
  useEffect(() => {
    viewportW.set(viewportWidth);
    viewportH.set(viewportHeight);
  }, [viewportWidth, viewportHeight, viewportW, viewportH]);

  // Opacity animates on the UI thread; the mirror is what takes the faded-out buttons out of
  // the touch path, flipped only once the fade has finished.
  const chromeOpacity = useSharedValue(1);
  const [chromeVisible, setChromeVisible] = useState(true);
  const chromeHideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // The cluster's open state, mirrored in a shared value so the idle timer can read it without
  // being rebuilt every time the menu opens.
  const [actionsOpen, setActionsOpen] = useState(false);
  const actionsOpenSV = useSharedValue(false);

  const armChromeHide = useCallback(() => {
    if (chromeHideTimer.current) clearTimeout(chromeHideTimer.current);
    chromeHideTimer.current = setTimeout(() => {
      if (actionsOpenSV.get()) return; // an open menu holds the chrome up
      chromeOpacity.set(
        withTiming(0, { duration: CHROME_FADE_MS }, (finished) => {
          if (finished) runOnJS(setChromeVisible)(false);
        }),
      );
    }, CHROME_HIDE_DELAY_MS);
  }, [chromeOpacity, actionsOpenSV]);

  const revealChrome = useCallback(() => {
    if (chromeOpacity.get() !== 1) {
      setChromeVisible(true);
      chromeOpacity.set(withTiming(1, { duration: CHROME_FADE_MS }));
    }
    armChromeHide();
  }, [chromeOpacity, armChromeHide]);

  // Closing the menu restarts the idle clock the open menu was holding.
  const setActionsExpanded = useCallback(
    (open: boolean) => {
      actionsOpenSV.set(open);
      setActionsOpen(open);
      if (!open) revealChrome();
    },
    [actionsOpenSV, revealChrome],
  );

  useEffect(() => {
    if (Platform.isTV) return;
    armChromeHide();
    return () => {
      if (chromeHideTimer.current) clearTimeout(chromeHideTimer.current);
    };
  }, [armChromeHide]);

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

    // Re-seat the shown photo in a wider list without disturbing the buffers: the cache paints
    // one page, the folder sweep that follows it holds every photo.
    const widenPhotos = (items: JellyfinItem[]) => {
      const photoItems = items.filter(isPhoto);
      const shownId = photosRef.current[indexRef.current]?.Id;
      const next = photoItems.findIndex((p) => p.Id === shownId);
      if (next < 0) {
        if (!applyPhotos(items)) openRequestedAlone();
        return;
      }
      photosRef.current = photoItems;
      indexRef.current = next;
      setPhotos(photoItems);
      setBuffers((prev) => ({ ...prev, index: next }));
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
    // instead — the same call the filtered play queue uses — and keep the photos.
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
  }, [params.folderId, params.photoId, params.recursive, isFiltered, frontSV, progress]);

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
      zoomScale.set(1);
      zoomTx.set(0);
      zoomTy.set(0);
      setZoomed(false);
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
    [directionSV, modeSV, progress, frontSV, zoomScale, zoomTx, zoomTy],
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

  // Arrived from the Slideshow CTA: start once the photos are in, and never again, the
  // pause button owns it from then on.
  const autoStarted = useRef(false);
  useEffect(() => {
    if (params.slideshow !== "true" || autoStarted.current || photos.length < 2) return;
    autoStarted.current = true;
    toggleSlideshow();
  }, [params.slideshow, photos.length, toggleSlideshow]);

  const leaveViewer = useCallback(() => router.back(), [router]);

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
      const fraction = Math.min(Math.max((-translationX * direction) / viewportWidth, 0), 1);
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
    [dragReady, progress, frontSV, startCountdown, revertDragState, viewportWidth],
  );

  // ── Zoom (phone) ──────────────────────────────────────────────────────────────────────────
  // Pinch anchors on the focal point: the content coordinate under the fingers stays under
  // them (screen = translate + scale * content). Double tap zooms to the tapped point, or
  // resets when already zoomed.
  const resetZoom = useCallback(() => {
    "worklet";
    zoomScale.set(withTiming(1, { duration: ZOOM_DURATION_MS }));
    zoomTx.set(withTiming(0, { duration: ZOOM_DURATION_MS }));
    zoomTy.set(withTiming(0, { duration: ZOOM_DURATION_MS }));
    runOnJS(setZoomed)(false);
  }, [zoomScale, zoomTx, zoomTy]);

  const pinchGesture = React.useMemo(
    () =>
      Gesture.Pinch()
        .onStart((e) => {
          "worklet";
          savedScale.set(zoomScale.get());
          savedTx.set(zoomTx.get());
          savedTy.set(zoomTy.get());
          focalX.set(e.focalX - viewportW.get() / 2);
          focalY.set(e.focalY - viewportH.get() / 2);
        })
        .onUpdate((e) => {
          "worklet";
          const base = savedScale.get();
          const next = Math.min(Math.max(base * e.scale, 1), MAX_ZOOM);
          const ratio = next / base;
          zoomScale.set(next);
          zoomTx.set(clampTranslate(focalX.get() - ratio * (focalX.get() - savedTx.get()), next, viewportW.get()));
          zoomTy.set(clampTranslate(focalY.get() - ratio * (focalY.get() - savedTy.get()), next, viewportH.get()));
        })
        .onEnd(() => {
          "worklet";
          if (zoomScale.get() <= 1.01) {
            resetZoom();
            return;
          }
          runOnJS(setZoomed)(true);
        }),
    [zoomScale, zoomTx, zoomTy, savedScale, savedTx, savedTy, focalX, focalY, resetZoom, viewportW, viewportH],
  );

  const doubleTapGesture = React.useMemo(
    () =>
      Gesture.Tap()
        .numberOfTaps(2)
        .maxDuration(280)
        // eslint-disable-next-line react-hooks/refs
        .onEnd((e) => {
          "worklet";
          runOnJS(revealChrome)();
          if (zoomScale.get() > 1) {
            resetZoom();
            return;
          }
          const fx = e.x - viewportW.get() / 2;
          const fy = e.y - viewportH.get() / 2;
          const timing = { duration: ZOOM_DURATION_MS };
          zoomScale.set(withTiming(DOUBLE_TAP_ZOOM, timing));
          zoomTx.set(withTiming(clampTranslate(-fx * (DOUBLE_TAP_ZOOM - 1), DOUBLE_TAP_ZOOM, viewportW.get()), timing));
          zoomTy.set(withTiming(clampTranslate(-fy * (DOUBLE_TAP_ZOOM - 1), DOUBLE_TAP_ZOOM, viewportH.get()), timing));
          runOnJS(setZoomed)(true);
        }),
    [zoomScale, zoomTx, zoomTy, resetZoom, revealChrome, viewportW, viewportH],
  );

  // A tap only wakes the chrome. Stepping by tap is gone from touch: it read the SIDE the
  // finger was on rather than the way it travelled, and it ran simultaneously with the pan,
  // so a short drag in the left third went backwards however it was dragged. Dragging is the
  // gesture here; the remote keeps its own left and right on tvOS, which renders no gestures.
  const wakeTapGesture = React.useMemo(
    () =>
      Gesture.Tap()
        .numberOfTaps(1)
        // eslint-disable-next-line react-hooks/refs
        .onEnd(() => {
          "worklet";
          runOnJS(revealChrome)();
        }),
    [revealChrome],
  );

  // The gesture callbacks run on pan events, never during render; react-hooks/refs can't see
  // through RNGH's builder and flags the ref-reading JS handlers they dispatch to.
  const panGesture = React.useMemo(() => {
    const pan = Gesture.Pan();
    // Drag-to-navigate is horizontal only; a zoomed photo pans in both axes from the first pixel.
    if (!zoomed) pan.activeOffsetX([-12, 12]).failOffsetY([-16, 16]);
    return (
      pan
        // eslint-disable-next-line react-hooks/refs
        .onStart((e) => {
          "worklet";
          runOnJS(revealChrome)();
          if (zoomScale.get() > 1) {
            panMode.set(1);
            savedTx.set(zoomTx.get());
            savedTy.set(zoomTy.get());
            return;
          }
          panMode.set(0);
          runOnJS(beginDrag)(e.translationX <= 0 ? 1 : -1);
        })
        .onUpdate((e) => {
          "worklet";
          if (panMode.get() === 1) {
            const scale = zoomScale.get();
            zoomTx.set(clampTranslate(savedTx.get() + e.translationX, scale, viewportW.get()));
            zoomTy.set(clampTranslate(savedTy.get() + e.translationY, scale, viewportH.get()));
            return;
          }
          if (dragReady.get() !== 1) return;
          progress.set(Math.min(Math.max((-e.translationX * dragDirSV.get()) / viewportW.get(), 0), 1));
        })
        // eslint-disable-next-line react-hooks/refs
        .onEnd((e) => {
          "worklet";
          if (panMode.get() === 1) return;
          runOnJS(handleDragEnd)(e.translationX, e.velocityX);
        })
    );
  }, [zoomed, beginDrag, handleDragEnd, dragReady, dragDirSV, progress, panMode, zoomScale, zoomTx, zoomTy, savedTx, savedTy, revealChrome, viewportW, viewportH]);

  // Drag down to leave, on the same rule the player's own dismiss uses (leavingByPan): past a
  // distance, or a flick that also covered ground. Vertical only, so it and the horizontal step
  // drag can never both claim one movement, and a zoomed photo keeps its pan instead.
  const dismissY = useSharedValue(0);
  const dismissPanGesture = React.useMemo(
    () =>
      Gesture.Pan()
        .activeOffsetY(24)
        .failOffsetX([-20, 20])
        .onUpdate((e) => {
          "worklet";
          if (zoomScale.get() > 1) return;
          dismissY.set(Math.max(0, e.translationY));
        })
        .onEnd((e, success) => {
          "worklet";
          // Settle back on every end but a real departure. A pinch landing mid-drag takes the
          // zoom above 1, and an early return there left the photo standing off centre.
          if (zoomScale.get() <= 1 && leavingByPan(e, success)) {
            runOnJS(leaveViewer)();
            return;
          }
          dismissY.set(withTiming(0, { duration: 160 }));
        }),
    [dismissY, zoomScale, leaveViewer],
  );

  const photoGesture = React.useMemo(
    () => Gesture.Simultaneous(pinchGesture, Gesture.Race(panGesture, dismissPanGesture), Gesture.Exclusive(doubleTapGesture, wakeTapGesture)),
    [pinchGesture, panGesture, dismissPanGesture, doubleTapGesture, wakeTapGesture],
  );

  // Mac hardware keyboard: the bare arrows step the photo, claimed only while this screen is
  // up so a grid keeps its own arrow scrolling. Off a Mac both calls are no-ops.
  useEffect(() => {
    const release = claimMacContextKeys("photo-viewer", "photo");
    const unsubscribe = subscribeMacKeyCommand((key) => {
      if (key !== "previousPhoto" && key !== "nextPhoto") return;
      revealChrome();
      goStep(key === "nextPhoto" ? 1 : -1);
    });
    return () => {
      unsubscribe();
      release();
    };
  }, [goStep, revealChrome]);

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

  const layerAStyle = useAnimatedStyle(() => bufferLayerStyle(frontSV.value === 0, progress.value, directionSV.value, modeSV.value, viewportW.value));
  const layerBStyle = useAnimatedStyle(() => bufferLayerStyle(frontSV.value === 1, progress.value, directionSV.value, modeSV.value, viewportW.value));

  const countdownStyle = useAnimatedStyle(() => ({
    // Minus the fill's own inset on both sides, so a full bar stops inside the pill.
    width: (1 - countdown.value) * (COUNTDOWN_WIDTH - 2 * COUNTDOWN_FILL_INSET),
  }));

  const chromeStyle = useAnimatedStyle(() => ({ opacity: chromeOpacity.value }));

  const dismissStyle = useAnimatedStyle(() => ({ transform: [{ translateY: dismissY.value }] }));

  // translate after scale: the photo scales about its centre, then the pan offsets it.
  const zoomStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: zoomTx.value }, { translateY: zoomTy.value }, { scale: zoomScale.value }],
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

  /* Persistent photo buffers: never remounted, only their sources swap. zIndex follows the
     role flip in the same commit as the source swap, so the incoming buffer always slides in
     ON TOP of the fading outgoing one. */
  const photoStack =
    uriA || uriB ? (
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
    );

  const overlays = (
    <>
      {isPlaying && (
        <GlassSurface style={styles.countdownTrack} radius={COUNTDOWN_HEIGHT / 2} tintColor={CHROME_TINT} pointerEvents="none">
          <Animated.View style={[styles.countdownFill, countdownStyle]} />
        </GlassSurface>
      )}

      {current && (
        <GlassSurface style={styles.infoPill} radius={INFO_PILL_RADIUS} tintColor={CHROME_TINT} pointerEvents="none">
          {isPlaying && <Ionicons name="play" size={Platform.isTV ? 20 : 14} color={COLORS.ACCENT} />}
          <Text style={styles.infoName} numberOfLines={1}>
            {current.Name}
          </Text>
          {photos.length > 1 && (
            <Text style={styles.infoCounter}>
              {buffers.index + 1} / {photos.length}
            </Text>
          )}
        </GlassSurface>
      )}
    </>
  );

  // TV navigates by remote; the gesture tree (and RNGH's root view, mounted nowhere else in
  // the app) exists only on touch platforms.
  if (Platform.isTV) {
    return (
      <View style={styles.container}>
        {photoStack}
        {/* Focus holder: keeps the tvOS focus engine on this screen; select toggles the slideshow
            (select is delivered as onPress to the focused view, never as a TV event). MUST sit
            above the zIndexed photo buffers: the focus engine treats a fully occluded view as
            non-focusable, and with nothing focusable UIKit drops every press unsent (menu too). */}
        <Pressable
          style={[StyleSheet.absoluteFill, styles.focusHolder]}
          isTVSelectable={true}
          hasTVPreferredFocus={true}
          onPress={toggleSlideshow}
          accessibilityRole="button"
          accessibilityLabel={current ? `Photo: ${current.Name}` : "Photo viewer"}
          accessibilityHint={isPlaying ? "Press select to pause the slideshow" : "Press select to start the slideshow"}
        />
        {overlays}
      </View>
    );
  }

  // The close and slideshow buttons sit OUTSIDE the detector: an RNGH tap that activates
  // cancels the RN touch responder under it, which would eat their presses.
  return (
    <GestureHandlerRootView style={styles.container}>
      <View style={styles.container} onPointerMove={revealChrome}>
        <GestureDetector gesture={photoGesture}>
          <Animated.View style={[StyleSheet.absoluteFill, dismissStyle]} collapsable={false}>
            <Animated.View style={[StyleSheet.absoluteFill, zoomStyle]}>{photoStack}</Animated.View>
            {/* VoiceOver only. Plain Views, never Pressables: they carry the step actions for a
                screen reader without becoming touch responders, so a sighted drag passes
                straight through them to the pan. */}
            <View style={[styles.tapZone, styles.tapZoneLeft]} accessible accessibilityRole="button" accessibilityLabel="Previous photo" onAccessibilityTap={() => goStep(-1)} />
            <View style={[styles.tapZone, styles.tapZoneRight]} accessible accessibilityRole="button" accessibilityLabel="Next photo" onAccessibilityTap={() => goStep(1)} />
          </Animated.View>
        </GestureDetector>
        {/* box-none so the fade layer itself is never a touch target: a press that misses both
            buttons still reaches the gesture detector underneath. */}
        <Animated.View style={[StyleSheet.absoluteFill, chromeStyle]} pointerEvents={chromeVisible ? "box-none" : "none"}>
          <GlassActionCluster
            style={[styles.chromeCluster, { top: insets.top + CHROME_INSET, left: insets.left + CHROME_INSET }]}
            triggerIcon="ellipsis-horizontal"
            triggerLabel="Photo actions"
            expanded={actionsOpen}
            onExpandedChange={setActionsExpanded}
            actions={[
              { key: "close", icon: "close", label: "Close", onPress: leaveViewer },
              { key: "slideshow", icon: isPlaying ? "pause" : "play", label: isPlaying ? "Pause slideshow" : "Play slideshow", onPress: toggleSlideshow },
            ]}
          />
          {overlays}
        </Animated.View>
      </View>
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
  // Placement only: the cluster owns its own size and shape. Insets are applied inline from
  // the safe area, so the gap above it matches the gap at its left on every device.
  chromeCluster: {
    position: "absolute",
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
