import { DismissPan } from "@/components/dismiss-pan";
import { FocusableButton } from "@/components/FocusableButton";
import { PlayerLoadingOverlay } from "@/components/player-loading-overlay";
import { UpNextInterstitial } from "@/components/up-next-interstitial";
import { useLoadingActions } from "@/contexts/LoadingContext";
import { usePlayerSession } from "@/contexts/PlayerSessionContext";
import { usePlayQueue } from "@/contexts/PlayQueueContext";
import { fetchMediaSegments, getPosterUrl, hasPoster, JELLYFIN_TIME, type ItemMediaSegments } from "@/services/jellyfinApi";
import { JellyfinVideoItem } from "@/types/jellyfin";
import { libraryManager } from "@/services/libraryManager";
import { logger } from "@/utils/logger";
import { Ionicons } from "@expo/vector-icons";
import * as Linking from "expo-linking";
import { useLocalSearchParams, useNavigation, useRouter } from "expo-router";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
 * Where the Up Next card goes when the server has no Outro marker: this far
 * before the end. Measured off the markers we do get — credits ran 21.6s to
 * 38.6s across four seasons, so a flat number is only ever a guess, and it is
 * the reason a marker is preferred whenever one exists.
 */
const PROPOSAL_FALLBACK_LEAD_SECONDS = 30;

/**
 * When the tvOS Up Next card is scheduled, or null if nothing usable is known.
 *
 * The Outro START, because that is where the credits actually begin and the
 * plugin measures it per episode. Never the outro END or the runtime: those are
 * the same tick (1926.5707s on S03E09) and sit past AVPlayer's own duration
 * (1926.5266s), so playback never reaches them and the card never presents —
 * and handlePlaybackEnd returns without advancing on TV, stalling the queue.
 */
function proposalTime(outroStartSeconds: number | undefined, runtimeSeconds: number): number | null {
  if (outroStartSeconds && outroStartSeconds > 0) return outroStartSeconds;
  if (runtimeSeconds > PROPOSAL_FALLBACK_LEAD_SECONDS) return runtimeSeconds - PROPOSAL_FALLBACK_LEAD_SECONDS;
  return null;
}

/**
 * The player SCREEN. The player itself — <Video>, the AVPlayer, everything AVKit
 * draws — lives in PlayerHost, mounted above the navigator, because Picture in
 * Picture cannot outlive this route otherwise (see contexts/PlayerSessionContext).
 *
 * What stays here is what has to: the URL contract (deep links, params), the
 * queue decisions, and every focusable view, so that tvOS Menu keeps popping
 * this screen natively in each state where the host is parked off screen.
 *
 * Deep links (Top Shelf) arrive as a react-navigation NAVIGATE, which reuses an
 * already-mounted player route and merges params — with an unchanged videoId nothing
 * restarts and the screen resurfaces with a dead stream (stale local remux session:
 * audio from the buffer under the opaque loading overlay, no video). Two signals force
 * a clean remount of the body instead:
 * - `ts`: a per-shelf-refresh nonce the Top Shelf extension puts in the URL.
 * - `generation`: counts player-targeted URL deliveries while this screen is mounted,
 *   covering repeat selections of the same item within one shelf refresh (same ts).
 * In-app pushes carry no ts and deliver no URL event, so their key never changes.
 *
 * The same string is what the host compares to decide restart vs adopt, so a
 * remount and a fresh stream remain one decision rather than two.
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

  const sessionKey = `${ts ?? "in-app"}:${generation}`;
  return <VideoPlayerBody key={sessionKey} sessionKey={sessionKey} />;
}

function VideoPlayerBody({ sessionKey }: { sessionKey: string }) {
  const params = useLocalSearchParams<{
    videoId: string;
    videoName: string;
    playlistIndex?: string;
    queueMode?: string;
    startTicks?: string; // Resume position the launching screen already displayed
    played?: string; // Played flag the launching screen already displayed
    probe?: string; // "1" from regression-suite deep links: record playback events (dev-only)
    adopt?: string; // "1" when PlayerHost re-pushed this route to restore a PiP window
  }>();
  const router = useRouter();
  // Pops go through THIS screen's navigator, never the router's. router.back()
  // dispatches from whatever is focused, so a press UIKit already handled lands
  // in the (library) stack and takes the folder with it.
  const navigation = useNavigation();
  const { hideGlobalLoader, showGlobalLoader } = useLoadingActions();
  const { queue, currentIndex, hasNext, nextVideo, advanceToNext, jumpTo, clear } = usePlayQueue();
  const { requestSession, releaseRoute, stopSession, signalRoutePresented, setTvConfig, setHandlers, pause, retry, playbackState, showLoadingOverlay, hasStream, sessionVideoId } = usePlayerSession();

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
      stopSession();
      // Scoped for the same reason as handleBack below.
      if (navigation.canGoBack()) navigation.goBack();
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
      stopSession();
      // Scoped for the same reason as handleBack below.
      if (navigation.canGoBack()) navigation.goBack();
    }
  }, [isQueueMode, hasNext, nextVideo, clear, stopSession, currentPlaylistIndex, router, navigation, showGlobalLoader]);

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

  /**
   * Ask the host to play this item, and again whenever the item changes under a
   * live screen — a queue advance and a legacy-playlist advance both land here
   * as a router.replace, which updates params without remounting this body.
   *
   * `adopt` is set only by the host's own restore push: the window is already
   * playing this item and must not be restarted underneath itself.
   */
  useEffect(() => {
    if (!params.videoId) return;
    requestSession({
      videoId: params.videoId,
      videoName: params.videoName,
      startPositionTicks: params.startTicks ? Number(params.startTicks) : undefined,
      playedAtStart: params.played === undefined ? undefined : params.played === "true",
      probe: params.probe === "1",
      sessionKey,
      adopt: params.adopt === "1",
    });
  }, [requestSession, sessionKey, params.videoId, params.videoName, params.startTicks, params.played, params.probe, params.adopt]);

  // The host keeps the session when a tvOS PiP window is up. Released by identity:
  // an advance remounts this body, so two screens exist for one commit.
  useEffect(() => {
    const owner = { videoId: params.videoId, sessionKey };
    return () => releaseRoute(owner);
  }, [releaseRoute, params.videoId, sessionKey]);

  // The host answers AVKit's parked restore transition once this screen is back
  // on screen; Apple terminates a restoring player that takes too long.
  useEffect(() => {
    signalRoutePresented();
  }, [signalRoutePresented]);

  // Hide global loader when component mounts
  useEffect(() => {
    hideGlobalLoader();
  }, [hideGlobalLoader]);

  // tvOS queue mode: the native AVContentProposal (patched into react-native-video)
  // replaces the RN interstitial — poster + title + Play Now/Close, countdown
  // auto-accepting 5s after playback ends. Undefined on phone and with nothing next.
  //
  // An explicit time is always sent, from the outro when there is one and from the
  // item's runtime otherwise. Sending none leaves the patch passing
  // CMTime.indefinite, which is not a point on the timeline and so is never
  // reached — the card never presents, and handlePlaybackEnd returns without
  // advancing on TV, which stalls the queue. This is that bug's fix, and it makes
  // the card independent of whether the server has segments at all.
  const currentRuntimeSeconds = useMemo(() => {
    const item = currentIndex >= 0 ? queue[currentIndex] : undefined;
    return item?.RunTimeTicks ? item.RunTimeTicks / JELLYFIN_TIME.TICKS_PER_SECOND : 0;
  }, [queue, currentIndex]);

  const proposalAt = useMemo(() => proposalTime(segments?.outro?.startSeconds, currentRuntimeSeconds), [segments, currentRuntimeSeconds]);

  /** A card is what covers the credits — when one is coming, the pill stays off. */
  const cardWillPresent = Platform.isTV && isQueueMode && !!nextVideo && proposalAt !== null;

  const contentProposal = useMemo(() => {
    if (!Platform.isTV || !isQueueMode || !nextVideo) return undefined;
    return {
      title: nextVideo.Name,
      ...(hasPoster(nextVideo) ? { imageUri: getPosterUrl(nextVideo.Id, 600) } : {}),
      ...(proposalAt !== null ? { startTimeSeconds: proposalAt } : {}),
      autoAcceptSeconds: 5,
    };
  }, [isQueueMode, nextVideo, proposalAt]);

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
  // Intro over the intro, Skip Credits over the outro. Not gated on queue mode:
  // with no next item no proposal presents, and that case had no way past the
  // credits at all.
  //
  // Skip Credits appears only when NO card is coming — the last item of a queue,
  // or anything opened outside queue mode. Where a card does present it lands on
  // the credits and covers the transport bar, so a pill under it would be a
  // second button for the job "Play Now" already does, out of reach.
  const contextualActions = useMemo(() => {
    if (!Platform.isTV || !segments) return undefined;
    const actions = [];
    if (segments.intro) {
      actions.push({ title: "Skip Intro", startSeconds: segments.intro.startSeconds, endSeconds: segments.intro.endSeconds - 1, seekToSeconds: segments.intro.endSeconds });
    }
    if (segments.outro && !cardWillPresent) {
      actions.push({ title: "Skip Credits", startSeconds: segments.outro.startSeconds, endSeconds: segments.outro.endSeconds - 1, seekToSeconds: segments.outro.endSeconds });
    }
    return actions.length > 0 ? actions : undefined;
  }, [segments, cardWillPresent]);

  // The three AVKit surfaces are computed here, from the queue and this item's
  // segments, and handed to the host to attach to its player.
  useEffect(() => {
    setTvConfig({ contentProposal, contextualActions, infoPanelItems });
  }, [setTvConfig, contentProposal, contextualActions, infoPanelItems]);

  // Disarm on unmount, while the player is still alive to receive it: a PiP window outlives this route.
  useEffect(() => () => setTvConfig({}), [setTvConfig]);

  // Handle back navigation. Shares the one-shot above: a duplicate arrival during the pop
  // transition must not pop the stack a second time. Stopping the session tears the player
  // down before the pop, which is also what keeps a phone presentation from being stranded.
  const handleBack = useCallback(() => {
    if (dismissedRef.current) return;
    dismissedRef.current = true;
    try {
      pause();
    } catch (_error) {
      // Ignore errors - player may already be cleaning up
    }
    if (isQueueMode) {
      clear();
    }
    stopSession();
    // THIS screen's navigator, never the router. router.back() dispatches through whatever is
    // FOCUSED, so a duplicate arrival (the same Menu press reaching the host handler twice, a
    // phone presentation dismissal landing after the pop) hits the (library) stack and takes the
    // folder with it. A screen-scoped GO_BACK carries `source`, and React Navigation delegates to
    // child navigators only for `target`, so this pops this screen or nothing.
    if (navigation.canGoBack()) navigation.goBack();
  }, [pause, navigation, isQueueMode, clear, stopSession]);

  // Interstitial CTAs, and the tvOS content proposal's Play Now / Close. Play Now
  // (and the countdown expiring) advances the queue — the router.replace updates
  // the params, and the effect above asks the host for the next item.
  // Close stops the binge: the queue clears and the player screen pops.
  // One-shot across both CTAs: the countdown expiring, a Play Now tap, and Close can queue
  // in the same JS tick; a second arrival must not advance the queue again (skipping an
  // episode, or popping the freshly started next player once the queue is drained).
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
  // restart the player on it — the mid-video equivalent of a Continue Watching
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

  // Everything the host has to call back into: playback ending, the native Up
  // Next CTAs, and leaving the player (the phone's ✕/swipe/drag, and the tvOS Menu
  // press — the ONLY way out while the host is on screen, since focus is in AVKit
  // and nothing native can pop from there).
  useEffect(() => {
    setHandlers({
      onPlaybackEnd: handlePlaybackEnd,
      onContentProposalAccepted: handleInterstitialPlay,
      onContentProposalRejected: handleInterstitialClose,
      onInfoPanelItemSelected: handleInfoPanelItemSelected,
      onRequestBack: handleBack,
    });
    return () => setHandlers(null);
  }, [setHandlers, handlePlaybackEnd, handleInterstitialPlay, handleInterstitialClose, handleInfoPanelItemSelected, handleBack]);

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
    if (playbackState.type === "ERROR") {
      try {
        pause();
      } catch (_error) {
        // Ignore errors - player may not be initialized
      }
    }
  }, [playbackState.type, pause]);

  // Render error state (but not if auto-retry is in progress)
  if (playbackState.type === "ERROR") {
    // If we can retry with transcoding, show loading overlay instead of error
    // This prevents flashing an error message during automatic retry
    if (playbackState.canRetryWithTranscode) {
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
        <Text style={styles.errorText}>{playbackState.error}</Text>

        <View style={styles.buttonGroup}>
          <FocusableButton title="Retry" onPress={retry} variant="retry" style={styles.button} hasTVPreferredFocus={true} />
          <FocusableButton title="Go Back" onPress={handleBack} variant="secondary" style={styles.button} />
        </View>
      </View>
    );
  }

  // The player draws itself, from the host above the navigator. This screen is
  // the black ground under it, plus the states the host stays parked for.
  // onAccessibilityEscape: VoiceOver's two-finger Z scrub — the assistive counterpart of the
  // dismiss gestures, which VoiceOver users can't perform.
  const body = (
    <View style={styles.container} onAccessibilityEscape={handleBack}>
      {/* Loading canvas, and the screen's tvOS focus anchor while it is up: the host is parked
          off screen for exactly these states, so this is the only focusable the screen has and
          Menu needs one to pop from (see the component). Also rendered before the stream
          resolves — the IDLE first pass is not part of showLoadingOverlay, and that gap is a
          stranded-focus window too. */}
      {(showLoadingOverlay || !hasStream || sessionVideoId !== params.videoId) && <PlayerLoadingOverlay />}

      {/* Between-episodes Up Next screen (phone queue mode). MOUNTED FOR THE WHOLE EPISODE,
          hidden behind the presented player, so its poster and backdrop are already fetched
          and decoded when the video ends; `upNext` arms it, and the AVKit dismissal slide
          reveals a card that is finished rather than one starting two downloads. Never on
          TV, where the native proposal owns this and an RN overlay would strand focus. */}
      {!Platform.isTV && isQueueMode && nextVideo && <UpNextInterstitial nextVideo={nextVideo} armed={upNext !== null} onPlayNext={handleInterstitialPlay} onClose={handleInterstitialClose} />}
    </View>
  );

  // Drag down to leave. This screen has no header, no back item and no pop gesture that can
  // reach the navigator, so while the host is parked (loading, error) there was no way out of
  // it either. TV pops with Menu and keeps its tree untouched.
  if (Platform.isTV) return body;
  return (
    <DismissPan onDismiss={handleBack} style={styles.container}>
      {body}
    </DismissPan>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
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
});
