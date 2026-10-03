import { DismissPan } from "@/components/dismiss-pan";
import { FocusableButton } from "@/components/FocusableButton";
import { PlayerLoadingOverlay } from "@/components/player-loading-overlay";
import { UpNextInterstitial } from "@/components/up-next-interstitial";
import { COLORS } from "@/constants/colors";
import { useLoadingActions } from "@/contexts/LoadingContext";
import { usePlayerSession } from "@/contexts/PlayerSessionContext";
import { usePlayQueue } from "@/contexts/PlayQueueContext";
import { useLiveTvPreferences } from "@/hooks/useLiveTvPreferences";
import { posterUri, wantsPosterFrame } from "@/services/itemArtwork";
import {
  cancelTimer,
  createTimer,
  fetchChannelRing,
  fetchChannelWindow,
  fetchLiveTvManagement,
  fetchMediaSegments,
  fetchNextEpisodeAutoPlay,
  fetchTimerDefaults,
  fetchTimers,
  fetchVideoDetails,
  setVideoFavorite,
  type ItemMediaSegments,
} from "@/services/jellyfinApi";
import { toggleFavoriteChannel } from "@/services/channelFavorites";
import { getLiveTvPreferences, isFavoriteChannel, subscribeLiveTvPreferences } from "@/services/liveTvPreferences";
import { recenterLiveRing, releaseLiveRing } from "@/services/liveRing";
import { probeEmit } from "@/services/playbackProbe";
import { showToast } from "@/services/toast";
import { cleanLabel } from "@/utils/cleanLabel";
import { activeRecordTimer, adjacentChannelId, channelWindow, durationLabel, programTimes, ringWithCenter } from "@/utils/guide";
import { cancelPosterFrame, requestPosterFrame } from "@/services/localRemux";
import { playsFromDisk } from "@/services/downloads/localSource";
import { stageStopped } from "@/hooks/usePlaybackStage";
import { currentPlaybackStage } from "@/services/playbackStage";
import { isJoined as syncPlayIsJoined, requestNextItem } from "@/services/syncPlayManager";
import { JellyfinItem, JellyfinTimer, JellyfinVideoItem } from "@/types/jellyfin";
import { libraryManager } from "@/services/libraryManager";
import { logger } from "@/utils/logger";
import { Ionicons } from "@expo/vector-icons";
import * as Linking from "expo-linking";
import { useLocalSearchParams, useNavigation, useRouter } from "expo-router";
import { StackActions } from "expo-router/react-navigation";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Alert, BackHandler, LogBox, Platform, StyleSheet, Text, View } from "react-native";
import { t } from "@/services/i18n";

/** Upcoming queue items whose keyframe is asked for ahead of the Up Next surfaces. */
const UPCOMING_FRAMES = 5;

/** The error screen re-claims focus this often, for this long, while no error button holds it. */
const ERROR_FOCUS_CLAIM_EVERY_MS = 300;
const ERROR_FOCUS_CLAIM_WINDOW_MS = 5_000;

/** Channels after the playing one that the info panel's strip shows (30 with it). */
const CHANNEL_WINDOW_AHEAD = 29;
const EMPTY_RING: JellyfinItem[] = [];

/** Past the playing channel's airing end before its lineup is read again, so the server names the next programme. */
const AIRING_END_SLACK_MS = 5_000;

// Suppress known warnings
LogBox.ignoreLogs([
  "JS object is no longer associated",
  "Operation requires a client callback",
  "Operation requires a client data source",
  "Cannot Open", // Direct play failures that trigger automatic transcoding retry
  "Failed to load the player item", // Player errors during automatic retry
]);

/** A known credits start, or null to let AVKit present at the actual playback end. */
function proposalTime(outroStartSeconds: number | undefined): number | null {
  return outroStartSeconds !== undefined && Number.isFinite(outroStartSeconds) && outroStartSeconds > 0 ? outroStartSeconds : null;
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
  const { ts, videoId } = useLocalSearchParams<{ ts?: string; videoId: string }>();
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
  // videoId is a prop, not just a param the body reads for itself: a queue advance changes it
  // without changing the key, and the memoized element would otherwise hold the body on the
  // previous item (measured: the compiled build kept the old item's Up Next marker).
  return <VideoPlayerBody key={sessionKey} sessionKey={sessionKey} videoId={videoId} />;
}

function VideoPlayerBody({ sessionKey, videoId }: { sessionKey: string; videoId: string }) {
  const params = useLocalSearchParams<{
    videoId: string;
    videoName: string;
    playlistIndex?: string;
    queueMode?: string;
    startTicks?: string; // Resume position the launching screen already displayed
    played?: string; // Played flag the launching screen already displayed
    probe?: string; // regression-suite deep links: "1" or the URL the driver receives events at (dev-only)
    adopt?: string; // "1" when PlayerHost re-pushed this route to restore a PiP window
    live?: string; // "1" for a Live TV channel: one player across channel flips
    advance?: string; // "1" on a queue advance: a PiP window carries into this item
  }>();
  const router = useRouter();
  // Pops go through THIS screen's navigator and target its stack, never the router's: a press UIKit
  // already handled would otherwise pop the folder beneath (see handleBack).
  const navigation = useNavigation();
  const popThisScreen = useCallback(() => navigation.dispatch({ ...StackActions.pop(), target: navigation.getState()?.key }), [navigation]);
  const { hideGlobalLoader, showGlobalLoader } = useLoadingActions();
  const { queue, currentIndex, hasNext, nextVideo, advanceToNext, jumpTo, clear } = usePlayQueue();
  const {
    requestSession,
    switchLiveChannel,
    releaseRoute,
    stopSession,
    signalRoutePresented,
    setTvConfig,
    setHandlers,
    pause,
    retry,
    playbackState,
    showLoadingOverlay,
    hasStream,
    sessionVideoId,
    hostMode,
  } = usePlayerSession();

  const isQueueMode = params.queueMode === "true";
  const isLiveChannel = params.live === "1";

  // Parse playlist index
  const currentPlaylistIndex = params.playlistIndex ? parseInt(params.playlistIndex, 10) : -1;

  // Queue mode: the next episode announced between episodes (null = no interstitial showing)
  const [upNext, setUpNext] = useState<JellyfinVideoItem | null>(null);

  // Jellyfin's "Play next episode automatically", re-read per item so a change made elsewhere lands on the next one.
  const [autoPlayNext, setAutoPlayNext] = useState(true);
  useEffect(() => {
    if (!isQueueMode) return;
    let cancelled = false;
    fetchNextEpisodeAutoPlay().then((enabled) => {
      if (!cancelled) setAutoPlayNext(enabled);
    });
    return () => {
      cancelled = true;
    };
  }, [isQueueMode, videoId]);

  // One-shot for every path that pops this screen: handleBack, and the direct router.back()
  // exits below. react-native-video can deliver onEnd more than once, and a second pop would
  // eject whatever screen is beneath this one.
  const dismissedRef = useRef(false);

  // Media segment markers (Intro/Outro) for this item: the Intro times the
  // tvOS Skip Intro pill, the Outro the Up Next proposal and Skip Credits pill.
  // Fire-and-forget — nulls just mean no skip affordances.
  const [segmentResult, setSegmentResult] = useState<{ itemId: string; segments: ItemMediaSegments } | null>(null);
  // Params can change while this body is mounted. Never arm the new item with the
  // previous episode's marker, even for the render before its fetch effect runs.
  const segments = segmentResult?.itemId === videoId ? segmentResult.segments : null;
  useEffect(() => {
    let cancelled = false;
    const itemId = videoId;
    fetchMediaSegments(itemId).then((result) => {
      if (!cancelled) setSegmentResult({ itemId, segments: result });
    });
    return () => {
      cancelled = true;
    };
  }, [videoId]);

  /**
   * Ask the host to play this item, and again whenever the item changes under a
   * live screen — a queue advance and a legacy-playlist advance both land here
   * as a router.replace, which updates params without remounting this body.
   *
   * `adopt` is set only by the host's own restore push: the window is already
   * playing this item and must not be restarted underneath itself.
   */
  useEffect(() => {
    if (!videoId) return;
    requestSession({
      videoId: videoId,
      videoName: params.videoName,
      startPositionTicks: params.startTicks ? Number(params.startTicks) : undefined,
      playedAtStart: params.played === undefined ? undefined : params.played === "true",
      probe: params.probe || undefined,
      sessionKey,
      adopt: params.adopt === "1",
      isLive: isLiveChannel,
      advance: params.advance === "1",
    });
  }, [requestSession, sessionKey, videoId, params.videoName, params.startTicks, params.played, params.probe, params.adopt, isLiveChannel, params.advance]);

  // tvOS channel flipping rides AVKit's own swipe: the channel ring is the list the channel was tuned
  // from (the filter and sort at open), and a flip swaps the channel under the one player.
  const [ringPreferences] = useState(() => getLiveTvPreferences());
  const [loadedRing, setLoadedRing] = useState<JellyfinItem[] | null>(null);
  // Swipes before the ring loads wait here in order; a failed load is retried by the next swipe.
  const pendingFlipsRef = useRef<(1 | -1)[]>([]);
  const ringFailedRef = useRef(false);
  // The channel a swipe walks from, moved as each flip is issued: swipes queued while React is
  // behind chain one step each instead of all leaving the channel still on screen.
  const flipCenterRef = useRef<JellyfinItem>({ Id: videoId, Name: params.videoName ?? "", Type: "TvChannel" } as JellyfinItem);
  useEffect(() => {
    flipCenterRef.current = { Id: videoId, Name: params.videoName ?? "", Type: "TvChannel" } as JellyfinItem;
  }, [videoId, params.videoName]);
  const [ringAttempt, setRingAttempt] = useState(0);
  useEffect(() => {
    if (!Platform.isTV || !isLiveChannel) return;
    let cancelled = false;
    ringFailedRef.current = false;
    fetchChannelRing(ringPreferences)
      .then((items) => !cancelled && setLoadedRing(items))
      .catch((err) => {
        if (!cancelled) ringFailedRef.current = true;
        logger.warn("Channel ring load failed", err, { service: "VideoPlayer" });
      });
    return () => {
      cancelled = true;
    };
  }, [isLiveChannel, ringAttempt, ringPreferences]);
  // Empty until loaded; the playing channel is in it from then on, listed or not.
  const channelRing = useMemo(
    () => (loadedRing === null ? EMPTY_RING : ringWithCenter(loadedRing, { Id: videoId, Name: params.videoName ?? "", Type: "TvChannel" } as JellyfinItem)),
    [loadedRing, videoId, params.videoName],
  );
  // What the player shows of the ring, read in full: art, number and the programme airing. The playing
  // channel is in it from the first render, so the heart and Record never wait on the lineup.
  const windowKey = channelWindow(channelRing, videoId, CHANNEL_WINDOW_AHEAD).join(",");
  const [windowAttempt, setWindowAttempt] = useState(0);
  const [windowChannels, setWindowChannels] = useState<Map<string, JellyfinItem>>(() => new Map());
  useEffect(() => {
    if (!Platform.isTV || !isLiveChannel) return;
    let cancelled = false;
    fetchChannelWindow(windowKey.split(","))
      .then((items) => !cancelled && setWindowChannels(new Map(items.map((channel) => [channel.Id, channel]))))
      .catch((err) => logger.warn("Channel window load failed", err, { service: "VideoPlayer" }));
    return () => {
      cancelled = true;
    };
  }, [isLiveChannel, windowKey, windowAttempt]);
  const playingChannel = windowChannels.get(videoId);
  // The ring follows the channel on screen: its neighbours cut segments in the engine while a surf
  // window is open. The snapshot must name this channel, not the one left.
  const livePlaying = isLiveChannel && playbackState.type === "PLAYING" && sessionVideoId === videoId;
  useEffect(() => {
    if (!Platform.isTV || !isLiveChannel || channelRing.length === 0) return;
    recenterLiveRing(channelRing, videoId, livePlaying);
  }, [isLiveChannel, livePlaying, channelRing, videoId]);
  useEffect(() => {
    if (!Platform.isTV || !isLiveChannel) return;
    return () => {
      void releaseLiveRing();
    };
  }, [isLiveChannel]);
  const liveChannelFlip = useMemo(() => {
    if (!Platform.isTV || !isLiveChannel) return undefined;
    const neighbour = (direction: 1 | -1) => {
      const id = adjacentChannelId(channelRing, videoId, direction);
      const channel = id ? channelRing.find((entry) => entry.Id === id) : undefined;
      return channel ? { title: cleanLabel(channel.Name), subtitle: cleanLabel(windowChannels.get(channel.Id)?.CurrentProgram?.Name) } : undefined;
    };
    // Present from the first render of a live session: AVKit arms its flip swipes when playback
    // starts and does not look again, so the gate must be open before the ring has loaded.
    const next = neighbour(1);
    const previous = neighbour(-1);
    // A loaded ring with no neighbour (a one-channel lineup) has nothing to flip to.
    if (channelRing.length > 0 && !next && !previous) return undefined;
    return { ...(next ? { next } : {}), ...(previous ? { previous } : {}) };
  }, [isLiveChannel, channelRing, windowChannels, videoId]);
  const handleSkipChannel = useCallback(
    (direction: 1 | -1) => {
      if (loadedRing === null) {
        pendingFlipsRef.current.push(direction);
        if (ringFailedRef.current) setRingAttempt((n) => n + 1);
        return;
      }
      const from = flipCenterRef.current;
      const ring = ringWithCenter(loadedRing, from);
      const targetId = adjacentChannelId(ring, from.Id, direction);
      const target = targetId ? ring.find((entry) => entry.Id === targetId) : undefined;
      if (!target) return;
      flipCenterRef.current = target;
      logger.info("Live TV: flipping channel", { service: "VideoPlayer", direction, to: target.Name });
      probeEmit("flip", { direction, from: from.Id, to: target.Id });
      switchLiveChannel({ videoId: target.Id, videoName: target.Name });
      // The route follows the host, so its request adopts the flipped session and its release
      // names the channel that is playing.
      router.setParams({ videoId: target.Id, videoName: target.Name });
    },
    [loadedRing, switchLiveChannel, router],
  );
  // The ring arrived: the waiting swipes flip in order.
  useEffect(() => {
    if (loadedRing === null || pendingFlipsRef.current.length === 0) return;
    const pending = pendingFlipsRef.current;
    pendingFlipsRef.current = [];
    for (const direction of pending) handleSkipChannel(direction);
  }, [loadedRing, handleSkipChannel]);

  // The host keeps the session when a tvOS PiP window is up. Released by identity:
  // an advance remounts this body, so two screens exist for one commit.
  useEffect(() => {
    const owner = { videoId: videoId, sessionKey };
    return () => releaseRoute(owner);
  }, [releaseRoute, videoId, sessionKey]);

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
  // auto-accepting 5s after playback ends unless autoplay is off, where it waits
  // for a choice. Undefined on phone and with nothing next.
  //
  // Without a marker, omit the time: CMTime.indefinite uses AVKit's playback-end
  // path. Guessing runtime minus 30 seconds can cover dialogue before the credits.
  const proposalAt = proposalTime(segments?.outro?.startSeconds);

  /** A card is what covers the credits — when one is coming, the pill stays off. */
  const cardWillPresent = Platform.isTV && isQueueMode && !!nextVideo && proposalAt !== null;

  // Keyframes for the upcoming items the server left without a poster. Gated on playback, not on
  // the stream: each is a decode and a read on what the engine is timed against (engineVerdicts.ts).
  const [upcomingFrames, setUpcomingFrames] = useState<Record<string, string>>({});
  const playing = playbackState.type === "PLAYING";
  useEffect(() => {
    if (!Platform.isTV || !isQueueMode || !playing || currentIndex < 0) return;
    const wanted = queue
      .slice(currentIndex + 1)
      .filter((item) => wantsPosterFrame(item))
      .slice(0, UPCOMING_FRAMES);
    if (wanted.length === 0) return;
    let cancelled = false;
    for (const item of wanted) {
      void requestPosterFrame(item).then((uri) => {
        if (!cancelled && uri) setUpcomingFrames((previous) => (previous[item.Id] === uri ? previous : { ...previous, [item.Id]: uri }));
      });
    }
    return () => {
      cancelled = true;
      for (const item of wanted) cancelPosterFrame(item.Id);
    };
  }, [queue, currentIndex, isQueueMode, playing]);

  const contentProposal = useMemo(() => {
    if (!Platform.isTV || !isQueueMode || !nextVideo) return undefined;
    const imageUri = posterUri(nextVideo, 600, upcomingFrames[nextVideo.Id]);
    return {
      title: cleanLabel(nextVideo.Name),
      ...(imageUri ? { imageUri } : {}),
      ...(proposalAt !== null ? { startTimeSeconds: proposalAt } : {}),
      ...(autoPlayNext ? { autoAcceptSeconds: 5 } : {}),
    };
  }, [isQueueMode, nextVideo, proposalAt, upcomingFrames, autoPlayNext]);

  // tvOS "Up Next" tab in the swipe-down info panel (patched infoPanelItems
  // prop → customInfoViewControllers): the queue's upcoming items as focusable
  // cards, capped at 30. Selecting one jumps the queue there (handler below).
  const infoPanelItems = useMemo(() => {
    // A live channel's tab is the ring itself: the in-player guide, one card per channel with
    // what it is airing, the playing channel first so its neighbours sit beside it.
    if (Platform.isTV && isLiveChannel) {
      const at = channelRing.findIndex((entry) => entry.Id === videoId);
      if (at < 0 || channelRing.length < 2) return undefined;
      const ordered = channelRing
        .slice(at)
        .concat(channelRing.slice(0, at))
        .slice(0, CHANNEL_WINDOW_AHEAD + 1);
      // A card shows its window read (art, programme) once it lands; the ring alone names it.
      return ordered.map((entry) => {
        const channel = windowChannels.get(entry.Id) ?? entry;
        const imageUri = posterUri(channel, 450);
        return {
          id: channel.Id,
          title: cleanLabel(channel.Name),
          subtitle: cleanLabel(channel.CurrentProgram?.Name),
          ...(imageUri ? { imageUri } : {}),
          imageAspectRatio: 16 / 9,
          logo: true,
        };
      });
    }
    if (!Platform.isTV || !isQueueMode || currentIndex < 0) return undefined;
    const upcoming = queue.slice(currentIndex + 1, currentIndex + 31).map((item) => {
      const imageUri = posterUri(item, 450, upcomingFrames[item.Id]);
      return {
        id: item.Id,
        title: cleanLabel(item.Name),
        subtitle: [cleanLabel(item.SeriesName), item.Type === "Episode" && item.IndexNumber != null ? t("player.episodeNum").replace("{num}", String(item.IndexNumber)) : null]
          .filter(Boolean)
          .join(" · "),
        ...(imageUri ? { imageUri } : {}),
        ...(item.PrimaryImageAspectRatio ? { imageAspectRatio: item.PrimaryImageAspectRatio } : {}),
      };
    });
    return upcoming.length > 0 ? upcoming : undefined;
  }, [queue, currentIndex, isQueueMode, upcomingFrames, isLiveChannel, channelRing, windowChannels, videoId]);
  const infoPanelTitle = Platform.isTV && isLiveChannel ? t("liveTv.channels") : undefined;

  // tvOS timed pills (AVKit-rendered, patched contextualActions prop): Skip
  // Intro over the intro, Skip Credits over the outro, Skip Commercial over each
  // break. Not gated on queue mode:
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
      actions.push({ title: t("player.skipIntro"), startSeconds: segments.intro.startSeconds, endSeconds: segments.intro.endSeconds - 1, seekToSeconds: segments.intro.endSeconds });
    }
    if (segments.outro && !cardWillPresent) {
      actions.push({ title: t("player.skipCredits"), startSeconds: segments.outro.startSeconds, endSeconds: segments.outro.endSeconds - 1, seekToSeconds: segments.outro.endSeconds });
    }
    for (const commercial of segments.commercials) {
      actions.push({ title: t("player.skipCommercial"), startSeconds: commercial.startSeconds, endSeconds: commercial.endSeconds - 1, seekToSeconds: commercial.endSeconds });
    }
    return actions.length > 0 ? actions : undefined;
  }, [segments, cardWillPresent]);

  // The phone has no pill: with the Channel Settings toggle on, playback seeks past each break itself.
  const skipCommercials = useLiveTvPreferences().skipCommercials;
  const skipWindows = useMemo(() => (!Platform.isTV && skipCommercials && segments && segments.commercials.length > 0 ? segments.commercials : undefined), [skipCommercials, segments]);

  // tvOS transport bar heart (patched transportBarButtons prop): the playing
  // item's favorite state, server-backed for media, device-local for a live
  // channel. Omitted until the state is known.
  // Keyed by item, like segmentResult above: params change while this body is mounted.
  const [vodFavoriteResult, setVodFavoriteResult] = useState<{ itemId: string; favorite: boolean } | null>(null);
  const vodFavorite = vodFavoriteResult?.itemId === videoId ? vodFavoriteResult.favorite : null;
  useEffect(() => {
    if (!Platform.isTV || isLiveChannel) return;
    let cancelled = false;
    const itemId = videoId;
    fetchVideoDetails(itemId)
      .then((details) => {
        if (!cancelled) setVodFavoriteResult({ itemId, favorite: !!details?.UserData?.IsFavorite });
      })
      .catch((err) => logger.warn("Favorite state read failed", err, { service: "VideoPlayer" }));
    return () => {
      cancelled = true;
    };
  }, [isLiveChannel, videoId]);

  const [liveFavorite, setLiveFavorite] = useState(false);
  useEffect(() => {
    if (!Platform.isTV || !isLiveChannel) return;
    const compute = () => {
      setLiveFavorite(playingChannel ? isFavoriteChannel(getLiveTvPreferences(), playingChannel) : false);
    };
    compute();
    return subscribeLiveTvPreferences(compute);
  }, [isLiveChannel, playingChannel]);

  // tvOS transport bar record button, the info panel's flow on the airing program:
  // record the channel's CurrentProgram, or cancel/stop its active timer. Shown
  // only with the recording permission and a known timer state.
  const [canRecord, setCanRecord] = useState(false);
  useEffect(() => {
    if (!Platform.isTV || !isLiveChannel) return;
    let cancelled = false;
    fetchLiveTvManagement()
      .then((allowed) => {
        if (!cancelled) setCanRecord(allowed);
      })
      .catch((err) => logger.warn("Recording permission read failed", err, { service: "VideoPlayer" }));
    return () => {
      cancelled = true;
    };
  }, [isLiveChannel]);

  // A channel with guide data records its CurrentProgram; without one it gets a manual
  // timer (ChannelId + the recordingMinutes window; the server names this path IsManual).
  const liveChannel = Platform.isTV && isLiveChannel ? playingChannel : undefined;
  const currentProgramId = liveChannel?.CurrentProgram?.Id;
  // The window's CurrentProgram is what aired when it loaded: the window is read again once it ends.
  const airingEndMs = Date.parse(liveChannel?.CurrentProgram?.EndDate ?? "");
  useEffect(() => {
    if (!Number.isFinite(airingEndMs)) return;
    const timer = setTimeout(() => setWindowAttempt((n) => n + 1), Math.max(0, airingEndMs - Date.now()) + AIRING_END_SLACK_MS);
    return () => clearTimeout(timer);
  }, [airingEndMs]);
  const recordKey = liveChannel ? (currentProgramId ?? `channel:${videoId}`) : undefined;
  // Keyed by target: a channel flip must not show the previous target's timer.
  const [timerResult, setTimerResult] = useState<{ key: string; timer: JellyfinTimer | null } | null>(null);
  const recordTimer = recordKey && timerResult?.key === recordKey ? timerResult.timer : undefined;
  const reloadTimer = useCallback(async (key: string, programId: string | undefined, channelId: string) => {
    const timers = await fetchTimers();
    setTimerResult({ key, timer: activeRecordTimer(timers, { programId, channelId }, Date.now()) });
  }, []);
  useEffect(() => {
    if (!canRecord || !recordKey) return;
    let cancelled = false;
    const key = recordKey;
    const programId = currentProgramId;
    const channelId = videoId;
    fetchTimers()
      .then((timers) => {
        if (!cancelled) setTimerResult({ key, timer: activeRecordTimer(timers, { programId, channelId }, Date.now()) });
      })
      .catch((err) => logger.warn("Timer state read failed", err, { service: "VideoPlayer" }));
    return () => {
      cancelled = true;
    };
  }, [canRecord, recordKey, currentProgramId, videoId]);

  const transportBarButtons = useMemo(() => {
    if (!Platform.isTV) return undefined;
    const buttons: { id: string; title: string; sfSymbol: string; tintColor?: string }[] = [];
    // A timer here always covers the airing now, so an existing one reads as Stop, never Cancel.
    if (canRecord && recordKey && recordTimer !== undefined) {
      buttons.push({
        id: "record",
        title: t(recordTimer ? "liveTv.stopRecording" : "liveTv.record"),
        sfSymbol: recordTimer ? "stop.circle" : "record.circle",
        tintColor: COLORS.DESTRUCTIVE,
      });
    }
    const favorite = isLiveChannel ? (playingChannel ? liveFavorite : null) : vodFavorite;
    if (favorite !== null) {
      buttons.push({ id: "favorite", title: t(favorite ? "info.removeFavorite" : "info.addFavorite"), sfSymbol: favorite ? "heart.fill" : "heart" });
    }
    return buttons.length > 0 ? buttons : undefined;
  }, [isLiveChannel, playingChannel, liveFavorite, vodFavorite, canRecord, recordKey, recordTimer]);

  // One recording write at a time: AVKit can deliver a second press before the reload lands.
  const recordBusyRef = useRef(false);
  const handleTransportBarButtonSelected = useCallback(
    (event: { id: string }) => {
      if (event.id === "record") {
        if (!recordKey || !liveChannel || recordTimer === undefined || recordBusyRef.current) return;
        recordBusyRef.current = true;
        const key = recordKey;
        const programId = currentProgramId;
        const channelId = videoId;
        // The stand-in a failed re-read left has no Id to cancel: read the real timer first.
        if (recordTimer && !recordTimer.Id) {
          reloadTimer(key, programId, channelId)
            .catch((err) => {
              logger.warn("Timer state read failed", err, { service: "VideoPlayer" });
              Alert.alert(t("liveTv.record"), t("info.couldNotReachServer"));
            })
            .finally(() => {
              recordBusyRef.current = false;
            });
          return;
        }
        // A program timer runs to the program's end, a manual one for the settings length.
        const recordingMs = programId
          ? Math.max(0, (liveChannel.CurrentProgram ? programTimes(liveChannel.CurrentProgram).endMs : NaN) - Date.now())
          : getLiveTvPreferences().recordingMinutes * 60_000;
        const doneToast = recordTimer
          ? t("liveTv.recordingStopped")
          : recordingMs > 0
            ? t("liveTv.recordingStartedFor").replace("{duration}", durationLabel(recordingMs))
            : t("liveTv.recordingStarted");
        // The timer's name becomes the recording folder; a leading dot (".sci-fi") would hide
        // it from the server's own scanner (Jellyfin ignores "**/.*").
        const channelName = liveChannel.Name.replace(/^[.\s]+/, "") || channelId;
        // Optimistic: the CTA flips at the press; reloadTimer reconciles, a failed write reverts.
        const previousTimer = recordTimer;
        setTimerResult({
          key,
          timer: recordTimer
            ? null
            : {
                Id: "",
                Name: channelName,
                ChannelId: channelId,
                ProgramId: programId,
                StartDate: new Date().toISOString(),
                EndDate: new Date(Date.now() + (recordingMs > 0 ? recordingMs : 3_600_000)).toISOString(),
                Status: "InProgress",
              },
        });
        const action = recordTimer
          ? cancelTimer(recordTimer.Id)
          : fetchTimerDefaults(programId).then((defaults) =>
              createTimer(
                programId
                  ? defaults
                  : {
                      ...defaults,
                      ChannelId: channelId,
                      Name: channelName,
                      StartDate: new Date().toISOString(),
                      EndDate: new Date(Date.now() + getLiveTvPreferences().recordingMinutes * 60_000).toISOString(),
                    },
              ),
            );
        action
          .then(() => {
            showToast(doneToast, "success");
            // The write landed: a failed re-read keeps the flipped CTA rather than reverting it.
            return reloadTimer(key, programId, channelId).catch((err) => logger.warn("Timer state read failed", err, { service: "VideoPlayer" }));
          })
          .catch((err) => {
            setTimerResult({ key, timer: previousTimer ?? null });
            logger.warn("Recording action failed", err, { service: "VideoPlayer" });
            Alert.alert(t("liveTv.record"), t("info.couldNotReachServer"));
          })
          .finally(() => {
            recordBusyRef.current = false;
          });
        return;
      }
      if (event.id !== "favorite") return;
      if (isLiveChannel) {
        if (playingChannel) toggleFavoriteChannel(playingChannel);
        return;
      }
      if (vodFavorite === null) return;
      const next = !vodFavorite;
      setVodFavoriteResult({ itemId: videoId, favorite: next });
      setVideoFavorite(videoId, next).catch((err) => {
        logger.warn("Favorite toggle failed", err, { service: "VideoPlayer" });
        setVodFavoriteResult({ itemId: videoId, favorite: !next });
      });
    },
    [isLiveChannel, playingChannel, videoId, vodFavorite, recordKey, liveChannel, currentProgramId, recordTimer, reloadTimer],
  );

  // The AVKit surfaces are computed here, from the queue and this item's
  // segments, and handed to the host to attach to its player.
  useEffect(() => {
    setTvConfig({ contentProposal, contextualActions, infoPanelItems, infoPanelTitle, liveChannelFlip, transportBarButtons, skipWindows });
  }, [setTvConfig, contentProposal, contextualActions, infoPanelItems, infoPanelTitle, liveChannelFlip, transportBarButtons, skipWindows]);

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
    // UIKit can pop this route natively on the same Menu press, and an untargeted pop then takes
    // the folder beneath. Targeted at the root stack with this route as source, it pops this screen or nothing.
    popThisScreen();
  }, [pause, popThisScreen, isQueueMode, clear, stopSession]);

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
    // In a group the server owns the advance: ask it, and its queue push opens the next
    // item for everyone. The local queue advance below is the solo path.
    if (syncPlayIsJoined()) {
      setUpNext(null);
      void requestNextItem();
      return;
    }
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
        advance: "1",
      },
    });
  }, [advanceToNext, handleBack, router, showGlobalLoader]);

  const handleInterstitialClose = useCallback(() => {
    if (interstitialHandledRef.current) return;
    interstitialHandledRef.current = true;
    setUpNext(null);
    handleBack();
  }, [handleBack]);

  // Handle playback end. Queue mode with a next episode: phone shows the RN Up Next
  // interstitial (its countdown/CTAs decide what happens; the presented player is
  // already dismissed by the onEnd wrapper, so the RN layer is visible). TV does
  // NOTHING here: the native content proposal owns the advance (it presents at the
  // outro/end and auto-accepts 5s after playback ends; mounting the RN card on top
  // would double up, and an RN overlay above AVKit is banned by the focus lesson).
  // End of queue and legacy playlist keep their immediate behavior.
  const handlePlaybackEnd = useCallback(() => {
    if (isQueueMode) {
      if (hasNext && nextVideo) {
        // The PiP window is what the viewer is watching, so autoplay advances into it rather than
        // counting down on a card or proposal behind it.
        if (hostMode === "pip-active" && autoPlayNext) {
          logger.info("Queue: video ended in PiP, advancing", { service: "VideoPlayer", nextVideoName: nextVideo.Name });
          handleInterstitialPlay();
          return;
        }
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
      // Scoped for the same reason as handleBack above.
      popThisScreen();
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
            advance: "1",
          },
        });
      }
    } else {
      if (dismissedRef.current) return;
      dismissedRef.current = true;
      logger.info("End of playlist, going back to library", { service: "VideoPlayer" });
      stopSession();
      // Scoped for the same reason as handleBack above.
      popThisScreen();
    }
  }, [isQueueMode, hasNext, nextVideo, hostMode, autoPlayNext, handleInterstitialPlay, clear, stopSession, currentPlaylistIndex, router, popThisScreen, showGlobalLoader]);

  // Info-panel Up Next selection (tvOS): jump the queue to the picked item and
  // restart the player on it — the mid-video equivalent of a Continue Watching
  // tap, so no end-transition one-shot guards apply.
  const handleInfoPanelItemSelected = useCallback(
    (e: { id: string }) => {
      if (isLiveChannel) {
        const channel = channelRing.find((entry) => entry.Id === e.id);
        if (!channel || channel.Id === videoId) return;
        logger.info("Live TV: channel picked from the panel", { service: "VideoPlayer", to: channel.Name });
        probeEmit("flip", { direction: 0, from: videoId, to: channel.Id });
        flipCenterRef.current = channel;
        switchLiveChannel({ videoId: channel.Id, videoName: channel.Name });
        router.setParams({ videoId: channel.Id, videoName: channel.Name });
        return;
      }
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
    [jumpTo, router, showGlobalLoader, isLiveChannel, channelRing, videoId, switchLiveChannel],
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
      onSkipChannel: handleSkipChannel,
      onTransportBarButtonSelected: handleTransportBarButtonSelected,
      onRequestBack: handleBack,
    });
    return () => setHandlers(null);
  }, [setHandlers, handlePlaybackEnd, handleInterstitialPlay, handleInterstitialClose, handleInfoPanelItemSelected, handleSkipChannel, handleTransportBarButtonSelected, handleBack]);

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

  // A live channel on stage through a retried failure is AVKit's screen, not this one.
  const liveOnStage = isLiveChannel && hostMode === "video";

  // A live channel dying on stage leaves nothing focused, and a one-shot claim loses too: AVKit's
  // stage (parked player, channel interstitial) tears down after it and focus lands on the tab bar,
  // where Menu backgrounds the app. Re-claim while no error button holds focus, briefly.
  const retryButtonRef = useRef<View>(null);
  // Which error button holds focus; a blur clears only its own name, so either event order reads right.
  const errorButtonFocusedRef = useRef<"retry" | "back" | null>(null);
  const onRetryFocus = useCallback(() => {
    errorButtonFocusedRef.current = "retry";
  }, []);
  const onBackFocus = useCallback(() => {
    errorButtonFocusedRef.current = "back";
  }, []);
  const onRetryBlur = useCallback(() => {
    if (errorButtonFocusedRef.current === "retry") errorButtonFocusedRef.current = null;
  }, []);
  const onBackBlur = useCallback(() => {
    if (errorButtonFocusedRef.current === "back") errorButtonFocusedRef.current = null;
  }, []);
  const showErrorButtons = playbackState.type === "ERROR" && !liveOnStage && !playbackState.canRetryWithTranscode;
  useEffect(() => {
    if (!Platform.isTV || !showErrorButtons) return;
    errorButtonFocusedRef.current = null;
    const startedAt = Date.now();
    const timer = setInterval(() => {
      if (Date.now() - startedAt > ERROR_FOCUS_CLAIM_WINDOW_MS) {
        clearInterval(timer);
        return;
      }
      if (errorButtonFocusedRef.current !== null) return;
      (retryButtonRef.current as unknown as { requestTVFocus?: () => void } | null)?.requestTVFocus?.();
    }, ERROR_FOCUS_CLAIM_EVERY_MS);
    return () => clearInterval(timer);
  }, [showErrorButtons]);

  // Render error state (but not if auto-retry is in progress)
  if (playbackState.type === "ERROR" && !liveOnStage) {
    // If we can retry with transcoding, show loading overlay instead of error
    // This prevents flashing an error message during automatic retry
    if (playbackState.canRetryWithTranscode) {
      return (
        <View style={styles.container}>
          <PlayerLoadingOverlay live={isLiveChannel} local={playsFromDisk(videoId)} />
        </View>
      );
    }

    // Only show error UI if retry is not possible or has already failed. The failing stage stays
    // on the store until the next attempt, so the screen can say where it stopped.
    const failedStage = currentPlaybackStage().stage;
    return (
      <View style={styles.errorContainer}>
        <Ionicons name="alert-circle-outline" size={64} color={COLORS.DESTRUCTIVE} />
        <Text style={styles.errorTitle}>{t("player.unableToPlay")}</Text>
        <Text style={styles.errorText}>{playbackState.error}</Text>
        {failedStage ? <Text style={styles.errorStage}>{stageStopped(failedStage, { live: isLiveChannel, local: playsFromDisk(videoId) })}</Text> : null}

        <View style={styles.buttonGroup}>
          <FocusableButton
            ref={retryButtonRef}
            onFocus={onRetryFocus}
            onBlur={onRetryBlur}
            title={t("common.retry")}
            onPress={retry}
            variant="retry"
            style={styles.button}
            hasTVPreferredFocus={true}
          />
          <FocusableButton onFocus={onBackFocus} onBlur={onBackBlur} title={t("common.goBack")} onPress={handleBack} variant="secondary" style={styles.button} />
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
      {(showLoadingOverlay || !hasStream || sessionVideoId !== videoId) && !liveOnStage && <PlayerLoadingOverlay live={isLiveChannel} local={playsFromDisk(videoId)} />}

      {/* Between-episodes Up Next screen (phone queue mode). MOUNTED FOR THE WHOLE EPISODE,
          hidden behind the presented player, so its poster and backdrop are already fetched
          and decoded when the video ends; `upNext` arms it, and the AVKit dismissal slide
          reveals a card that is finished rather than one starting two downloads. Never on
          TV, where the native proposal owns this and an RN overlay would strand focus. */}
      {!Platform.isTV && isQueueMode && nextVideo && (
        <UpNextInterstitial nextVideo={nextVideo} armed={upNext !== null} autoAdvance={autoPlayNext} onPlayNext={handleInterstitialPlay} onClose={handleInterstitialClose} />
      )}
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
    backgroundColor: COLORS.MEDIA_BACKGROUND,
  },
  errorContainer: {
    flex: 1,
    backgroundColor: COLORS.MEDIA_BACKGROUND,
    justifyContent: "center",
    alignItems: "center",
    padding: 40,
  },
  errorTitle: {
    marginTop: 16,
    fontSize: 28,
    fontWeight: "700",
    color: COLORS.TEXT_PRIMARY,
    textAlign: "center",
  },
  errorText: {
    marginTop: 8,
    fontSize: 18,
    color: COLORS.TEXT_SECONDARY,
    textAlign: "center",
    lineHeight: 26,
  },
  errorStage: {
    marginTop: 4,
    fontSize: 16,
    color: COLORS.TEXT_TERTIARY,
    textAlign: "center",
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
