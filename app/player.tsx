import { FocusableButton } from "@/components/FocusableButton";
import { UpNextOverlay } from "@/components/up-next-overlay";
import { useLibrary } from "@/contexts/LibraryContext";
import { useLoading } from "@/contexts/LoadingContext";
import { usePlayQueue } from "@/contexts/PlayQueueContext";
import { useVideoPlayback } from "@/hooks/useVideoPlayback";
import { getPosterUrl, hasPoster } from "@/services/jellyfinApi";
import { logger } from "@/utils/logger";
import { Ionicons } from "@expo/vector-icons";
import { Image } from "expo-image";
import { useLocalSearchParams, useRouter } from "expo-router";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Video from "react-native-video";
import type { OnLoadData, OnProgressData } from "react-native-video";
import { ActivityIndicator, BackHandler, LogBox, Platform, Pressable, StyleSheet, Text, View } from "react-native";

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

export default function VideoPlayerScreen() {
  const params = useLocalSearchParams<{
    videoId: string;
    videoName: string;
    playlistIndex?: string;
    queueMode?: string;
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

  // Use the video playback hook with state machine
  const { videoRef, sourceUri, paused, videoCallbacks, state, showLoadingOverlay, pause, retry, videoDetails, isAudioOnly } = useVideoPlayback({
    videoId: params.videoId,
    onPlaybackEnd: handlePlaybackEnd,
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

  // Render video player with native controls (also handles audio-only files)
  return (
    <View style={styles.container}>
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
          {...wrappedCallbacks}
        />
      )}

      {/* Album/song artwork for audio-only playback (same poster as the gallery).
          Kept clear of the bottom so the native transport controls stay visible. */}
      {audioPosterSource && (
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
      {isQueueMode && nextVideo && <UpNextOverlay nextVideoName={nextVideo.Name} progress={progress} onSkip={handleQueueSkip} visible={showUpNext} upNextProgress={upNextProgress} paused={paused} />}

      {/* tvOS: AVPlayerViewController's audio presentation exposes no focusable UI, and neither
          does the screen while the stream is still resolving (no Video mounted yet). Without focus
          inside this pushed screen the Menu press reaches nothing that pops — the system backgrounds
          the app instead. An invisible in-screen focus target makes Menu pop natively, exactly like
          video's focusable transport does once it loads (library-grid/photo-viewer holder pattern). */}
      {Platform.isTV && (isAudioOnly || !sourceUri) && (
        <Pressable isTVSelectable hasTVPreferredFocus onPress={() => {}} style={styles.focusHolder} accessibilityElementsHidden importantForAccessibility="no-hide-descendants" />
      )}

      {/* No overlay close on iOS: the edge-swipe back gesture dismisses the pushed screen,
          and any floating button ends up in the way of the native controls. */}
    </View>
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
