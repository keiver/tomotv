import { COLORS } from "@/constants/colors";
import { useLoadingActions } from "@/contexts/LoadingContext";
import { audioPlayerManager } from "@/services/audioPlayerManager";
import { fetchVideoDetails, JELLYFIN_TIME } from "@/services/jellyfinApi";
import { playQueueManager } from "@/services/playQueueManager";
import { logger } from "@/utils/logger";
import { useLocalSearchParams, useNavigation } from "expo-router";
import React, { useCallback, useEffect, useRef } from "react";
import { Platform, Pressable, StyleSheet, View } from "react-native";

/**
 * Audio playback screen. Playback itself is native (AVQueuePlayer + presented
 * AVPlayerViewController, owned by audioPlayerManager) and outlives this
 * screen on iPhone — the screen's only jobs are to hand the queue to the
 * manager, hold tvOS focus so Menu pops natively, and pop itself when the
 * user dismisses the native player.
 */
export default function AudioPlayerScreen() {
  const params = useLocalSearchParams<{
    videoId: string;
    videoName?: string;
    queueMode?: string;
    startTicks?: string; // Resume position the launching screen already displayed
  }>();
  // This screen's own navigator, not the router: the tvOS Menu press that dismisses
  // the native player can also have popped this route already, and a router.back()
  // then pops whatever is focused underneath (see app/player.tsx).
  const navigation = useNavigation();
  const { hideGlobalLoader } = useLoadingActions();

  const startedRef = useRef(false);
  const poppedRef = useRef(false);
  const mountedRef = useRef(true);
  // Drops the queue-build listener and lets the pending wait fall through.
  const queueBuildAbortRef = useRef<(() => void) | null>(null);

  const pop = useCallback(() => {
    if (poppedRef.current) return;
    poppedRef.current = true;
    if (navigation.canGoBack()) navigation.goBack();
  }, [navigation]);

  // Unmount tracking lives in its own []-effect, NOT in the cleanup of the start
  // effect below: that one depends on navigation and hideGlobalLoader, so a cleanup
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
          startPositionSeconds: Number.isFinite(Number(params.startTicks)) ? Number(params.startTicks) / JELLYFIN_TIME.TICKS_PER_SECOND : 0,
          sourceId: inQueue ? (queueState.sourceFolderId ?? params.videoId) : params.videoId,
        });
      } catch (error) {
        logger.error("Audio playback failed to start", error, { service: "AudioPlayer", videoId: params.videoId });
        // Straight out: nothing was ever presented, so there is no focus handover to wait on.
        pop();
      } finally {
        hideGlobalLoader();
      }
    };
    void start();
  }, [params.videoId, params.queueMode, params.startTicks, pop, hideGlobalLoader]);

  // Pop when the user dismisses the native player (swipe/✕ on iPhone, Menu on tvOS).
  // Music keeps playing either way; re-tapping the track re-presents it.
  //
  // Only a FALL from visible counts. subscribe replays the current state
  // synchronously (audioPlayerManager.subscribe), and on mount that is uiVisible
  // false with startQueue not yet run — the old `startedRef` guard was already true
  // by then, so this screen popped itself before it could start anything and no
  // music ever played. A start failure pops from the catch above instead.
  //
  // On tvOS native sends this at WILL-dismiss, while AVKit still covers the screen. Popping now
  // prepares the gallery underneath before the native transition reveals it. iPhone keeps the
  // viewDidDisappear fallback and therefore reaches this same path later.
  const wasVisibleRef = useRef(false);
  useEffect(() => {
    return audioPlayerManager.subscribe((state) => {
      if (state.uiVisible) {
        wasVisibleRef.current = true;
        return;
      }
      if (!wasVisibleRef.current || poppedRef.current) return;
      logger.info("Audio player: native UI dismissed, popping", { service: "AudioPlayer" });
      pop();
    });
  }, [pop]);

  // Exit is a cut, not a fade: AVKit's dismissal animation is the whole exit, and a second
  // dissolve of this opaque-black route over the screen below reads as a double fade. Flipped
  // after the entrance transition so the push keeps its fade.
  useEffect(() => {
    return navigation.addListener("transitionEnd" as never, () => {
      navigation.setOptions({ animation: "none" });
    });
  }, [navigation]);

  return (
    <View style={styles.container}>
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
    backgroundColor: COLORS.MEDIA_BACKGROUND,
  },
  focusHolder: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
});
