import { FocusableButton } from "@/components/FocusableButton";
import { UpNextOverlay } from "@/components/up-next-overlay";
import { useLoadingActions } from "@/contexts/LoadingContext";
import { usePlayQueue } from "@/contexts/PlayQueueContext";
import { setForegroundRefreshHold } from "@/hooks/useAppStateRefresh";
import { useVideoPlayback } from "@/hooks/useVideoPlayback";
import { getPosterUrl, hasPoster } from "@/services/jellyfinApi";
import { libraryManager } from "@/services/libraryManager";
import { logger } from "@/utils/logger";
import { Ionicons } from "@expo/vector-icons";
import { Image } from "expo-image";
import * as Linking from "expo-linking";
import { useLocalSearchParams, useRouter } from "expo-router";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Video from "react-native-video";
import type { OnControlsVisibilityChange, OnLoadData, OnPictureInPictureStatusChangedData, OnProgressData, OnVideoErrorData } from "react-native-video";
import { ActivityIndicator, BackHandler, LogBox, Platform, Pressable, StyleSheet, Text, useTVEventHandler, View } from "react-native";

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
  const { hideGlobalLoader, showGlobalLoader } = useLoadingActions();
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
  const upNextDismissedRef = useRef(false);
  // Which overlay button holds TV focus ("cta" | "close" | null). Set on button focus,
  // cleared when the transport bar takes over or the overlay hides — never on blur,
  // so an in-flight focus move between the two buttons can't read as "unfocused".
  const upNextFocusRef = useRef<"cta" | "close" | null>(null);

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

    // Legacy playlist mode. Event-time read from the singleton, NOT useLibrary(): a context
    // subscription here re-renders the player (and churns handlePlaybackEnd into
    // useVideoPlayback) on every library notify during playback.
    const videos = libraryManager.getState().videos;
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
  }, [isQueueMode, hasNext, advanceToNext, clear, currentPlaylistIndex, router, showGlobalLoader]);

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

  // AirPlay / Now Playing metadata: react-native-video copies source.metadata into
  // the player item's externalMetadata (fetching imageUri as the artwork item),
  // which is what the AirPlay placeholder and info panel display. Without it those
  // surfaces show no title or image.
  const sourceMetadata = useMemo(() => {
    if (!videoDetails) return undefined;
    const imageUri = hasPoster(videoDetails) ? getPosterUrl(videoDetails.Id, 600) : "";
    return {
      title: videoDetails.Name,
      ...(imageUri ? { imageUri } : {}),
    };
  }, [videoDetails]);

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
          const inWindow = remaining <= upNextThresholdRef.current && remaining > 0;
          // Leaving the window (seek back, next video starting) re-arms a closed card.
          if (!inWindow) {
            upNextDismissedRef.current = false;
          }
          const shouldShow = inWindow && !upNextDismissedRef.current;
          if (shouldShow !== showUpNextRef.current) {
            showUpNextRef.current = shouldShow;
            setShowUpNext(shouldShow);
            if (!shouldShow) {
              upNextFocusRef.current = null;
            }
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
    // Once the overlay owns focus the engine navigates between CTA and ✕ on its own;
    // forcing here would yank an up press back to the CTA and make the ✕ unreachable.
    if (upNextFocusRef.current) return;
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
      if (isVisible) {
        // Transport bar owns focus containment while visible — the overlay lost it.
        upNextFocusRef.current = null;
      } else {
        focusUpNextCta("controls-hidden");
      }
    },
    [focusUpNextCta],
  );

  const handleUpNextButtonFocus = useCallback((button: "cta" | "close") => {
    upNextFocusRef.current = button;
  }, []);

  // PiP "return to app": AVKit parks the restore transition on a completion handler and
  // waits for JS to answer. This screen is still mounted (PiP never pops the route), so
  // the full player is already the UI to restore — answer immediately or the transition stalls.
  const handleRestoreFromPip = useCallback(() => {
    videoRef.current?.restoreUserInterfaceForPictureInPictureStopCompleted(true);
  }, [videoRef]);

  // Close hides the card for the rest of this video; auto-advance at video end
  // still happens (closing dismisses the dialog, it doesn't cancel the queue).
  const handleUpNextClose = useCallback(() => {
    upNextDismissedRef.current = true;
    showUpNextRef.current = false;
    upNextFocusRef.current = null;
    setShowUpNext(false);
  }, []);

  // Queue: skip to next video immediately. Guarded so a CTA press racing the
  // countdown reaching zero can't advance the queue twice.
  const handleQueueSkip = useCallback(() => {
    if (!showUpNextRef.current) return;
    showUpNextRef.current = false;
    upNextFocusRef.current = null;
    setShowUpNext(false);
    handlePlaybackEnd();
  }, [handlePlaybackEnd]);

  // Handle back navigation. One-shot: every exit path funnels here, so a duplicate arrival
  // during the pop transition must not pop the stack a second time. setFullScreen(false) is
  // a native no-op unless the presentation is actually up.
  const dismissedRef = useRef(false);
  const handleBack = useCallback(() => {
    if (dismissedRef.current) return;
    dismissedRef.current = true;
    videoRef.current?.setFullScreen(false);
    try {
      pause();
    } catch (_error) {
      // Ignore errors - player may already be cleaning up
    }
    if (isQueueMode) {
      clear();
    }
    router.back();
  }, [pause, router, isQueueMode, clear, videoRef]);

  // Phone playback (video AND audio) lives inside AVKit's PRESENTED player — Apple's default
  // full-screen state: every native control works and the stock ✕ is visible from the start
  // (no expand arrow). Presented on onLoad (the native setter no-ops before the AVPlayer
  // exists), skipped if a dismissal already started. onError/onEnd dismiss BEFORE their
  // navigation unmounts <Video> (the lib never dismisses a presentation on teardown —
  // stranding one freezes the app), flagged so the dismissal event they trigger isn't read as
  // a user close. Audio note: the RN poster squircle renders behind the presentation, so
  // presented audio shows AVKit's own audio chrome instead.
  const presentsNativeFullscreen = Platform.OS === "ios" && !Platform.isTV;
  const programmaticDismissRef = useRef(false);
  const presentedCallbacks = useMemo(() => {
    if (!presentsNativeFullscreen) return wrappedCallbacks;
    return {
      ...wrappedCallbacks,
      onLoad: (data: OnLoadData) => {
        wrappedCallbacks.onLoad(data);
        if (!dismissedRef.current) {
          programmaticDismissRef.current = false;
          videoRef.current?.setFullScreen(true);
        }
      },
      onError: (error: OnVideoErrorData) => {
        programmaticDismissRef.current = true;
        videoRef.current?.setFullScreen(false);
        wrappedCallbacks.onError(error);
      },
      onEnd: () => {
        programmaticDismissRef.current = true;
        videoRef.current?.setFullScreen(false);
        wrappedCallbacks.onEnd();
      },
    };
  }, [presentsNativeFullscreen, wrappedCallbacks, videoRef]);

  // PiP: tapping AVKit's PiP button auto-dismisses the presentation (AVKit default), and the
  // lib's cleanup re-embeds the same player inline behind it. ACCEPTED tradeoff: PiP plays,
  // the screen behind shows the same video inline, and that inline player is fully functional.
  // The auto-dismissal must not read as a close (popping the route would unmount <Video> and
  // kill PiP), so the close decision is deferred one beat: if PiP turned out to be starting,
  // the dismissal is swallowed and the PiP flag is CONSUMED (one-shot hand-off). Consuming it
  // matters: the lib detaches the first PiP session's delegate during that same cleanup, so no
  // end-of-PiP signal ever arrives, and a sticky flag would suppress every later close — the
  // "can't leave the player" trap. Dismissals after the hand-off window (e.g. manual expand →
  // ✕ on the inline player) close normally.
  const pipActiveRef = useRef(false);
  const pipHandoffUntilRef = useRef(0);
  const pendingCloseRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const handlePresentationDismiss = useCallback(() => {
    if (dismissedRef.current || programmaticDismissRef.current) return;
    if (Date.now() < pipHandoffUntilRef.current) return; // duplicate event from the hand-off burst
    if (pendingCloseRef.current) clearTimeout(pendingCloseRef.current);
    pendingCloseRef.current = setTimeout(() => {
      pendingCloseRef.current = null;
      if (pipActiveRef.current) {
        pipHandoffUntilRef.current = Date.now() + 1500;
        pipActiveRef.current = false;
        return;
      }
      handleBack();
    }, 250);
  }, [handleBack]);

  useEffect(() => {
    return () => {
      if (pendingCloseRef.current) clearTimeout(pendingCloseRef.current);
    };
  }, []);

  const handlePipStatusChanged = useCallback(({ isActive }: OnPictureInPictureStatusChangedData) => {
    pipActiveRef.current = isActive;
  }, []);

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
    <View style={styles.container} onAccessibilityEscape={handleBack}>
      {/* Video Player with Native Controls */}
      {sourceUri && (
        <Video
          key={sourceUri} // Force remount when switching from direct play to transcoding
          ref={videoRef}
          source={{
            uri: sourceUri,
            // jellyfin-multi:// is treated as network by patched react-native-video
            metadata: sourceMetadata,
          }}
          style={styles.video}
          resizeMode="contain"
          controls={true}
          paused={paused}
          allowsExternalPlayback={true}
          // showNotificationControls stays OFF (both platforms): the lib's replacement
          // now-playing publisher (NowPlayingInfoCenterManager) sync-loads asset.duration and
          // asset.commonMetadata 4x/sec, holding the asset's property-loading lock and stalling
          // the main thread ("Asset property accessed synchronously" warnings + visible freezes).
          // Cost: no lock screen / AirPlay route-sheet card from source.metadata. Re-adding it
          // means patching that manager to cache per-item metadata first.
          playWhenInactive={true} // Keep playing through the resign-active window so PiP entry doesn't find a paused player
          // The presented player coming down: ✕, swipe-down, a PiP hand-off, or our own
          // onEnd/onError dismissals — the handler closes only for the first two.
          onFullscreenPlayerWillDismiss={handlePresentationDismiss}
          onPictureInPictureStatusChanged={handlePipStatusChanged}
          onRestoreUserInterfaceForPictureInPictureStop={handleRestoreFromPip}
          onControlsVisibilityChange={handleControlsVisibilityChange}
          {...presentedCallbacks}
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

      {/* Loading Overlay */}
      {showLoadingOverlay && (
        <View style={styles.loadingOverlay}>
          <ActivityIndicator size="large" color="#FFFFFF" />
        </View>
      )}

      {/* Up Next Overlay (queue mode) */}
      {isQueueMode && nextVideo && (
        <UpNextOverlay
          nextVideoName={nextVideo.Name}
          progress={progress}
          onSkip={handleQueueSkip}
          onClose={handleUpNextClose}
          visible={showUpNext}
          upNextProgress={upNextProgress}
          ctaRef={upNextCtaRef}
          onButtonFocus={handleUpNextButtonFocus}
        />
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
    </View>
  );

  // Phone dismissal is the presented player's own chrome (✕ / swipe-down); TV's Menu pops natively.
  return playerBody;
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
