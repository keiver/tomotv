import { useLoadingActions } from "@/contexts/LoadingContext";
import { audioPlayerManager, AudioPlayerUIState } from "@/services/audioPlayerManager";
import { fetchVideoDetails, getPosterUrl, hasPoster, JELLYFIN_TIME } from "@/services/jellyfinApi";
import { playQueueManager } from "@/services/playQueueManager";
import { logger } from "@/utils/logger";
import { Image } from "expo-image";
import { useLocalSearchParams, useRouter } from "expo-router";
import React, { useEffect, useRef, useState } from "react";
import { Platform, Pressable, StyleSheet, View } from "react-native";

// Same sizing rule as the video player's audio artwork.
const AUDIO_POSTER_SIZE = Platform.isTV ? 900 : 600;

/**
 * Audio playback screen. Playback itself is native (AVQueuePlayer + presented
 * AVPlayerViewController, owned by audioPlayerManager) and outlives this
 * screen on iPhone — the screen's only jobs are to hand the queue to the
 * manager, hold tvOS focus so Menu pops natively, paint artwork during the
 * moments the native UI isn't covering it, and pop itself when the user
 * dismisses the native player.
 */
export default function AudioPlayerScreen() {
  const params = useLocalSearchParams<{
    videoId: string;
    videoName?: string;
    queueMode?: string;
    startTicks?: string; // Resume position the launching screen already displayed
  }>();
  const router = useRouter();
  const { hideGlobalLoader } = useLoadingActions();

  const [playerState, setPlayerState] = useState<AudioPlayerUIState>(audioPlayerManager.getUIState());
  const startedRef = useRef(false);
  const poppedRef = useRef(false);
  const mountedRef = useRef(true);
  // Drops the queue-build listener and lets the pending wait fall through.
  const queueBuildAbortRef = useRef<(() => void) | null>(null);

  // Unmount tracking lives in its own []-effect, NOT in the cleanup of the start
  // effect below: that one depends on router and hideGlobalLoader, so a cleanup
  // there would fire on any dep-identity change and abort a start that is still
  // wanted. This fires only on a real unmount. Declared first so the flag is
  // true again before the start effect re-runs on a remount.
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      queueBuildAbortRef.current?.();
    };
  }, []);

  // Start (or re-attach to) the queue once per mount.
  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;

    // The launching screen fires buildQueue and pushes this route in the same
    // tick, so the queue may still be fetching on mount — wait for isLoading
    // to clear before reading it (both error and empty paths clear it too).
    const waitForQueueBuild = async () => {
      if (!playQueueManager.getState().isLoading) return playQueueManager.getState();
      await new Promise<void>((resolve) => {
        const finish = () => {
          unsubscribe();
          queueBuildAbortRef.current = null;
          resolve();
        };
        // The immediate subscribe callback sees isLoading true (checked
        // synchronously above), so unsubscribe is always assigned before any
        // resolving invocation runs.
        const unsubscribe = playQueueManager.subscribe((state) => {
          if (!state.isLoading) finish();
        });
        // Held so unmount can drop the listener: a screen dismissed mid-build
        // otherwise left it on the singleton for the life of the process.
        queueBuildAbortRef.current = finish;
      });
      return playQueueManager.getState();
    };

    const start = async () => {
      try {
        // Event-time read from the singleton (context subscription here would
        // re-render on every queue notify): queue mode plays the queue the
        // launching screen already built; anything else is a single track.
        const queueState = await waitForQueueBuild();
        // Backed out while the queue was still building. Starting now would
        // present the native player over whichever screen is on top instead.
        // Only guards a start that has not happened yet: once startQueue has
        // run, audio outliving this screen is the point (see the header).
        if (!mountedRef.current) return;
        const inQueue = params.queueMode === "true" && queueState.queue.some((item) => item.Id === params.videoId);

        let items = inQueue ? queueState.queue : null;
        if (!items) {
          const details = await fetchVideoDetails(params.videoId);
          if (!mountedRef.current) return;
          if (!details) {
            throw new Error("Item details unavailable");
          }
          items = [details];
        }

        await audioPlayerManager.startQueue(items, params.videoId, {
          loop: inQueue ? queueState.loop : false,
          startPositionSeconds: params.startTicks ? Number(params.startTicks) / JELLYFIN_TIME.TICKS_PER_SECOND : 0,
          sourceId: inQueue ? (queueState.sourceFolderId ?? params.videoId) : params.videoId,
        });
      } catch (error) {
        logger.error("Audio playback failed to start", error, { service: "AudioPlayer", videoId: params.videoId });
        if (!poppedRef.current) {
          poppedRef.current = true;
          router.back();
        }
      } finally {
        hideGlobalLoader();
      }
    };
    void start();
  }, [params.videoId, params.queueMode, params.startTicks, router, hideGlobalLoader]);

  // Pop when the user dismisses the native player (swipe/✕ on iPhone — music
  // keeps playing in the background; Menu on tvOS — playback stops).
  //
  // Only a FALL from visible counts. subscribe replays the current state
  // synchronously (audioPlayerManager.subscribe), and on mount that is uiVisible
  // false with startQueue not yet run — the old `startedRef` guard was already true
  // by then, so this screen popped itself before it could start anything and no
  // music ever played. A start failure pops from the catch above instead.
  const wasVisibleRef = useRef(false);
  useEffect(() => {
    return audioPlayerManager.subscribe((state) => {
      setPlayerState(state);
      if (state.uiVisible) {
        wasVisibleRef.current = true;
        return;
      }
      if (!wasVisibleRef.current || poppedRef.current) return;
      poppedRef.current = true;
      logger.info("Audio player: native UI dismissed, popping", { service: "AudioPlayer" });
      router.back();
    });
  }, [router]);

  const track = playerState.track;
  const posterId = track && hasPoster(track) ? track.Id : null;

  return (
    <View style={styles.container}>
      {/* Artwork behind the native presentation: visible during load and for
          the beat between dismissal and the route pop. */}
      {posterId && (
        <View style={styles.posterOverlay} pointerEvents="none">
          <Image
            source={{ uri: getPosterUrl(posterId, AUDIO_POSTER_SIZE) }}
            style={styles.poster}
            contentFit="contain"
            transition={200}
            cachePolicy="memory-disk"
            accessible={true}
            accessibilityLabel={`${track?.Name || "Audio"} poster`}
          />
        </View>
      )}

      {/* tvOS: nothing in this screen is focusable while the native player is
          presented (or before it is). Without focus inside the pushed screen,
          Menu reaches nothing that pops and the system backgrounds the app —
          the audio-player lesson. Same invisible holder pattern as the video
          player and library grids. */}
      {Platform.isTV && <Pressable isTVSelectable hasTVPreferredFocus onPress={() => {}} style={styles.focusHolder} accessibilityElementsHidden importantForAccessibility="no-hide-descendants" />}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#000000",
  },
  posterOverlay: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    justifyContent: "center",
    alignItems: "center",
    paddingVertical: "6%",
  },
  poster: {
    width: "60%",
    height: "100%",
  },
  focusHolder: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
});
