import { GlassActionCluster, type GlassAction } from "@/components/glass-action-cluster";
import { leavingByPan } from "@/components/dismiss-pan";
import { COLORS } from "@/constants/colors";
import { claimMacContextKeys, subscribeMacKeyCommand } from "@/services/macKeyCommands";
import { t } from "@/services/i18n";
import { Image } from "expo-image";
import React, { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from "react";
import { ActivityIndicator, Platform, Pressable, StyleSheet, View, useTVEventHandler, useWindowDimensions } from "react-native";
import { Gesture, GestureDetector, GestureHandlerRootView } from "react-native-gesture-handler";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Animated, { cancelAnimation, runOnJS, useAnimatedStyle, useReducedMotion, useSharedValue, withTiming } from "react-native-reanimated";

const SLIDE_DURATION_MS = 300;
const FADE_DURATION_MS = 650;
const MAX_ZOOM = 6;
const DOUBLE_TAP_ZOOM = 2.5;
/** The remote and the keyboard step through these; a pinch lands anywhere up to MAX_ZOOM. */
const ZOOM_LEVELS = [1, 2, 3];
const ZOOM_DURATION_MS = 220;
/** How far one remote press or swipe pans a zoomed page, as a fraction of the viewport. */
const TV_PAN_FRACTION = 0.4;
// Chrome auto-hide: the close and action buttons ride the viewer's activity, so a still
// page is shown whole and a moved pointer or any press brings them straight back.
const CHROME_HIDE_DELAY_MS = 2600;
const CHROME_FADE_MS = 260;
/** The cluster's gap from the safe area, the same on both axes. */
const CHROME_INSET = 20;
// Drag-to-navigate: commit the step past this fraction of the screen, or on a flick
// faster than this (pt/s) in the reveal direction.
const DRAG_COMMIT_FRACTION = 0.35;
const DRAG_COMMIT_VELOCITY = 700;

export type PageTransition = "slide" | "fade";

/**
 * Keep the zoomed page's pan inside the screen box: a scale of s can travel half the screen
 * per unit of scale before its edge crosses the middle.
 */
function clampTranslate(value: number, scale: number, extent: number) {
  "worklet";
  const limit = Math.max(0, ((scale - 1) * extent) / 2);
  return Math.min(Math.max(value, -limit), limit);
}

/**
 * Style for one page buffer. A slide brings the front buffer in on an opaque canvas over an
 * untouched back buffer: fading the back one turned a white book page grey under the finger.
 * A fade cross-dissolves the two, so the back buffer fades and the front stays transparent.
 */
function bufferLayerStyle(isFront: boolean, progressValue: number, direction: number, mode: number, width: number) {
  "worklet";
  if (isFront) {
    if (mode === 1) {
      return { opacity: 1, backgroundColor: "#000000", transform: [{ translateX: (1 - progressValue) * direction * width }] };
    }
    return { opacity: progressValue, backgroundColor: "transparent", transform: [{ translateX: 0 }] };
  }
  return { opacity: mode === 1 ? 1 : 1 - progressValue, backgroundColor: "transparent", transform: [{ translateX: 0 }] };
}

type BufferState = {
  index: number;
  pageA: number | null;
  pageB: number | null;
  frontIsA: boolean;
  mode: PageTransition;
  transitionId: number; // 0 = initial page, no transition to run
  // Drag-initiated step: the finger drives `progress`, so the commit effect must arm the
  // pan instead of running withTiming.
  interactive: boolean;
};

export interface PageViewerHandle {
  /** Step by one page; the slideshow passes "fade". */
  step(delta: 1 | -1, mode?: PageTransition): void;
  /** Jump to any page, entering from `direction`. */
  goTo(index: number, direction: 1 | -1, mode?: PageTransition): void;
  index(): number;
  zoomTo(level: number): void;
}

export interface PageViewerProps {
  pages: number;
  /** The page's image, or "" while it is not ready (a spinner shows in its place). */
  uriAt: (index: number) => string;
  initialIndex?: number;
  onIndexChange?: (index: number) => void;
  onLeave: () => void;
  /** TV select on the focus holder (delivered as onPress, never as a TV event). */
  onSelect?: () => void;
  /** TV play/pause. Absent with zoomMode "image", play/pause cycles the zoom levels. */
  onPlayPause?: () => void;
  /** Cluster actions after Close. */
  actions?: GlassAction[];
  triggerLabel: string;
  /** Pills and bars drawn above the pages; on touch they fade with the chrome. */
  overlay?: React.ReactNode;
  /** "image": pinch, double tap, remote and ⌘ zoom; "none": pages never zoom. */
  zoomMode: "image" | "none";
  /** A zoom came to rest at a whole level (1 = reset); a caller can swap in a sharper render. */
  onZoomSettled?: (level: number) => void;
  /** Keep the chrome up, and its auto-hide off, while the owner is busy (a text relayout). */
  holdChrome?: boolean;
  /** Focus holder and step zones for VoiceOver. */
  accessibilityLabel: string;
  accessibilityHint?: string;
  previousLabel: string;
  nextLabel: string;
  /** Owner name for the Mac key claim. */
  keyOwner: string;
}

/**
 * Full-screen page stepper shared by the photo viewer and the book reader. Left/right (remote,
 * keyboard, drag) step pages with a slide; a pinch or double tap zooms on touch, play/pause and
 * ⌘+/⌘- zoom on TV and Mac, and a zoomed page pans by drag or by remote presses. Menu pops the
 * screen natively (no handler): this screen must stay a regular push, or TV remote events never
 * reach it.
 *
 * Transitions are worklet-driven (shared values + withTiming) over TWO PERSISTENT buffer layers
 * that never remount. On Fabric a freshly mounted Animated.View renders its static styles first
 * and attaches the useAnimatedStyle node a frame later (reanimated #6865, #7354), so any per-step
 * remount flashes the incoming page at rest before animating. Stepping only mutates shared values
 * (already-attached nodes, applied same-frame) and swaps the hidden buffer's Image source.
 */
export const PageViewer = forwardRef<PageViewerHandle, PageViewerProps>(function PageViewer(props, ref) {
  const {
    pages,
    uriAt,
    initialIndex = 0,
    onIndexChange,
    onLeave,
    onSelect,
    onPlayPause,
    actions,
    triggerLabel,
    overlay,
    zoomMode,
    onZoomSettled,
    holdChrome = false,
    accessibilityLabel,
    accessibilityHint,
    previousLabel,
    nextLabel,
    keyOwner,
  } = props;
  const insets = useSafeAreaInsets();
  const reducedMotion = useReducedMotion();

  const [buffers, setBuffers] = useState<BufferState>({ index: initialIndex, pageA: initialIndex, pageB: null, frontIsA: true, mode: "slide", transitionId: 0, interactive: false });

  // Refs mirror state so remote-event callbacks never act on stale closures
  const pagesRef = useRef(pages);
  pagesRef.current = pages;
  const indexRef = useRef(initialIndex);
  const frontIsARef = useRef(true);
  const onIndexChangeRef = useRef(onIndexChange);
  onIndexChangeRef.current = onIndexChange;
  const onZoomSettledRef = useRef(onZoomSettled);
  onZoomSettledRef.current = onZoomSettled;

  const progress = useSharedValue(1); // 0 → 1 per transition
  const directionSV = useSharedValue(1); // 1 = forward, -1 = backward
  const modeSV = useSharedValue(1); // 1 = slide, 0 = fade
  const frontSV = useSharedValue(0); // 0 = buffer A is the incoming/front layer, 1 = buffer B

  // Screen-space zoom transform over both buffers, so a step out of a zoom resets it rather
  // than carrying the crop onto the next page.
  const zoomScale = useSharedValue(1);
  const zoomTx = useSharedValue(0);
  const zoomTy = useSharedValue(0);
  const savedScale = useSharedValue(1);
  const savedTx = useSharedValue(0);
  const savedTy = useSharedValue(0);
  const focalX = useSharedValue(0);
  const focalY = useSharedValue(0);
  // 1 = the pan is moving a zoomed page, 0 = it is dragging to the next one.
  const panMode = useSharedValue(0);
  // Mirrors zoomScale > 1 on the JS side: the pan's activation offsets are build-time config,
  // and a zoomed page has to pan vertically too.
  const [zoomed, setZoomed] = useState(false);
  const zoomLevelRef = useRef(1);

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
  const holdSV = useSharedValue(false);

  const armChromeHide = useCallback(() => {
    if (chromeHideTimer.current) clearTimeout(chromeHideTimer.current);
    chromeHideTimer.current = setTimeout(() => {
      if (actionsOpenSV.get() || holdSV.get()) return; // an open menu or a busy owner holds the chrome up
      chromeOpacity.set(
        withTiming(0, { duration: CHROME_FADE_MS }, (finished) => {
          if (finished) runOnJS(setChromeVisible)(false);
        }),
      );
    }, CHROME_HIDE_DELAY_MS);
  }, [chromeOpacity, actionsOpenSV, holdSV]);

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

  // A hold shows the chrome and parks the idle clock; releasing it restarts the clock.
  useEffect(() => {
    holdSV.set(holdChrome);
    if (Platform.isTV) return;
    revealChrome();
  }, [holdChrome, holdSV, revealChrome]);

  const settleZoom = useCallback((level: number) => {
    zoomLevelRef.current = level;
    onZoomSettledRef.current?.(level);
  }, []);

  // Shared values first (already-attached style nodes apply them same-frame): the buffer
  // flipped to front is hidden before anything else changes, and the old front, now the
  // fading back layer, keeps showing the current page untouched until the new source
  // commits. Nothing mounts, so the Fabric first-frame style gap can never flash.
  const stepTo = useCallback(
    (nextIndex: number, direction: 1 | -1, mode: PageTransition, interactive = false) => {
      const prevIndex = indexRef.current;
      if (nextIndex === prevIndex || nextIndex < 0 || nextIndex >= pagesRef.current) return;
      indexRef.current = nextIndex;
      zoomScale.set(1);
      zoomTx.set(0);
      zoomTy.set(0);
      setZoomed(false);
      if (zoomLevelRef.current !== 1) settleZoom(1);
      const nextFrontIsA = !frontIsARef.current;
      frontIsARef.current = nextFrontIsA;
      progress.set(0);
      directionSV.set(direction);
      modeSV.set(mode === "slide" ? 1 : 0);
      frontSV.set(nextFrontIsA ? 0 : 1);
      setBuffers((prev) => ({
        index: nextIndex,
        pageA: nextFrontIsA ? nextIndex : prev.pageA,
        pageB: nextFrontIsA ? prev.pageB : nextIndex,
        frontIsA: nextFrontIsA,
        mode,
        transitionId: prev.transitionId + 1,
        interactive,
      }));
      // A drag announces its page only once it commits: the owner's work on a new page (renders,
      // a progress write) must not land on the JS thread while the finger is mid-swipe.
      if (!interactive) onIndexChangeRef.current?.(nextIndex);
    },
    [directionSV, modeSV, progress, frontSV, zoomScale, zoomTx, zoomTy, settleZoom],
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

  const goStep = useCallback(
    (delta: 1 | -1, mode?: PageTransition) => {
      const next = indexRef.current + delta;
      if (next < 0 || next >= pagesRef.current) return;
      stepTo(next, delta, mode ?? (reducedMotion ? "fade" : "slide"));
    },
    [stepTo, reducedMotion],
  );

  // ── Zoom ────────────────────────────────────────────────────────────────────────────────
  // Pinch anchors on the focal point: the content coordinate under the fingers stays under
  // them (screen = translate + scale * content). Double tap zooms to the tapped point, or
  // resets when already zoomed. The remote and the keyboard zoom about the centre in steps.
  const resetZoom = useCallback(() => {
    "worklet";
    zoomScale.set(withTiming(1, { duration: ZOOM_DURATION_MS }));
    zoomTx.set(withTiming(0, { duration: ZOOM_DURATION_MS }));
    zoomTy.set(withTiming(0, { duration: ZOOM_DURATION_MS }));
    runOnJS(setZoomed)(false);
    runOnJS(settleZoom)(1);
  }, [zoomScale, zoomTx, zoomTy, settleZoom]);

  const zoomTo = useCallback(
    (level: number) => {
      if (zoomMode !== "image") return;
      const target = Math.min(Math.max(level, 1), ZOOM_LEVELS[ZOOM_LEVELS.length - 1]);
      const timing = { duration: ZOOM_DURATION_MS };
      zoomScale.set(withTiming(target, timing));
      zoomTx.set(withTiming(clampTranslate(zoomTx.get(), target, viewportW.get()), timing));
      zoomTy.set(withTiming(clampTranslate(zoomTy.get(), target, viewportH.get()), timing));
      setZoomed(target > 1);
      settleZoom(target);
    },
    [zoomMode, zoomScale, zoomTx, zoomTy, viewportW, viewportH, settleZoom],
  );

  const cycleZoom = useCallback(() => {
    const current = zoomLevelRef.current;
    const at = ZOOM_LEVELS.indexOf(current);
    zoomTo(ZOOM_LEVELS[(at + 1) % ZOOM_LEVELS.length]);
  }, [zoomTo]);

  /** A remote press while zoomed moves the page by a fraction of the viewport. */
  const panBy = useCallback(
    (dx: number, dy: number) => {
      const scale = zoomScale.get();
      const timing = { duration: ZOOM_DURATION_MS };
      zoomTx.set(withTiming(clampTranslate(zoomTx.get() + dx * viewportW.get() * TV_PAN_FRACTION, scale, viewportW.get()), timing));
      zoomTy.set(withTiming(clampTranslate(zoomTy.get() + dy * viewportH.get() * TV_PAN_FRACTION, scale, viewportH.get()), timing));
    },
    [zoomScale, zoomTx, zoomTy, viewportW, viewportH],
  );

  useImperativeHandle(
    ref,
    () => ({
      step: goStep,
      goTo: (index, direction, mode) => stepTo(index, direction, mode ?? (reducedMotion ? "fade" : "slide")),
      index: () => indexRef.current,
      zoomTo,
    }),
    [goStep, stepTo, zoomTo, reducedMotion],
  );

  const pinchGesture = React.useMemo(
    () =>
      Gesture.Pinch()
        .enabled(zoomMode === "image")
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
          runOnJS(settleZoom)(Math.min(ZOOM_LEVELS[ZOOM_LEVELS.length - 1], Math.max(1, Math.round(zoomScale.get()))));
        }),
    [zoomMode, zoomScale, zoomTx, zoomTy, savedScale, savedTx, savedTy, focalX, focalY, resetZoom, settleZoom, viewportW, viewportH],
  );

  const doubleTapGesture = React.useMemo(
    () =>
      Gesture.Tap()
        .enabled(zoomMode === "image")
        .numberOfTaps(2)
        .maxDuration(280)
        // iOS puts no travel limit on a tap, so two quick page swipes read as a double tap.
        .maxDistance(10)
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
          runOnJS(settleZoom)(Math.round(DOUBLE_TAP_ZOOM));
        }),
    [zoomMode, zoomScale, zoomTx, zoomTy, resetZoom, revealChrome, settleZoom, viewportW, viewportH],
  );

  // A tap only wakes the chrome. Stepping by tap is gone from touch: it read the SIDE the
  // finger was on rather than the way it travelled, and it ran simultaneously with the pan,
  // so a short drag in the left third went backwards however it was dragged. Dragging is the
  // gesture here; the remote keeps its own left and right on tvOS, which renders no gestures.
  const wakeTapGesture = React.useMemo(
    () =>
      Gesture.Tap()
        .numberOfTaps(1)
        .onEnd(() => {
          "worklet";
          runOnJS(revealChrome)();
        }),
    [revealChrome],
  );

  // ── Drag-to-navigate (phone) ──────────────────────────────────────────────────────────────
  // The pan drives the SAME buffer transition the remote uses: on activation the target page
  // is committed into the hidden front buffer (stepTo, interactive), then the finger owns
  // `progress` (0 → 1 = fully revealed). Release commits past DRAG_COMMIT_FRACTION or on a
  // fast flick, else the front animates back off screen and the buffers flip back, that flip
  // runs inside the timing callback ON THE UI THREAD, because a JS-side flip of frontSV and
  // progress could render an intermediate frame with the next page fully visible.
  const dragDirSV = useSharedValue<1 | -1>(1);
  const dragActiveRef = useRef(false);
  const dragDirectionRef = useRef<1 | -1>(1);

  const beginDrag = useCallback(
    (direction: 1 | -1) => {
      if (progress.get() !== 1) return; // a transition is still running; ignore this drag
      const next = indexRef.current + direction;
      if (next < 0 || next >= pagesRef.current) return;
      dragActiveRef.current = true;
      dragDirectionRef.current = direction;
      dragDirSV.set(direction);
      stepTo(next, direction, "slide", true);
    },
    [progress, dragDirSV, stepTo],
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
        onIndexChangeRef.current?.(indexRef.current);
      } else {
        progress.set(
          withTiming(0, { duration: Math.max(80, SLIDE_DURATION_MS * fraction) }, (finished) => {
            if (!finished) return;
            frontSV.set(frontSV.get() === 0 ? 1 : 0);
            progress.set(1);
            runOnJS(revertDragState)();
          }),
        );
      }
    },
    [dragReady, progress, frontSV, revertDragState, viewportWidth],
  );

  // The gesture callbacks run on pan events, never during render; react-hooks/refs can't see
  // through RNGH's builder and flags the ref-reading JS handlers they dispatch to.
  const panGesture = React.useMemo(() => {
    const pan = Gesture.Pan();
    // Drag-to-navigate is horizontal only; a zoomed page pans in both axes from the first pixel.
    if (!zoomed) pan.activeOffsetX([-12, 12]).failOffsetY([-16, 16]);
    return pan
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
      .onEnd((e) => {
        "worklet";
        if (panMode.get() === 1) return;
        runOnJS(handleDragEnd)(e.translationX, e.velocityX);
      });
  }, [zoomed, beginDrag, handleDragEnd, dragReady, dragDirSV, progress, panMode, zoomScale, zoomTx, zoomTy, savedTx, savedTy, revealChrome, viewportW, viewportH]);

  // Drag down to leave, on the same rule the player's own dismiss uses (leavingByPan): past a
  // distance, or a flick that also covered ground. Vertical only, so it and the horizontal step
  // drag can never both claim one movement, and a zoomed page keeps its pan instead.
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
          // zoom above 1, and an early return there left the page standing off centre.
          if (zoomScale.get() <= 1 && leavingByPan(e, success)) {
            runOnJS(onLeave)();
            return;
          }
          dismissY.set(withTiming(0, { duration: 160 }));
        }),
    [dismissY, zoomScale, onLeave],
  );

  const pageGesture = React.useMemo(
    () => Gesture.Simultaneous(pinchGesture, Gesture.Race(panGesture, dismissPanGesture), Gesture.Exclusive(doubleTapGesture, wakeTapGesture)),
    [pinchGesture, panGesture, dismissPanGesture, doubleTapGesture, wakeTapGesture],
  );

  // Mac hardware keyboard: the bare arrows step the page, claimed only while this screen is
  // up so a grid keeps its own arrow scrolling; ⌘+ and ⌘- zoom. Off a Mac both calls are no-ops.
  useEffect(() => {
    const release = claimMacContextKeys(keyOwner, "photo");
    const unsubscribe = subscribeMacKeyCommand((key) => {
      if (key === "previousPhoto" || key === "nextPhoto") {
        revealChrome();
        goStep(key === "nextPhoto" ? 1 : -1);
      } else if (key === "zoomIn" || key === "zoomOut") {
        const at = ZOOM_LEVELS.indexOf(zoomLevelRef.current);
        zoomTo(ZOOM_LEVELS[Math.min(Math.max(at + (key === "zoomIn" ? 1 : -1), 0), ZOOM_LEVELS.length - 1)]);
      }
    });
    return () => {
      unsubscribe();
      release();
    };
  }, [goStep, revealChrome, zoomTo, keyOwner]);

  // Handle TV remote events. Menu is deliberately NOT handled: the native stack pops it.
  // A zoomed page pans on the arrows; at rest, left and right step and play/pause zooms or
  // does what the owner asked.
  useTVEventHandler(
    useCallback(
      (evt: { eventType: string }) => {
        const zoomedIn = zoomLevelRef.current > 1;
        if (evt.eventType === "right" || evt.eventType === "swipeRight") {
          if (zoomedIn) panBy(-1, 0);
          else goStep(1);
        } else if (evt.eventType === "left" || evt.eventType === "swipeLeft") {
          if (zoomedIn) panBy(1, 0);
          else goStep(-1);
        } else if (evt.eventType === "up" || evt.eventType === "swipeUp") {
          if (zoomedIn) panBy(0, 1);
        } else if (evt.eventType === "down" || evt.eventType === "swipeDown") {
          if (zoomedIn) panBy(0, -1);
        } else if (evt.eventType === "playPause") {
          if (onPlayPause) onPlayPause();
          else if (zoomMode === "image") cycleZoom();
        }
      },
      [goStep, panBy, onPlayPause, zoomMode, cycleZoom],
    ),
  );

  // Stop animations when leaving the screen
  useEffect(() => {
    return () => {
      cancelAnimation(progress);
    };
  }, [progress]);

  const layerAStyle = useAnimatedStyle(() => bufferLayerStyle(frontSV.value === 0, progress.value, directionSV.value, modeSV.value, viewportW.value));
  const layerBStyle = useAnimatedStyle(() => bufferLayerStyle(frontSV.value === 1, progress.value, directionSV.value, modeSV.value, viewportW.value));
  const chromeStyle = useAnimatedStyle(() => ({ opacity: chromeOpacity.value }));
  const dismissStyle = useAnimatedStyle(() => ({ transform: [{ translateY: dismissY.value }] }));
  // translate after scale: the page scales about its centre, then the pan offsets it.
  const zoomStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: zoomTx.value }, { translateY: zoomTy.value }, { scale: zoomScale.value }],
  }));

  const uriA = buffers.pageA != null ? uriAt(buffers.pageA) : "";
  const uriB = buffers.pageB != null ? uriAt(buffers.pageB) : "";

  /* Persistent page buffers: never remounted, only their sources swap. zIndex follows the
     role flip in the same commit as the source swap, so the incoming buffer always slides in
     ON TOP of the fading outgoing one. A buffer holding a page whose image is not ready yet
     shows the spinner in its place. */
  const pageStack = (
    <>
      <Animated.View style={[styles.pageLayer, { zIndex: buffers.frontIsA ? 2 : 1 }, layerAStyle]} pointerEvents="none">
        {uriA ? (
          <Image source={{ uri: uriA }} style={styles.page} contentFit="contain" />
        ) : buffers.pageA != null ? (
          <ActivityIndicator size="large" color={COLORS.TEXT_PRIMARY} style={styles.loader} />
        ) : null}
      </Animated.View>
      <Animated.View style={[styles.pageLayer, { zIndex: buffers.frontIsA ? 1 : 2 }, layerBStyle]} pointerEvents="none">
        {uriB ? (
          <Image source={{ uri: uriB }} style={styles.page} contentFit="contain" />
        ) : buffers.pageB != null ? (
          <ActivityIndicator size="large" color={COLORS.TEXT_PRIMARY} style={styles.loader} />
        ) : null}
      </Animated.View>
    </>
  );

  // TV navigates by remote; the gesture tree (and RNGH's root view, mounted nowhere else in
  // the app) exists only on touch platforms.
  if (Platform.isTV) {
    return (
      <View style={styles.container}>
        <Animated.View style={[StyleSheet.absoluteFill, zoomStyle]}>{pageStack}</Animated.View>
        {/* Focus holder: keeps the tvOS focus engine on this screen; select is delivered as
            onPress to the focused view, never as a TV event. MUST sit above the zIndexed page
            buffers: the focus engine treats a fully occluded view as non-focusable, and with
            nothing focusable UIKit drops every press unsent (menu too). */}
        <Pressable
          style={[StyleSheet.absoluteFill, styles.focusHolder]}
          isTVSelectable={true}
          hasTVPreferredFocus={true}
          onPress={onSelect}
          accessibilityRole="button"
          accessibilityLabel={accessibilityLabel}
          accessibilityHint={accessibilityHint}
        />
        {overlay}
      </View>
    );
  }

  // The close and action buttons sit OUTSIDE the detector: an RNGH tap that activates
  // cancels the RN touch responder under it, which would eat their presses.
  return (
    <GestureHandlerRootView style={styles.container}>
      <View style={styles.container} onPointerMove={revealChrome}>
        <GestureDetector gesture={pageGesture}>
          <Animated.View style={[StyleSheet.absoluteFill, dismissStyle]} collapsable={false}>
            <Animated.View style={[StyleSheet.absoluteFill, zoomStyle]}>{pageStack}</Animated.View>
            {/* VoiceOver only. Plain Views, never Pressables: they carry the step actions for a
                screen reader without becoming touch responders, so a sighted drag passes
                straight through them to the pan. */}
            <View
              style={[styles.tapZone, styles.tapZoneLeft]}
              accessible
              accessibilityRole="button"
              accessibilityLabel={previousLabel}
              accessibilityState={{ disabled: buffers.index === 0 }}
              onAccessibilityTap={() => goStep(-1)}
            />
            <View
              style={[styles.tapZone, styles.tapZoneRight]}
              accessible
              accessibilityRole="button"
              accessibilityLabel={nextLabel}
              accessibilityState={{ disabled: buffers.index >= pages - 1 }}
              onAccessibilityTap={() => goStep(1)}
            />
          </Animated.View>
        </GestureDetector>
        {/* box-none so the fade layer itself is never a touch target: a press that misses both
            buttons still reaches the gesture detector underneath. */}
        <Animated.View style={[StyleSheet.absoluteFill, chromeStyle]} pointerEvents={chromeVisible ? "box-none" : "none"}>
          <GlassActionCluster
            style={[styles.chromeCluster, { top: insets.top + CHROME_INSET, left: insets.left + CHROME_INSET }]}
            triggerIcon="ellipsis-horizontal"
            triggerLabel={triggerLabel}
            expanded={actionsOpen}
            onExpandedChange={setActionsExpanded}
            actions={[{ key: "close", icon: "close", label: t("common.close"), onPress: onLeave }, ...(actions ?? [])]}
          />
          {overlay}
        </Animated.View>
      </View>
    </GestureHandlerRootView>
  );
});

export const pageViewerStyles = StyleSheet.create({
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
  // Primary, not secondary: the pill sits on whatever the page is, and a book page is white paper.
  infoCounter: {
    fontSize: Platform.isTV ? 20 : 14,
    fontWeight: "600",
    color: COLORS.TEXT_PRIMARY,
  },
});

/** One material for every piece of viewer chrome, matching GlassIconButton's. */
export const VIEWER_CHROME_TINT = "rgba(18, 18, 20, 0.30)";
export const INFO_PILL_RADIUS = 999;

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.MEDIA_BACKGROUND,
  },
  pageLayer: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
  page: {
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
});
