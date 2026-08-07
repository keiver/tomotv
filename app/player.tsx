import { FocusableButton } from "@/components/FocusableButton";
import { UpNextOverlay } from "@/components/up-next-overlay";
import { useLibrary } from "@/contexts/LibraryContext";
import { useLoading } from "@/contexts/LoadingContext";
import { usePlayQueue } from "@/contexts/PlayQueueContext";
import { setForegroundRefreshHold } from "@/hooks/useAppStateRefresh";
import { usePlayerDismissGesture } from "@/hooks/usePlayerDismissGesture";
import { useVideoPlayback } from "@/hooks/useVideoPlayback";
import { getPosterUrl, hasPoster } from "@/services/jellyfinApi";
import { logger } from "@/utils/logger";
import { Ionicons } from "@expo/vector-icons";
import { Image } from "expo-image";
import * as Linking from "expo-linking";
import { useLocalSearchParams, useRouter } from "expo-router";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Video from "react-native-video";
import type { OnControlsVisibilityChange, OnLoadData, OnProgressData } from "react-native-video";
import { ActivityIndicator, BackHandler, LogBox, Platform, Pressable, StyleSheet, Text, useTVEventHandler, useWindowDimensions, View } from "react-native";
import { GestureDetector, GestureHandlerRootView } from "react-native-gesture-handler";
import Animated from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

// Suppress known warnings
LogBox.ignoreLogs([
  "JS object is no longer associated",
  "Operation requires a client callback",
  "Operation requires a client data source",
  "Cannot Open", // Direct play failures that trigger automatic transcoding retry
  "Failed to load the player item", // Player errors during automatic retry
]);

// Larger than the gallery's grid size since the artwork is displayed near full screen
const AUDIO_POSTER_SIZE = Platform.isTV ? 900 : 600;

/**
 * Deep links (Top Shelf) arrive as a react-navigation NAVIGATE, which reuses an
 * already-mounted player route and merges params — with an unchanged videoId nothing
 * restarts and the screen resurfaces with a dead stream (stale local remux session:
 * audio from the buffer under the opaque loading overlay, no video). Two signals force
 * a clean remount of the body instead:
 * - `ts`: a per-shelf-refresh nonce the Top Shelf extension puts in the URL.
 * - `generation`: counts player-targeted URL deliveries while this screen is mounted,
 *   covering repeat selections of the same item within one shelf refresh (same ts).
 * In-app pushes carry no ts and deliver no URL event, so their key never changes.
 */
export default function VideoPlayerScreen() {
  const { ts } = useLocalSearchParams<{ ts?: string }>();
  const [generation, setGeneration] = useState(0);

  useEffect(() => {
    const subscription = Linking.addEventListener("url", ({ url }) => {
      if (url.includes("/player")) {
        setGeneration((current) => current + 1);
      }
    });
    return () => subscription.remove();
  }, []);

  return <VideoPlayerBody key={`${ts ?? "in-app"}:${generation}`} />;
}

function VideoPlayerBody() {
  const params = useLocalSearchParams<{
    videoId: string;
    videoName: string;
    playlistIndex?: string;
    queueMode?: string;
    startTicks?: string; // Resume position the launching screen already displayed
    played?: string; // Played flag the launching screen already displayed
    probe?: string; // "1" from regression-suite deep links: record playback events (dev-only)
  }>();
  const router = useRouter();
  const { hideGlobalLoader, showGlobalLoader } = useLoading();
  const { videos } = useLibrary();
  const { hasNext, nextVideo, progress, advanceToNext, clear } = usePlayQueue();

  const isQueueMode = params.queueMode === "true";

  // Parse playlist index
  const currentPlaylistIndex = params.playlistIndex ? parseInt(params.playlistIndex, 10) : -1;

  // --- Queue mode: near-end overlay state ---
  const [showUpNext, setShowUpNext] = useState(false);
  const showUpNextRef = useRef(false);
  const videoDurationRef = useRef(0);
  const [upNextProgress, setUpNextProgress] = useState(1);
  const upNextThresholdRef = useRef(30);
  const upNextCtaRef = useRef<View>(null);

  // Handle playback end - auto-play next video
  const handlePlaybackEnd = useCallback(() => {
    if (isQueueMode) {
      // Queue mode: advance or clear
      if (hasNext) {
        const next = advanceToNext();
        if (next) {
          logger.info("Queue: advancing to next video", {
            service: "VideoPlayer",
            videoName: next.Name,
          });
          showGlobalLoader();
          router.replace({
            pathname: "/player" as const,
            params: {
              videoId: next.Id,
              videoName: next.Name,
              queueMode: "true",
            },
          });
          return;
        }
      }
      // End of queue
      logger.info("Queue: end of queue, returning to library", { service: "VideoPlayer" });
      clear();
      router.back();
      return;
    }

    // Legacy playlist mode
    if (currentPlaylistIndex >= 0 && currentPlaylistIndex < videos.length - 1) {
      const nextVid = videos[currentPlaylistIndex + 1];
      if (nextVid) {
        logger.info("Auto-playing next video", { service: "VideoPlayer", videoName: nextVid.Name });
        showGlobalLoader();
        router.replace({
          pathname: "/player" as const,
          params: {
            videoId: nextVid.Id,
            videoName: nextVid.Name,
            playlistIndex: (currentPlaylistIndex + 1).toString(),
          },
        });
      }
    } else {
      logger.info("End of playlist, going back to library", { service: "VideoPlayer" });
      router.back();
    }
  }, [isQueueMode, hasNext, advanceToNext, clear, currentPlaylistIndex, videos, router, showGlobalLoader]);

  const insets = useSafeAreaInsets();
  const { height: windowHeight } = useWindowDimensions();

  // Audio poster metrics, height-driven so landscape shrinks the art instead of letting a fixed
  // size collide with AVKit's center play/pause glyph. Portrait hits the caps (160pt at +76).
  const posterHeight = Math.min(160, Math.round(windowHeight * 0.2));
  const posterTop = insets.top + Math.min(76, Math.round(windowHeight * 0.09));
  // ~24% of the edge with a continuous curve is what reads as a squircle rather than a rounded rect.
  const posterRadius = Math.round(posterHeight * 0.24);

  // Use the video playback hook with state machine
  const { videoRef, sourceUri, paused, videoCallbacks, state, showLoadingOverlay, play, pause, seekBy, retry, videoDetails, isAudioOnly } = useVideoPlayback({
    videoId: params.videoId,
    startPositionTicks: params.startTicks ? Number(params.startTicks) : undefined,
    playedAtStart: params.played === undefined ? undefined : params.played === "true",
    onPlaybackEnd: handlePlaybackEnd,
    probe: params.probe === "1",
  });

  // Audio-only files: show the same Primary poster the gallery shows.
  // Same stable cacheKey scheme as the grid items (id + image tag + size).
  const audioPosterSource = useMemo(() => {
    if (!isAudioOnly || !videoDetails || !hasPoster(videoDetails)) return undefined;
    const uri = getPosterUrl(videoDetails.Id, AUDIO_POSTER_SIZE);
    if (!uri) return undefined;
    return {
      uri,
      cacheKey: `${videoDetails.Id}-${videoDetails.ImageTags?.Primary}-${AUDIO_POSTER_SIZE}`,
    };
  }, [isAudioOnly, videoDetails]);

  // Hide global loader when component mounts
  useEffect(() => {
    hideGlobalLoader();
  }, [hideGlobalLoader]);

  // Suppress the foreground refresh storm while playback is on screen — a Top Shelf
  // launch foregrounds the app straight into this screen, and the library/folder
  // refetches would compete with stream startup (see useAppStateRefresh).
  useEffect(() => {
    setForegroundRefreshHold(true);
    return () => setForegroundRefreshHold(false);
  }, []);

  // --- Queue: wrap video callbacks to detect near-end ---
  const wrappedCallbacks = useMemo(() => {
    if (!isQueueMode || !hasNext) return videoCallbacks;

    return {
      ...videoCallbacks,
      onLoad: (data: OnLoadData) => {
        videoCallbacks.onLoad(data);
        videoDurationRef.current = data.duration;
        upNextThresholdRef.current = Math.min(30, Math.floor(data.duration / 2));
      },
      onProgress: (data: OnProgressData) => {
        videoCallbacks.onProgress(data);
        if (videoDurationRef.current > 0) {
          const remaining = videoDurationRef.current - data.currentTime;
          const shouldShow = remaining <= upNextThresholdRef.current && remaining > 0;
          if (shouldShow !== showUpNextRef.current) {
            showUpNextRef.current = shouldShow;
            setShowUpNext(shouldShow);
          }
          if (showUpNextRef.current) {
            setUpNextProgress(Math.max(0, remaining / upNextThresholdRef.current));
          }
        }
      },
    };
  }, [videoCallbacks, isQueueMode, hasNext]);

  // tvOS: the transport bar owns focus while visible, so the Play Now CTA can't be reached
  // by swiping and hasTVPreferredFocus only acts at mount — focus must be forced back.
  const focusUpNextCta = useCallback((trigger: string) => {
    if (!Platform.isTV || !showUpNextRef.current) return;
    logger.debug("Focusing Up Next CTA", { service: "VideoPlayer", trigger });
    const tvNode = upNextCtaRef.current as unknown as { requestTVFocus?: () => void } | null;
    tvNode?.requestTVFocus?.();
  }, []);

  // Audio-only: the focus holder owns focus for the whole session, so every remote press
  // arrives here instead of AVKit. AVKit's persistent audio transport bar is display-only
  // for us — it mirrors the AVPlayer, so JS-driven seeks and pause state show up on it.
  const togglePlayPause = useCallback(() => {
    if (paused) {
      play();
    } else {
      pause();
    }
  }, [paused, play, pause]);

  // Trigger 1: up on the remote while on the player means the user wants the CTA.
  // Menu is deliberately not handled (native pop rule, see photo-viewer).
  // Audio seek is PRESSES only — a stray flick on the touch surface must not jump 10s.
  // Video is excluded from all of this: its focusable transport bar owns playback
  // natively and the root-view remote handler fires for every event, so an ungated
  // handler would double-apply.
  useTVEventHandler(
    useCallback(
      (evt: { eventType: string }) => {
        if (evt.eventType === "up" || evt.eventType === "swipeUp") {
          focusUpNextCta("up-key");
        } else if (isAudioOnly) {
          if (evt.eventType === "left") {
            seekBy(-10);
          } else if (evt.eventType === "right") {
            seekBy(10);
          } else if (evt.eventType === "playPause") {
            togglePlayPause();
          }
        }
      },
      [focusUpNextCta, isAudioOnly, seekBy, togglePlayPause],
    ),
  );

  // Trigger 2: the transport bar dismissed (patched react-native-video emits this on tvOS
  // after the hide transition completes, once the bar has released focus containment).
  const handleControlsVisibilityChange = useCallback(
    ({ isVisible }: OnControlsVisibilityChange) => {
      if (!isVisible) {
        focusUpNextCta("controls-hidden");
      }
    },
    [focusUpNextCta],
  );

  // Queue: skip to next video immediately. Guarded so a CTA press racing the
  // countdown reaching zero can't advance the queue twice.
  const handleQueueSkip = useCallback(() => {
    if (!showUpNextRef.current) return;
    showUpNextRef.current = false;
    setShowUpNext(false);
    handlePlaybackEnd();
  }, [handlePlaybackEnd]);

  // Handle back navigation
  const handleBack = useCallback(() => {
    try {
      pause();
    } catch (_error) {
      // Ignore errors - player may already be cleaning up
    }
    if (isQueueMode) {
      clear();
    }
    router.back();
  }, [pause, router, isQueueMode, clear]);

  // Phone drag-down / pinch-in dismissal — every exit path funnels through handleBack.
  const { dismissGesture, dismissAnimatedStyle } = usePlayerDismissGesture(handleBack);

  // Menu is deliberately NOT handled in JS: the native stack pops this screen (stack rule,
  // same as filters/photo-viewer); a JS handler races the press's native delivery and pops
  // twice (see memories/CLAUDE-lessons-learned.md, e136575). The native pop only happens
  // while tvOS focus sits INSIDE this pushed screen — video's transport UI provides that;
  // audio-only exposes no focusable UI, so the focus holder rendered below provides it.

  // Handle Android TV back button
  useEffect(() => {
    if (Platform.OS === "android") {
      const backHandler = BackHandler.addEventListener("hardwareBackPress", () => {
        handleBack();
        return true;
      });

      return () => backHandler.remove();
    }
  }, [handleBack]);

  // Pause player when entering error state
  useEffect(() => {
    if (state.type === "ERROR") {
      try {
        pause();
      } catch (_error) {
        // Ignore errors - player may not be initialized
      }
    }
  }, [state.type, pause]);

  // Render error state (but not if auto-retry is in progress)
  if (state.type === "ERROR") {
    // If we can retry with transcoding, show loading overlay instead of error
    // This prevents flashing an error message during automatic retry
    if (state.canRetryWithTranscode) {
      return (
        <View style={styles.container}>
          <View style={styles.loadingOverlay}>
            <ActivityIndicator size="large" color="#FFFFFF" />
          </View>
          {/* Nothing else on this branch is focusable — same Menu hazard as audio (see below). */}
          {Platform.isTV && <Pressable isTVSelectable hasTVPreferredFocus onPress={() => {}} style={styles.focusHolder} accessibilityElementsHidden importantForAccessibility="no-hide-descendants" />}
        </View>
      );
    }

    // Only show error UI if retry is not possible or has already failed
    return (
      <View style={styles.errorContainer}>
        <Ionicons name="alert-circle-outline" size={64} color="#FF3B30" />
        <Text style={styles.errorTitle}>Unable to Play</Text>
        <Text style={styles.errorText}>{state.error}</Text>

        <View style={styles.buttonGroup}>
          <FocusableButton title="Retry" onPress={retry} variant="retry" style={styles.button} hasTVPreferredFocus={true} />
          <FocusableButton title="Go Back" onPress={handleBack} variant="secondary" style={styles.button} />
        </View>
      </View>
    );
  }

  // Render video player with native controls (also handles audio-only files).
  // onAccessibilityEscape: VoiceOver's two-finger Z scrub — the assistive counterpart of the
  // dismiss gestures, which VoiceOver users can't perform.
  const playerBody = (
    <Animated.View style={[styles.container, dismissAnimatedStyle]} onAccessibilityEscape={handleBack}>
      {/* Video Player with Native Controls */}
      {sourceUri && (
        <Video
          key={sourceUri} // Force remount when switching from direct play to transcoding
          ref={videoRef}
          source={{
            uri: sourceUri,
            // jellyfin-multi:// is treated as network by patched react-native-video
          }}
          style={styles.video}
          resizeMode="contain"
          controls={true}
          paused={paused}
          allowsExternalPlayback={true}
          onControlsVisibilityChange={handleControlsVisibilityChange}
          {...wrappedCallbacks}
        />
      )}

      {/* Album/song artwork for audio-only playback (same poster as the gallery).
          TV: big centered art (AVKit shows no chrome for audio there). */}
      {audioPosterSource && Platform.isTV && (
        <View style={styles.audioPosterOverlay} pointerEvents="none">
          <Image
            source={audioPosterSource}
            style={styles.audioPoster}
            contentFit="contain"
            transition={200}
            cachePolicy="memory-disk"
            accessible={true}
            accessibilityLabel={`${videoDetails?.Name || "Audio"} poster`}
          />
        </View>
      )}

      {/* Phone: a small framed squircle pinned top-center — below the native top buttons, above
          the center play/pause glyph — so none of the AVPlayerViewController chrome is covered.
          Size and offset scale with the window height, which is what keeps it clear of the
          center glyph in landscape too. The image keeps its own aspect ratio (scaled whole,
          never cropped) and the rounding hugs its real edges. Tapping the art closes the player. */}
      {audioPosterSource && !Platform.isTV && (
        <View style={[styles.audioPosterOverlayPhone, { top: posterTop }]} pointerEvents="box-none">
          <Pressable
            style={[styles.audioPosterFramePhone, { borderRadius: posterRadius }]}
            onPress={handleBack}
            accessibilityRole="button"
            accessibilityLabel="Close player"
            accessibilityHint="Stops playback and goes back">
            <Image
              source={audioPosterSource}
              style={[styles.audioPosterPhone, { height: posterHeight, aspectRatio: videoDetails?.PrimaryImageAspectRatio || 1, borderRadius: posterRadius - 1 }]}
              contentFit="cover"
              transition={200}
              cachePolicy="memory-disk"
              accessible={false}
            />
          </Pressable>
        </View>
      )}

      {/* Loading Overlay */}
      {showLoadingOverlay && (
        <View style={styles.loadingOverlay}>
          <ActivityIndicator size="large" color="#FFFFFF" />
        </View>
      )}

      {/* Up Next Overlay (queue mode) */}
      {isQueueMode && nextVideo && (
        <UpNextOverlay nextVideoName={nextVideo.Name} progress={progress} onSkip={handleQueueSkip} visible={showUpNext} upNextProgress={upNextProgress} ctaRef={upNextCtaRef} />
      )}

      {/* tvOS: AVPlayerViewController's audio presentation exposes no focusable UI, and neither
          does the screen while the stream is still resolving (no Video mounted yet). Without focus
          inside this pushed screen the Menu press reaches nothing that pops — the system backgrounds
          the app instead. An invisible in-screen focus target makes Menu pop natively, exactly like
          video's focusable transport does once it loads (library-grid/photo-viewer holder pattern).
          Since the holder owns focus, select never reaches AVKit either — for playing audio it
          toggles play/pause (select arrives as onPress on the focused view, never as a TV event). */}
      {Platform.isTV && (isAudioOnly || !sourceUri) && (
        <Pressable
          isTVSelectable
          hasTVPreferredFocus
          onPress={isAudioOnly && sourceUri ? togglePlayPause : () => {}}
          style={styles.focusHolder}
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
        />
      )}
    </Animated.View>
  );

  // Phone: the dismiss gestures wrap the whole screen. Pan activates only on a straight-down
  // drag (taps and AVKit's horizontal scrub pass through); pinch-in closes at 0.75 — the
  // accepted tradeoff is that AVKit's own pinch aspect-fill toggle is unreachable. TV renders
  // bare: Menu pops natively, no gesture layer.
  return Platform.isTV ? (
    playerBody
  ) : (
    <GestureHandlerRootView style={styles.container}>
      <GestureDetector gesture={dismissGesture}>{playerBody}</GestureDetector>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#000000",
  },
  video: {
    flex: 1,
    width: "100%",
    height: "100%",
  },
  audioPosterOverlay: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    justifyContent: "center",
    alignItems: "center",
    // Clear the native transport controls at the bottom of the player
    paddingBottom: "18%",
    paddingTop: "6%",
  },
  audioPoster: {
    width: "60%",
    height: "100%",
  },
  // Phone: horizontal centering only — the vertical position (safe-area top + clearance for the
  // native fullscreen/AirPlay/volume buttons) is applied inline. Works unchanged in landscape,
  // where those buttons hug the same top edge.
  audioPosterOverlayPhone: {
    position: "absolute",
    left: 0,
    right: 0,
    alignItems: "center",
  },
  // Hairline frame + soft glow lift the art off the black canvas — a dark shadow is invisible
  // here, so the "shadow" is a grayish bloom instead. iOS needs a solid background behind the
  // layer to rasterize it; the frame's dark fill provides it and is never seen (the image covers
  // it edge to edge). No overflow:hidden here — masksToBounds would clip the glow; the image
  // rounds itself.
  audioPosterFramePhone: {
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.45)",
    backgroundColor: "#1C1C1E",
    borderCurve: "continuous",
    shadowColor: "#C7C7CC",
    shadowOpacity: 0.45,
    shadowRadius: 22,
    shadowOffset: { width: 0, height: 6 },
  },
  // Height, aspect ratio and radius are window-derived, applied inline.
  audioPosterPhone: {
    borderCurve: "continuous",
    overflow: "hidden",
  },
  loadingOverlay: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "#000000",
    zIndex: 100,
  },
  // Invisible tvOS focus anchor for audio-only playback (see render comment). Fills the
  // area so the focus engine has a reliable target; transparent and non-interactive.
  focusHolder: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
  errorContainer: {
    flex: 1,
    backgroundColor: "#000000",
    justifyContent: "center",
    alignItems: "center",
    padding: 40,
  },
  errorTitle: {
    marginTop: 16,
    fontSize: 28,
    fontWeight: "700",
    color: "#FFFFFF",
    textAlign: "center",
  },
  errorText: {
    marginTop: 8,
    fontSize: 18,
    color: "#98989D",
    textAlign: "center",
    lineHeight: 26,
  },
  buttonGroup: {
    gap: Platform.isTV ? 16 : 12,
    marginTop: Platform.isTV ? 32 : 24,
    alignItems: "center",
  },
  button: {
    minWidth: Platform.isTV ? 300 : 250,
  },
  retryButton: {
    marginTop: 24,
    paddingHorizontal: 32,
    paddingVertical: 12,
    backgroundColor: "#FFC312",
    borderRadius: 8,
  },
  retryButtonText: {
    fontSize: 16,
    fontWeight: "600",
    color: "#FFFFFF",
  },
  backButton: {
    backgroundColor: "#8E8E93",
    marginTop: 12,
  },
});
