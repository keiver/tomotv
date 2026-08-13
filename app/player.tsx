import { FocusableButton } from "@/components/FocusableButton";
import { ImageSubtitleOverlay } from "@/components/image-subtitle-overlay";
import { PlayerLoadingOverlay } from "@/components/player-loading-overlay";
import { UpNextInterstitial } from "@/components/up-next-interstitial";
import { useLoadingActions } from "@/contexts/LoadingContext";
import { usePlayQueue } from "@/contexts/PlayQueueContext";
import { setForegroundRefreshHold } from "@/hooks/useAppStateRefresh";
import { useVideoPlayback } from "@/hooks/useVideoPlayback";
import { fetchMediaSegments, getPosterUrl, hasPoster, type ItemMediaSegments } from "@/services/jellyfinApi";
import { JellyfinVideoItem } from "@/types/jellyfin";
import { libraryManager } from "@/services/libraryManager";
import { logger } from "@/utils/logger";
import { Ionicons } from "@expo/vector-icons";
import * as Linking from "expo-linking";
import { useLocalSearchParams, useRouter } from "expo-router";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Video from "react-native-video";
import type { OnLoadData, OnPictureInPictureStatusChangedData, OnVideoErrorData } from "react-native-video";
import { BackHandler, LogBox, Platform, StyleSheet, Text, View } from "react-native";

// Suppress known warnings
LogBox.ignoreLogs([
  "JS object is no longer associated",
  "Operation requires a client callback",
  "Operation requires a client data source",
  "Cannot Open", // Direct play failures that trigger automatic transcoding retry
  "Failed to load the player item", // Player errors during automatic retry
]);

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
  const { queue, currentIndex, hasNext, nextVideo, advanceToNext, jumpTo, clear } = usePlayQueue();

  const isQueueMode = params.queueMode === "true";

  // Parse playlist index
  const currentPlaylistIndex = params.playlistIndex ? parseInt(params.playlistIndex, 10) : -1;

  // Queue mode: the next episode announced between episodes (null = no interstitial showing)
  const [upNext, setUpNext] = useState<JellyfinVideoItem | null>(null);

  // One-shot for every path that pops this screen: handleBack, and the direct router.back()
  // exits below. react-native-video can deliver onEnd more than once, and a second pop would
  // eject whatever screen is beneath this one.
  const dismissedRef = useRef(false);

  // Handle playback end. Queue mode with a next episode: phone shows the RN Up Next
  // interstitial (its countdown/CTAs decide what happens — the presented player is
  // already dismissed by the onEnd wrapper, so the RN layer is visible). TV does
  // NOTHING here: the native content proposal owns the advance (it presents at the
  // outro/end and auto-accepts 5s after playback ends; mounting the RN card on top
  // would double up, and an RN overlay above AVKit is banned by the focus lesson).
  // End of queue and legacy playlist keep their immediate behavior.
  const handlePlaybackEnd = useCallback(() => {
    if (isQueueMode) {
      if (hasNext && nextVideo) {
        if (Platform.isTV) {
          logger.info("Queue: video ended, native proposal owns the advance", { service: "VideoPlayer", nextVideoName: nextVideo.Name });
          return;
        }
        logger.info("Queue: video ended, announcing next", { service: "VideoPlayer", nextVideoName: nextVideo.Name });
        setUpNext(nextVideo);
        return;
      }
      // End of queue
      if (dismissedRef.current) return;
      dismissedRef.current = true;
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
      if (dismissedRef.current) return;
      dismissedRef.current = true;
      logger.info("End of playlist, going back to library", { service: "VideoPlayer" });
      router.back();
    }
  }, [isQueueMode, hasNext, nextVideo, clear, currentPlaylistIndex, router, showGlobalLoader]);

  // Media segment markers (Intro/Outro) for this item: the Intro times the
  // tvOS Skip Intro pill, the Outro the Up Next proposal and Skip Credits pill.
  // Fire-and-forget — nulls just mean no skip affordances.
  const [segments, setSegments] = useState<ItemMediaSegments | null>(null);
  useEffect(() => {
    let cancelled = false;
    fetchMediaSegments(params.videoId).then((result) => {
      if (!cancelled) setSegments(result);
    });
    return () => {
      cancelled = true;
    };
  }, [params.videoId]);

  // Use the video playback hook with state machine
  const { videoRef, sourceUri, paused, videoCallbacks, state, showLoadingOverlay, pause, retry, videoDetails, imageSubtitleSessionUrl, activeImageSubtitleStream, currentTimeRef } = useVideoPlayback({
    videoId: params.videoId,
    startPositionTicks: params.startTicks ? Number(params.startTicks) : undefined,
    playedAtStart: params.played === undefined ? undefined : params.played === "true",
    onPlaybackEnd: handlePlaybackEnd,
    probe: params.probe === "1",
  });

  // tvOS queue mode: the native AVContentProposal (patched into react-native-video)
  // replaces the RN interstitial — poster + title + Play Now/Close over the outro,
  // native countdown auto-accepting 5s after playback ends (AVKit counts the
  // interval from playback END, so credits play out first even with an early
  // proposal). Undefined on phone and when nothing is up next.
  const contentProposal = useMemo(() => {
    if (!Platform.isTV || !isQueueMode || !nextVideo) return undefined;
    return {
      title: nextVideo.Name,
      ...(hasPoster(nextVideo) ? { imageUri: getPosterUrl(nextVideo.Id, 600) } : {}),
      ...(segments?.outro ? { startTimeSeconds: segments.outro.startSeconds } : {}),
      autoAcceptSeconds: 5,
    };
  }, [isQueueMode, nextVideo, segments]);

  // tvOS "Up Next" tab in the swipe-down info panel (patched infoPanelItems
  // prop → customInfoViewControllers): the queue's upcoming items as focusable
  // cards, capped at 30. Selecting one jumps the queue there (handler below).
  const infoPanelItems = useMemo(() => {
    if (!Platform.isTV || !isQueueMode || currentIndex < 0) return undefined;
    const upcoming = queue.slice(currentIndex + 1, currentIndex + 31).map((item) => ({
      id: item.Id,
      title: item.Name,
      subtitle: [item.SeriesName, item.IndexNumber != null ? `Episode ${item.IndexNumber}` : null].filter(Boolean).join(" · "),
      ...(hasPoster(item) ? { imageUri: getPosterUrl(item.Id, 450) } : {}),
    }));
    return upcoming.length > 0 ? upcoming : undefined;
  }, [queue, currentIndex, isQueueMode]);

  // tvOS timed pills (AVKit-rendered, patched contextualActions prop): Skip
  // Intro during the intro window; Skip Credits during the outro only OUTSIDE
  // queue mode — in queue mode the Up Next proposal owns the outro. Window
  // ends are trimmed by 1s so a pill never fights its own boundary seek (or
  // the auto-skip's).
  const contextualActions = useMemo(() => {
    if (!Platform.isTV || !segments) return undefined;
    const actions = [];
    if (segments.intro) {
      actions.push({ title: "Skip Intro", startSeconds: segments.intro.startSeconds, endSeconds: segments.intro.endSeconds - 1, seekToSeconds: segments.intro.endSeconds });
    }
    if (segments.outro && !isQueueMode) {
      actions.push({ title: "Skip Credits", startSeconds: segments.outro.startSeconds, endSeconds: segments.outro.endSeconds - 1, seekToSeconds: segments.outro.endSeconds });
    }
    return actions.length > 0 ? actions : undefined;
  }, [segments, isQueueMode]);

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

  // PiP "return to app": AVKit parks the restore transition on a completion handler and
  // waits for JS to answer. This screen is still mounted (PiP never pops the route), so
  // the full player is already the UI to restore — answer immediately or the transition stalls.
  const handleRestoreFromPip = useCallback(() => {
    videoRef.current?.restoreUserInterfaceForPictureInPictureStopCompleted(true);
  }, [videoRef]);

  // Handle back navigation. Shares the one-shot above: a duplicate arrival during the pop
  // transition must not pop the stack a second time. setFullScreen(false) is a native no-op
  // unless the presentation is actually up.
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

  // Interstitial CTAs. Play Now (and the 5s countdown expiring) advances the queue —
  // the router.replace remounts the body for the next episode, which re-presents on load.
  // Close stops the binge: the queue clears and the player screen pops.
  // One-shot across both CTAs: the countdown expiring, a Play Now tap, and Close can queue
  // in the same JS tick; a second arrival must not advance the queue again (skipping an
  // episode, or popping the freshly mounted next player once the queue is drained).
  const interstitialHandledRef = useRef(false);
  const handleInterstitialPlay = useCallback(() => {
    if (interstitialHandledRef.current || dismissedRef.current) return;
    interstitialHandledRef.current = true;
    const next = advanceToNext();
    setUpNext(null);
    if (!next) {
      handleBack();
      return;
    }
    logger.info("Queue: advancing to next video", { service: "VideoPlayer", videoName: next.Name });
    showGlobalLoader();
    router.replace({
      pathname: "/player" as const,
      params: {
        videoId: next.Id,
        videoName: next.Name,
        queueMode: "true",
      },
    });
  }, [advanceToNext, handleBack, router, showGlobalLoader]);

  const handleInterstitialClose = useCallback(() => {
    if (interstitialHandledRef.current) return;
    interstitialHandledRef.current = true;
    setUpNext(null);
    handleBack();
  }, [handleBack]);

  // Info-panel Up Next selection (tvOS): jump the queue to the picked item and
  // remount the player on it — the mid-video equivalent of a Continue Watching
  // tap, so no end-transition one-shot guards apply.
  const handleInfoPanelItemSelected = useCallback(
    (e: { id: string }) => {
      const target = jumpTo(e.id);
      if (!target) return;
      logger.info("Info panel: jumping to queue item", { service: "VideoPlayer", videoName: target.Name });
      showGlobalLoader();
      router.replace({
        pathname: "/player" as const,
        params: {
          videoId: target.Id,
          videoName: target.Name,
          queueMode: "true",
        },
      });
    },
    [jumpTo, router, showGlobalLoader],
  );

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
  // Closing curtain: opaque black over the inline video. A user ✕/swipe dismissal only
  // reaches native code AFTER the slide-down finished (viewDidDisappear), and the lib
  // re-embeds the same player inline on the next runloop tick — faster than any JS
  // reaction to the dismiss event, so a reactive cover would leak frames of chromeless
  // video. Instead the curtain goes up invisibly BEHIND the presentation as soon as it's
  // confirmed on screen (DidPresent), so the re-embed lands under it and every close pops
  // over black. It comes down only when a dismissal turns out to be the PiP hand-off,
  // where the inline player behind the PiP window is the accepted UI.
  const [curtainUp, setCurtainUp] = useState(false);
  const presentedCallbacks = useMemo(() => {
    if (!presentsNativeFullscreen) return videoCallbacks;
    return {
      ...videoCallbacks,
      onFullscreenPlayerDidPresent: () => setCurtainUp(true),
      onLoad: (data: OnLoadData) => {
        videoCallbacks.onLoad(data);
        if (!dismissedRef.current) {
          programmaticDismissRef.current = false;
          videoRef.current?.setFullScreen(true);
        }
      },
      onError: (error: OnVideoErrorData) => {
        programmaticDismissRef.current = true;
        videoRef.current?.setFullScreen(false);
        videoCallbacks.onError(error);
      },
      onEnd: () => {
        programmaticDismissRef.current = true;
        videoRef.current?.setFullScreen(false);
        videoCallbacks.onEnd();
      },
    };
  }, [presentsNativeFullscreen, videoCallbacks, videoRef]);

  // Intrinsic video size, needed to place bitmap subtitles: they carry absolute
  // coordinates in the subtitle canvas, and mapping that onto the screen needs
  // the letterbox resizeMode="contain" produces. Captured on both lanes, since
  // presentedCallbacks passes videoCallbacks straight through on tvOS.
  const [videoSize, setVideoSize] = useState({ width: 0, height: 0 });

  // AVKit's transport controls, and the area it says they will not cover.
  //
  // A bottom-positioned cue lands across the scrubber unless it is lifted while
  // the controls are up, which is what AVKit does with its own captions.
  // `unobscuredBottom` is AVPlayerViewController.unobscuredContentGuide,
  // reported by the patch in the overlay's coordinate space, so the lift uses
  // Apple's geometry instead of a guessed fraction of the screen. tvOS only:
  // it is null everywhere else and the overlay falls back accordingly.
  const [controls, setControls] = useState<{ visible: boolean; unobscuredBottom: number | null }>({ visible: false, unobscuredBottom: null });

  const playerCallbacks = useMemo(
    () => ({
      ...presentedCallbacks,
      onLoad: (data: OnLoadData) => {
        if (data.naturalSize?.width && data.naturalSize?.height) {
          setVideoSize({ width: data.naturalSize.width, height: data.naturalSize.height });
        }
        presentedCallbacks.onLoad(data);
      },
      onControlsVisibilityChange: (event: { isVisible: boolean; unobscuredBottom?: number }) =>
        setControls({ visible: event.isVisible, unobscuredBottom: typeof event.unobscuredBottom === "number" ? event.unobscuredBottom : null }),
    }),
    [presentedCallbacks],
  );

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
        setCurtainUp(false);
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
  // while tvOS focus sits INSIDE this pushed screen — video's transport UI provides that once it
  // is on screen, and PlayerLoadingOverlay provides it (as the topmost view) for every state where
  // the loading canvas hides that transport.

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
          <PlayerLoadingOverlay />
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
          // RNV hard-disables AVKit's own now-playing publishing (updatesNowPlayingInfoCenter
          // = false); this prop is what turns on the lib's replacement publisher, which feeds
          // the AirPlay route sheet / lock screen card from source.metadata (title + poster).
          // Not on TV: it registers global MPRemoteCommandCenter targets that would compete
          // with the Siri remote's tuned seek/pause handling.
          showNotificationControls={!Platform.isTV}
          playWhenInactive={true} // Keep playing through the resign-active window so PiP entry doesn't find a paused player
          // tvOS native Up Next (undefined on phone / without a next item). The
          // CTAs map onto the SAME one-shot interstitial handlers: accept =
          // Play Now (advance the queue), reject = Close (stop the binge).
          contentProposal={contentProposal}
          onContentProposalAccepted={handleInterstitialPlay}
          onContentProposalRejected={handleInterstitialClose}
          contextualActions={contextualActions}
          infoPanelItems={infoPanelItems}
          onInfoPanelItemSelected={handleInfoPanelItemSelected}
          // The presented player coming down: ✕, swipe-down, a PiP hand-off, or our own
          // onEnd/onError dismissals — the handler closes only for the first two.
          onFullscreenPlayerWillDismiss={handlePresentationDismiss}
          onPictureInPictureStatusChanged={handlePipStatusChanged}
          onRestoreUserInterfaceForPictureInPictureStop={handleRestoreFromPip}
          {...playerCallbacks}>
          {/* A child of <Video> is inserted into AVKit's contentOverlayView
              (RCTVideo.insertReactSubview). Apple documents that layer as
              holding "custom views between the video content and the controls",
              but a bitmap has been photographed drawing across the transport
              bar on tvOS 26, so the actual z-order is not settled. Either way
              the cues are kept inside unobscuredContentGuide while the controls
              are up, which is the supported way to stay clear of them.
              Bitmap subtitles are the one thing we draw here; the native chrome
              stays the product. Renders nothing unless an image track is
              selected. */}
          <ImageSubtitleOverlay
            sessionUrl={imageSubtitleSessionUrl}
            streamIndex={activeImageSubtitleStream}
            currentTimeRef={currentTimeRef}
            videoWidth={videoSize.width}
            videoHeight={videoSize.height}
            controlsVisible={controls.visible}
            unobscuredBottom={controls.unobscuredBottom}
          />
        </Video>
      )}

      {/* Closing curtain (phone): pre-mounted behind the presentation so the lib's
          post-dismissal inline re-embed can never flash video during the route pop. */}
      {curtainUp && <View style={styles.closingCurtain} pointerEvents="none" />}

      {/* Loading canvas, and the screen's tvOS focus anchor while it is up: it covers AVKit's
          transport bar, so on TV it has to BE the focusable or Menu has nothing to pop from (see
          the component). Also rendered before the stream resolves — the IDLE first pass is not
          part of showLoadingOverlay, and that gap is a stranded-focus window too. */}
      {(showLoadingOverlay || !sourceUri) && <PlayerLoadingOverlay />}

      {/* Between-episodes Up Next screen (queue mode): mounts at video end, after the
          presented player is already dismissed, so it owns the whole screen. Countdown
          auto-advances; Close stops the binge. */}
      {upNext && <UpNextInterstitial nextVideo={upNext} onPlayNext={handleInterstitialPlay} onClose={handleInterstitialClose} />}
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
  closingCurtain: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: "#000000",
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
