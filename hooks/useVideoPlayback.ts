import { useEffect, useState, useMemo, useRef, useCallback, useReducer } from "react";
import { Platform } from "react-native";
import type { VideoRef, OnLoadData, OnProgressData, OnVideoErrorData, OnPlaybackStateChangedData, AudioTrack, TextTrack, SelectedTrack } from "react-native-video";
import {
  fetchVideoDetails,
  isAudioOnly,
  getTextSubtitleStreams,
  getVideoStreamUrl,
  getTranscodingStreamUrl,
  sourceIsHdr,
  isDemoMode,
  connectToDemoServer,
  refreshConfig,
  getConfig,
  generatePlaySessionId,
  JELLYFIN_TIME,
  closeLiveStream,
  isLiveSource,
  noteOpenFailed,
  openChannel,
} from "@/services/jellyfinApi";
import { heldImageSubtitleForOrdinal, playsFromDisk, playsRepackaged } from "@/services/downloads/localSource";
import { usePlaybackReporter } from "./usePlaybackReporter";
import { audioPlayerManager } from "@/services/audioPlayerManager";
import * as syncPlayManager from "@/services/syncPlayManager";
import { JellyfinVideoItem } from "@/types/jellyfin";
import { logger } from "@/utils/logger";
import { prepareMultiAudioPlayback, shouldUseMultiAudio, isMultiAudioAvailable, getAudioTracks } from "@/services/multiAudioLoader";
import {
  belowRealtime,
  canRemuxLocally,
  tierDeclaredFor,
  engineInputMissing,
  engineProgress,
  engineStarving,
  liveSubtitleRenditions,
  localRemuxToken,
  READ_BOUND_SHARE,
  sessionBaseUrl,
  startFrameProvider,
  stopFrameProvider,
  readBound,
  posterFrameWorkInFlight,
  resolveSubtitlePick,
  offeredTierBandwidths,
  slipstreamEligible,
  startLocalRemux,
  startPlaylistShim,
  stopLocalRemux,
  stopPlaylistShim,
  subscribeEngineFailure,
  subscribeEngineLink,
  subscribeEngineStage,
  subscribeEngineThroughput,
  subscribeEngineTier,
  subscribeSubtitleRequests,
  sessionSubtitleRenditions,
  videoDecodeSupport,
  type SubtitleRendition,
  type ThroughputSample,
} from "@/services/localRemux";
import { retainLiveSession, takeRingSession } from "@/services/liveRing";
import { recordTimeoutVerdict, rememberedVerdict, recordVerdict } from "@/services/engineVerdicts";
import { downloadManager } from "@/services/downloads/manager";
import { setPlaybackProbeEnabled, probeEmit, probeFirstPlaying, probeProgress, sourceSummary } from "@/services/playbackProbe";
import { resetPlaybackStages, setPlaybackStage } from "@/services/playbackStage";
import {
  getSubtitlePreferenceSync,
  nextPreference,
  observedFromReport,
  saveSubtitlePreference,
  selectedTextTrackFor,
  type ObservedSubtitle,
  type SubtitlePreference,
} from "@/services/subtitlePreference";
import { PlaybackErrorType, classifyPlaybackError, getPlaybackErrorMessage } from "@/utils/errorClassification";
import { IS_MAC } from "@/utils/hostEnvironment";
import { advanceAdaptive, gatewayMaxBitRate, markProbeStarted, shouldProbeThroughput, type AdaptiveQualityState } from "@/services/adaptiveQuality";
import { measureServerBitrate, rememberedBitrate } from "@/services/jellyfin/bitrateTest";
import { QUALITY_PRESETS, type QualityPreset } from "@/services/jellyfin/constants";
import { getQualitySettings } from "@/services/jellyfin/session";
import { videoPlayerReducer, type PlaybackMode, type VideoPlayerState } from "./videoPlayback/machine";
import { planErrorRecovery, planLiveErrorRecovery } from "./videoPlayback/errorRecovery";
import { planLaneGates, selectLane } from "./videoPlayback/laneDecision";
import { resolveResume } from "./videoPlayback/resume";
import { isFreshManifestReport, orderAudioTracks, planAudioReport, serverLaneCarriesEveryTrack } from "./videoPlayback/audioTracks";
import { classifyObservedChoice, planSubtitleApplication } from "./videoPlayback/subtitleSession";
import { measurementFor, planTranscodePreset } from "./videoPlayback/transcodePreset";
import {
  createPreflightGate,
  dropThroughputWatch,
  EngineInputMissingError,
  keptForReason,
  nextLinkCap,
  linkAffordsChapterFrames,
  planLinkClimb,
  stillPullingInput,
  type PreflightOutcome,
  type ThroughputWatch,
} from "./videoPlayback/engineSession";
import {
  CLIMB_BACK_COOLDOWN_MS,
  DIRECT_STALL_DEADLINE_MS,
  ENGINE_PREFLIGHT_CAP_MS,
  ENGINE_SEGMENT_DEADLINE_MS,
  LINK_CLIMB_COOLDOWN_MS,
  LINK_CLIMB_HOLD_MS,
  LIVE_START_DEADLINE_MS,
  PLAYHEAD_EPSILON_SEC,
  SLIPSTREAM_FORWARD_BUFFER_SECONDS,
  SUBTITLE_CAPTURE_SETTLE_MS,
  VOD_OPEN_DEADLINE_MS,
} from "./videoPlayback/constants";

// Classification moved to utils/errorClassification.ts so non-player code
// (library, search) can share it; re-exported to keep existing call sites.
export { PlaybackErrorType, classifyPlaybackError, getPlaybackErrorMessage };
export { videoPlayerReducer } from "./videoPlayback/machine";
export type { PlaybackMode, PlaybackError, VideoPlayerAction, VideoPlayerState } from "./videoPlayback/machine";
export { planErrorRecovery } from "./videoPlayback/errorRecovery";
export type { ErrorRecoveryDecision, ErrorRecoveryInput } from "./videoPlayback/errorRecovery";

/**
 * Throws without a ThrowStatement inside the caller's try block, which the React Compiler
 * cannot lower: one there drops memoization for the whole hook.
 */
function fail(message: string): never {
  throw new Error(message);
}

/** Work of ours on the same cores and the same link, so the sample is not the file's: a
 *  download repackage, and the keyframe decodes the cards and the queue ask for. */
const deviceBusy = () => downloadManager.getState().entries.some((entry) => entry.state === "repackaging") || posterFrameWorkInFlight();

/** Every item starts here; the remembered choice is applied once its tracks exist. */
const SUBTITLES_UNSET: SubtitlePreference = { kind: "system" };

export interface VideoPlaybackConfig {
  videoId: string;
  /**
   * Hold the state machine in IDLE and fetch nothing.
   *
   * For PlayerHost, which is mounted for the whole app session so Picture in
   * Picture can outlive the /player route, and therefore has to sit idle
   * between sessions instead of unmounting.
   */
  skip?: boolean;
  /**
   * Resume state the launching screen already displayed (Continue Watching row).
   * Trusted over the details refetch: the item endpoint can answer with
   * stale/contradictory UserData, wiping a real resume point (2026-08-05).
   */
  startPositionTicks?: number;
  playedAtStart?: boolean;
  onPlaybackEnd?: () => void;
  /** Regression-suite deep links pass probe=1; records playback events for the driver (dev-only). */
  probe?: boolean;
}

export interface VideoPlaybackResult {
  // Player ref for Video component
  videoRef: React.RefObject<VideoRef | null>;

  // Source URI for Video component
  sourceUri: string | null;

  /**
   * Slipstream gateway sessions: live variant cap for RNV's maxBitRate prop
   * (a pinned quality preset). null = prop omitted (Auto / non-gateway).
   */
  maxBitRate: number | null;
  /**
   * Slipstream rung sessions: RNV preferredForwardBufferDuration, so AVPlayer starts a segment
   * ahead instead of buffering its own default. null everywhere else.
   */
  forwardBufferSeconds: number | null;

  /**
   * Loopback directory the tvOS chapter pictures come from: the engine session's own on the remux
   * lane, a frame provider over the original file on the others. Null until the viewer has asked
   * for the chrome (hooks/videoPlayback/chapterFrames.ts).
   */
  chapterFrameBaseUrl: string | null;

  /**
   * Resume position for the source's startPosition, in ms, or null.
   *
   * Mac only. AVFoundation seeks with it at item-ready, before a frame reaches
   * the layer; the post-load seek below never rebuilds the video render chain
   * there, so the clock and audio resume and the picture never arrives.
   */
  startPositionMs: number | null;

  /**
   * Seeds AVKit's subtitle picker from the viewer's remembered choice, applied
   * at item start. The unset value is {type: "system"}, the same automatic path
   * react-native-video takes on its own, so a fresh install is unchanged.
   */
  selectedTextTrack: SelectedTrack;
  /** RNV selectedAudioTrack: set only to re-apply a track the viewer chose. */
  selectedAudioTrack: SelectedTrack | undefined;

  // Paused state for Video component
  paused: boolean;

  // Video component event callbacks
  videoCallbacks: {
    onLoad: (data: OnLoadData) => void;
    onProgress: (data: OnProgressData) => void;
    onError: (error: OnVideoErrorData) => void;
    onEnd: () => void;
    onSeek: () => void;
    onAudioTracks: (data: { audioTracks: AudioTrack[] }) => void;
    onTextTracks: (data: { textTracks: TextTrack[] }) => void;
    onPlaybackStateChanged: (event: OnPlaybackStateChangedData) => void;
  };

  // State machine state
  state: VideoPlayerState;

  // Video details
  videoDetails: JellyfinVideoItem | null;

  // Media type
  isAudioOnly: boolean;

  // UI helpers
  isLoading: boolean;
  showLoadingOverlay: boolean;

  // Playback control
  play: () => void;
  pause: () => void;
  seekBy: (offsetSeconds: number) => void;
  seekTo: (seconds: number, toleranceMs?: number) => void;

  // Actions
  retry: () => void;

  // Bitmap subtitles (PGS, DVD/VobSub, DVB, XSUB). AVPlayer cannot render these,
  // so the engine decodes them and the app draws them over the video; these are
  // what the overlay needs. All inert unless local remux is the active lane and
  // the viewer selected an image track in AVKit's own picker.
  //
  /** Loopback session URL to fetch cue manifests and images from. */
  imageSubtitleSessionUrl: string | null;
  /** Source stream index of the selected image track, or null. */
  activeImageSubtitleStream: number | null;
  /**
   * Live playback clock, as a REF rather than state.
   *
   * The overlay is the only consumer that needs the time, and publishing it as
   * state re-rendered the whole player screen on every progress tick, four
   * times a second, roughly 29,000 times across a feature film. A Mac absorbs
   * that; an Apple TV already decoding H.264, encoding FLAC and serving its own
   * loopback HLS does not. The overlay samples this instead and re-renders only
   * when the set of visible cues actually changes.
   */
  currentTimeRef: React.RefObject<number>;
}

/**
 * Custom hook to manage video playback logic using a state machine
 * Handles codec checking, transcoding decisions, and player lifecycle
 */
export function useVideoPlayback(config: VideoPlaybackConfig): VideoPlaybackResult {
  const { videoId, skip, startPositionTicks, playedAtStart, onPlaybackEnd, probe } = config;

  // State machine
  const [state, dispatch] = useReducer(videoPlayerReducer, { type: "IDLE" });

  // Arm before the state machine's first FETCH_METADATA effect fires (the actual
  // fetch happens one render pass later, so any first-pass effect is early enough).
  useEffect(() => {
    setPlaybackProbeEnabled(probe === true, videoId);
  }, [probe, videoId]);

  // Persistent data across states
  const [videoDetails, setVideoDetails] = useState<JellyfinVideoItem | null>(null);
  const [hasTriedTranscoding, setHasTriedTranscoding] = useState(false);
  // Mirror of the flag for the stream effect to read. That effect used to take the
  // STATE as a dependency, and the local-remux fallback sets it mid-flight, before
  // an await, while the state is still CREATING_STREAM: React flushed, the effect
  // re-entered, and the second run reported Stopped against the session the first
  // run had just opened and then overwrote its PlaySessionId. Neither run looked
  // stale, because requestIdRef only moves when videoId does.
  const hasTriedTranscodingRef = useRef(false);
  const [hasTriedCredentialRefresh, setHasTriedCredentialRefresh] = useState(false);
  const [hasTriedSeekRecovery, setHasTriedSeekRecovery] = useState(false);
  // One engine restart per item for a mid-playback starvation (see planErrorRecovery).
  // Refs, not state: nothing renders on them, and onError reads them synchronously.
  const hasTriedRemuxRestartRef = useRef(false);
  // The engine's own segment clock for this session (Remuxer.reportThroughput): the last
  // few samples, the subscription that feeds them, and whether they already moved playback.
  const throughputRef = useRef<ThroughputWatch>({ samples: [], unsubscribe: null, handedOver: false });
  // The item currently bound to the player, so onProgress can read its source bitrate and re-open
  // it when the link recovers (climb-back to the on-device copy).
  const activeDetailsRef = useRef<JellyfinVideoItem | null>(null);
  // Earliest time a climb-back to the copy may fire again: a restart re-buffers, so a marginal link
  // must not oscillate copy<->server. Set after every fallback and every climb-back.
  const climbBackAtRef = useRef(0);
  // Set when a starvation pushed playback to the server: the transcode enters at the
  // floor preset (adaptive quality reads and clears it when building the stream URL).
  const stallFallbackRef = useRef(false);
  // Live adaptive-quality controller for the transcode lane (null = inactive).
  const adaptiveRef = useRef<AdaptiveQualityState | null>(null);
  // Preset index a mid-session switch rebuilds the stream with.
  const adaptiveOverrideIndexRef = useRef<number | null>(null);
  // The ceiling AVPlayer picks its variant under, from the link the engine measured behind the
  // loopback (0 = uncapped). AVPlayer's own estimator only ever sees 127.0.0.1.
  const linkCapRef = useRef(0);
  // A viewer's fixed quality pin outranks the measured cap; null while Auto.
  const pinnedCapRef = useRef<number | null>(null);
  // Smallest variant the master lists, the floor every measured cap is held above.
  const capFloorRef = useRef(0);
  // The pending hold on a link that cleared the source rate, and the earliest a rebuild may follow.
  const climbTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const climbAtRef = useRef(0);
  // True while the session rides the Slipstream tier as its survival floor: the
  // engine primary is unproducible on this link by design, so primary-starvation
  // teardowns (stall restart, engineStarving handover) are suppressed. The plain
  // server transcode floor is a HIGHER bitrate than the lowest rung, so falling
  // to it would regress, not recover; the tier + native producer-hold recover.
  const onTierLaneRef = useRef(false);
  /** The provider this run owns on the non-engine lanes; the engine lane serves its own frames. */
  const frameProviderTokenRef = useRef<string | null>(null);
  const [chapterFrameBaseUrl, setChapterFrameBaseUrl] = useState<string | null>(null);
  /** The engine's measured link carries the copy with room to spare, so a chapter grab beside the stream is affordable. */
  const [linkAffordsFrames, setLinkAffordsFrames] = useState(false);

  // Request ID to prevent race conditions when videoId changes
  // Incremented on each videoId change, async operations check before updating state
  const requestIdRef = useRef(0);

  // === Refs for synchronous access in event handlers ===
  // Note: These refs cannot be consolidated into state because event handlers
  // need synchronous access to avoid race conditions and stale closures.

  // Lifecycle & autoplay control
  const autoPlayTriggeredRef = useRef(false);
  const isMountedRef = useRef(true);
  const autoPlayTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stablePlaybackTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const seekTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Server session reporting: one PlaySessionId per stream (rotated in the
  // CREATING_STREAM effect), MediaSourceId from fetched details. The reset
  // callback is held in a ref because the reporter hook is initialized after
  // the callbacks/effects that need to close a session.
  const playSessionIdRef = useRef<string>(generatePlaySessionId());
  const mediaSourceIdRef = useRef<string | null>(null);
  const resetPlaybackSessionRef = useRef<(() => void) | null>(null);
  // Played flag as it stood BEFORE this session, captured on the first metadata fetch
  // only: mid-session re-fetches (audio switch, transcode retries) can return state the
  // server's resume gates already polluted during this same session. The reporter's
  // UserData writes restore this value so a partial play never flips a real watched flag.
  const wasPlayedAtStartRef = useRef<boolean | null>(null);

  // Status tracking (for debouncing rapid status changes)
  const isSeekingRef = useRef(false);
  const lastStatusChangeRef = useRef<number>(0);
  const hasStablePlaybackRef = useRef(false); // Ref for sync access in handlers

  // Playback mode & callbacks (avoid stale closures in event listeners)
  const currentModeRef = useRef<PlaybackMode>("direct");
  const onPlaybackEndRef = useRef(onPlaybackEnd);
  useEffect(() => {
    onPlaybackEndRef.current = onPlaybackEnd;
  }, [onPlaybackEnd]);

  // Track stable playback for UI (state triggers re-renders, ref is for sync checks)
  const [hasStablePlayback, setHasStablePlayback] = useState(false);

  /**
   * Playback state that callbacks below mutate. Declared ahead of every
   * callback that touches it: a ref referenced before its useRef line is
   * opaque to the React Compiler, which then flags each write as mutating a
   * frozen value and bails out of memoizing the hook.
   */
  const [paused, setPaused] = useState(true); // Start paused, will auto-play on load
  const currentTimeRef = useRef(0);
  const durationRef = useRef(0);
  const isPlayingRef = useRef(false);

  // Ref mirror of `paused` for native callbacks that fire outside the render cycle
  const pausedRef = useRef(true);
  useEffect(() => {
    pausedRef.current = paused;
  }, [paused]);

  // Audio track state (for tracking selected track)
  const selectedAudioTrackIndexRef = useRef<number | null>(null);
  /**
   * The Jellyfin stream index the VIEWER chose, set only by an actual switch.
   * selectedAudioTrackIndexRef also holds AVPlayer's own auto-selection, which is not a choice.
   */
  const viewerPickedAudioRef = useRef<number | null>(null);
  /** Counts the streams built, and the one the last audio report came from: a report from a newer one is its first. */
  const streamGenerationRef = useRef(0);
  const audioReportGenerationRef = useRef(0);

  // Jellyfin stream index of the audio actually playing. selectedAudioTrackIndexRef
  // can't serve this role: after load it holds the PLAYER-side sequential index
  // (0, 1, …) for change detection, which is not a Jellyfin stream index. This one
  // feeds the server reports (AudioStreamIndex) and, on localRemux rebuilds, the
  // preferred-track ordering, so error-recovery restarts keep the user's track.
  const audioStreamIndexForReportingRef = useRef<number | null>(null);

  // Image-based subtitle stream index to burn in during transcoding (PGS/DVDSUB)
  const burnInSubtitleIndexRef = useRef<number | null>(null);

  // The subtitle renditions the engine published for this item, in master
  // playlist order, so a pick in the native picker resolves to the track whose
  // bitmaps we have to draw.
  //
  // AVKit reports a selection by its own rendition ordinal, which is NOT the
  // Jellyfin stream index, and this list is what converts one to the other.
  // It used to be a Map keyed on the advertised NAME, which silently broke
  // every disc whose tracks share a label: a Map built from duplicate keys
  // keeps only the last value, so all 13 PGS tracks of a Blu-ray remux
  // resolved to the last one. Identity is structural now and no string is
  // matched anywhere in this path.
  const subtitleRenditionsRef = useRef<SubtitleRendition[]>([]);
  // Any subtitle stream at all, text or image; see the guard in onTextTracks.
  const itemHasSubtitleStreamsRef = useRef(false);

  // The remembered subtitle choice as applied to THIS item, read from the module
  // cache when the item starts and deliberately not changed while it plays.
  const [appliedSubtitlePreference, setAppliedSubtitlePreference] = useState<SubtitlePreference>(getSubtitlePreferenceSync);
  // Same value for onTextTracks, which is a stable callback and cannot close over
  // the state. The capture needs it to tell "the viewer turned subtitles off"
  // apart from "this file had nothing matching to select".
  const appliedSubtitlePreferenceRef = useRef<SubtitlePreference>(appliedSubtitlePreference);
  // Last selection the player reported for the current item. The settle timer
  // reads this rather than closing over one report, so a burst of reports only
  // ever persists the value it came to rest on.
  const lastObservedSubtitleRef = useRef<ObservedSubtitle | null>(null);
  const subtitleCaptureTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Whether the stored choice has already been applied to this item.
  const subtitlesAppliedForItemRef = useRef(false);
  // Languages the current item's subtitle tracks carry, as last reported. STATE, not
  // a ref: the effect that applies the choice waits for these, and a ref write is
  // invisible to it. On the engine lane the first usable report routinely lands after
  // playback is stable (the pipeline restarts and re-reports), so an effect keyed only
  // on the stable-playback edge ran once against an empty list and never again.
  const [textTrackLanguages, setTextTrackLanguages] = useState<string[]>([]);
  // The language we selected ON THE VIEWER'S BEHALF because the file flags it default.
  // Null once the viewer moves off it. See the capture below: an echo of this is not a
  // choice, and storing it would turn one file's default flag into a library-wide
  // preference.
  const autoAppliedDefaultRef = useRef<string | null>(null);

  // Store mapping from react-native-video track index to Jellyfin stream index
  const audioTrackMappingRef = useRef<number[]>([]);

  // Position to seek to after video restart (for audio track switching)
  const seekToPositionAfterLoadRef = useRef<number | null>(null);

  // Target of an in-flight auto-seek. While set, the reporter must not sample the
  // player clock: during the seek's buffering the clock still reads ~0, and one poll
  // tick reporting it would overwrite the seeded resume position (a back-out in that
  // window would then send Stopped(~0) and the server would wipe the resume point).
  const pendingSeekTargetRef = useRef<number | null>(null);

  // Track if currently using multi-audio mode
  const isUsingMultiAudioRef = useRef<boolean>(false);

  // Direct play errored once for this item. Read by fetchMetadata as a reason to
  // reach the engine: the file's codec and container both passed inspection, so
  // whatever AVPlayer objected to is in the wrapper, and rewrapping is the
  // cheapest fix available. Also keeps the retry off direct play, which would
  // otherwise re-select it and loop.
  const directPlayFailedRef = useRef<boolean>(false);
  // The engine lane is spent for this held item, so its subtitles stop being a reason to
  // reach for it. A download plays: losing the sidecar beats losing the film.
  const heldEngineSpentRef = useRef<boolean>(false);

  // Token of the on-device remux session THIS player instance started. Per
  // instance on purpose: two players are briefly mounted at once during a
  // screen transition, so shared state here makes one player's teardown kill
  // the other's session.
  const localRemuxTokenRef = useRef<string | null>(null);
  // Live TV: the channel stream the server opened for this play, released on every teardown.
  const isLiveRef = useRef<boolean>(false);
  const liveStreamIdRef = useRef<string | null>(null);
  // One fresh open of the channel per play after the stream drops; the second drop is the error.
  const liveReopenedRef = useRef(false);
  // The live ladder: the engine, then the server's transcode when the open returned one, then the error.
  const liveLaneRef = useRef<"engine" | "server">("engine");
  // The channel this play opened and the engine URL it reads, handed to the live ring on a flip.
  const liveDetailsRef = useRef<JellyfinVideoItem | null>(null);
  const liveSessionUrlRef = useRef<string | null>(null);
  // A hot ring session taken for this item, bound by the stream step instead of a new start.
  const adoptedLiveRef = useRef<{ videoId: string; url: string; token: string; ready: boolean } | null>(null);
  // This player's playlist shim (EXT-X-START resume on the server lane) ,
  // per-instance for the same overlap reason as the remux token.
  const playlistShimTokenRef = useRef<string | null>(null);
  // Direct-lane stall watchdog: playhead snapshot + expiry timer, armed by
  // AVPlayer's buffer-empty event. Direct play is the one lane with no
  // recovery of its own, a starving session stalls WITHOUT an error, so
  // nothing fires the ladder and playback hangs forever.
  const stallWatchRef = useRef<{ pos: number; timer: ReturnType<typeof setTimeout> } | null>(null);

  // Track last logged state for deduplication
  const lastLoggedAudioTracksRef = useRef<string>("");
  const lastLoggedTextTracksRef = useRef<string>("");

  /**
   * Step 1: Fetch video metadata and determine playback mode
   */
  const fetchMetadata = useCallback(async () => {
    // Capture current request ID to check for stale responses
    const currentRequestId = requestIdRef.current;

    logger.debug("Fetching video details", { service: "useVideoPlayback", videoId, requestId: currentRequestId });
    setPlaybackStage("details");

    // One player at a time: starting any video ends background music. No-op
    // when the audio queue is idle (covers mid-item restarts too).
    void audioPlayerManager.stop();

    // The channel this attempt opened: a failure before playback takes it closes it again.
    let openedLiveStreamId: string | null = null;
    // A session taken for an earlier attempt and never bound.
    if (adoptedLiveRef.current) {
      void stopLocalRemux(adoptedLiveRef.current.token);
      adoptedLiveRef.current = null;
    }
    // Both halves sit in their own function: the React Compiler cannot lower a conditional
    // or an optional chain inside a try block, and bails out of memoizing the hook if it finds one.
    const readDetails = async () => {
      // The ring's session for this channel, ready or still starting, is taken rather than opened twice.
      const ringSession = await takeRingSession(videoId);
      if (ringSession && requestIdRef.current !== currentRequestId) {
        void stopLocalRemux(ringSession.token);
        return;
      }
      if (ringSession) adoptedLiveRef.current = { videoId, url: ringSession.url, token: ringSession.token, ready: ringSession.ready };
      let details = ringSession ? ringSession.details : await fetchVideoDetails(videoId);

      // Check if this response is stale (videoId changed while fetching)
      if (requestIdRef.current !== currentRequestId) {
        // A channel's fetch is its open: nobody will play this stream, so release its tuner.
        if (details?.LiveStreamId) void closeLiveStream(details.LiveStreamId);
        logger.debug("Ignoring stale metadata response", {
          service: "useVideoPlayback",
          expectedRequestId: requestIdRef.current,
          actualRequestId: currentRequestId,
        });
        return;
      }

      if (!details) fail("Video not found or unavailable");

      // A channel the engine could not play opens on the server now, for its transcode.
      if (isLiveSource(details) && liveLaneRef.current === "server" && !details.liveTranscodeUrl) {
        setPlaybackStage("opening");
        details = await openChannel(videoId, details, { serverOnly: true });
        if (requestIdRef.current !== currentRequestId) {
          void closeLiveStream(details.LiveStreamId);
          return;
        }
      }

      setVideoDetails(details);
      mediaSourceIdRef.current = details.MediaSources?.[0]?.Id ?? null;
      // Live TV: the engine reads the channel, the server's transcode follows; resume, the link
      // gate and verdicts do not apply.
      const live = isLiveSource(details);
      isLiveRef.current = live;
      liveStreamIdRef.current = details.LiveStreamId ?? null;
      liveDetailsRef.current = live ? details : null;
      openedLiveStreamId = liveStreamIdRef.current;
      if (wasPlayedAtStartRef.current === null) {
        wasPlayedAtStartRef.current = playedAtStart ?? details.UserData?.Played ?? false;
      }

      const gates = planLaneGates({
        details,
        decodeSupport: await videoDecodeSupport(),
        // Reads the warmed per-server memory only: a probe takes seconds on exactly the links
        // this gate exists for, so session start never blocks on one. Cold memory = no gate.
        measuredBps: (details.MediaSources?.[0]?.Bitrate ?? 0) > 0 && !live && !playsFromDisk(videoId) ? await rememberedBitrate() : null,
        heldOnDisk: playsFromDisk(videoId),
        heldAsMp4: playsRepackaged(videoId),
        directPlayFailed: directPlayFailedRef.current,
        hasTriedTranscoding,
        heldEngineSpent: heldEngineSpentRef.current,
        liveLane: liveLaneRef.current,
      });
      const { audioOnly, hasTextSubs, textSubtitles, burnInStream } = gates;

      // The same list, built by the same function, that startLocalRemux hands the engine, so an
      // ordinal reported by onTextTracks indexes it directly.
      subtitleRenditionsRef.current = audioOnly ? [] : sessionSubtitleRenditions(details);
      if (subtitleRenditionsRef.current.length > 0) {
        logger.debug("📝 Subtitles: publishing renditions", {
          service: "useVideoPlayback",
          renditions: subtitleRenditionsRef.current.map(
            (rendition) => `${rendition.name} [${rendition.language}]${rendition.isDefault ? " default" : ""}${rendition.isForced ? " forced" : ""}${rendition.isImage ? " image" : ""}`,
          ),
        });
      }
      itemHasSubtitleStreamsRef.current = gates.itemHasSubtitleStreams;

      if (gates.linkTooSlowForDirect) {
        logger.info("Link below source bitrate, routing off direct play", {
          service: "useVideoPlayback",
          sourceMbps: Math.round(gates.sourceBps / 100_000) / 10,
        });
      }
      if (gates.heldOnDisk) {
        logger.info("Held file, reading the local container", {
          service: "useVideoPlayback",
          repackaged: gates.heldAsMp4,
          sourceContainer: details.MediaSources?.[0]?.Container,
        });
      }

      // A file the engine measured below realtime on this device goes to the server from the
      // first request (engineVerdicts.ts); Diagnostics reads the reason like any decline.
      const remembered = gates.asksRememberedVerdict ? await rememberedVerdict(details) : null;
      if (remembered)
        probeEmit("decline", { reason: "engine below realtime on an earlier play", produceSeconds: remembered.produceSeconds, segmentSeconds: remembered.segmentSeconds, at: remembered.at });

      const canRemux = gates.engineGate && !remembered && (await canRemuxLocally(details));
      if (!canRemux && adoptedLiveRef.current) {
        // The server lane reads the open, not the engine session taken with it.
        void stopLocalRemux(adoptedLiveRef.current.token);
        adoptedLiveRef.current = null;
      }

      const lane = selectLane(gates, { canRemux, subtitlesOff: getSubtitlePreferenceSync().kind === "off" });
      if (lane.unplayable) fail(lane.unplayable);
      const selectedMode = lane.mode;
      burnInSubtitleIndexRef.current = lane.burnInSubtitleIndex;

      if (lane.mode === "localRemux") {
        logger.info("Codec supported in another container, remuxing on device", {
          service: "useVideoPlayback",
          codec: details.MediaStreams?.find((stream) => stream.Type === "Video")?.Codec,
          container: details.MediaSources?.[0]?.Container,
        });
      } else if (gates.live) {
        liveLaneRef.current = "server";
        logger.info("Live channel on the server's transcode", { service: "useVideoPlayback", reason: lane.liveFallbackReason });
        probeEmit("fallback", { from: "localRemux", to: "transcode", reason: lane.liveFallbackReason ?? "" });
      } else if (lane.mode === "transcode") {
        // Fallback only: the engine could not take this file. The server session uses MPEG-TS
        // segments so Jellyfin's WebVTT renditions and their 10s X-TIMESTAMP-MAP stay aligned.
        logger.info("Server transcode", {
          service: "useVideoPlayback",
          codecUnsupported: gates.requiresTranscoding,
          textSubtitleCount: hasTextSubs ? textSubtitles.length : 0,
          burnInStreamIndex: lane.burnInSubtitleIndex,
          retry: hasTriedTranscoding,
        });
      } else {
        logger.info("Using direct play", { service: "useVideoPlayback" });
      }
      const resume = resolveResume({
        live: gates.live,
        pendingSeekSec: seekToPositionAfterLoadRef.current,
        startPositionTicks,
        userDataTicks: details.UserData?.PlaybackPositionTicks,
      });
      if (resume.seconds !== null) {
        seekToPositionAfterLoadRef.current = resume.seconds;
        logger.info("Resuming playback", { service: "useVideoPlayback", position: resume.seconds, from: resume.source, mode: selectedMode });
      }

      // Update mode ref before dispatch (for event listener closures)
      currentModeRef.current = selectedMode;

      probeEmit("mode", { mode: selectedMode, canDirectPlay: !gates.requiresTranscoding, hasTextSubs, burnIn: burnInStream !== null, held: gates.heldOnDisk });
      probeEmit("source", sourceSummary(details));

      dispatch({
        type: "METADATA_FETCHED",
        details,
        mode: selectedMode,
        hasSubtitles: hasTextSubs || burnInStream !== null,
      });

      if (selectedMode === "transcode") {
        hasTriedTranscodingRef.current = true;
        setHasTriedTranscoding(true);
      }
    };

    const failed = (err: unknown) => {
      logger.error("Error fetching metadata", err, { service: "useVideoPlayback", videoId });

      // Classify error and provide user-friendly message
      const errorType = classifyPlaybackError(err);
      const errorMessage = getPlaybackErrorMessage(errorType);

      probeEmit("error", { mode: "metadata", message: String(err), willRetry: false });
      if (openedLiveStreamId) {
        void closeLiveStream(openedLiveStreamId);
        if (liveStreamIdRef.current === openedLiveStreamId) liveStreamIdRef.current = null;
      }

      // An attempt the viewer already left: its failure belongs to no channel on screen.
      if (requestIdRef.current !== currentRequestId) return;

      // Terminal, whatever hasTriedTranscoding says. The transcode retry exists for a stream
      // that failed to PLAY; here nothing was fetched, so it re-runs this identical request and
      // fails identically, costing a second round trip and a spinner in front of the error. The
      // flag also keeps the auto-retry effect from setting hasTriedTranscoding, so the Retry
      // button still gets a clean direct-play attempt rather than a forced server transcode.
      dispatch({
        type: "PLAYER_ERROR",
        error: { message: errorMessage },
        mode: "direct",
        hasTriedTranscode: true,
      });
    };

    try {
      await readDetails();
    } catch (err) {
      failed(err);
    }
  }, [videoId, startPositionTicks, playedAtStart, hasTriedTranscoding]);

  /**
   * Handle audio track switch by restarting video with new audioStreamIndex
   */
  const handleAudioTrackSwitch = useCallback(
    (newTrackIndex: number) => {
      if (!videoId || !videoDetails) {
        logger.error("❌ Cannot switch audio track: missing video info", {
          service: "useVideoPlayback",
        });
        return;
      }

      // Save current playback position for auto-seek after restart; a live channel rejoins at the edge.
      const currentPosition = currentTimeRef.current;
      seekToPositionAfterLoadRef.current = isLiveRef.current ? null : currentPosition;

      logger.info("🔄 Starting audio track switch via restart", {
        service: "useVideoPlayback",
        jellyfinStreamIndex: newTrackIndex,
        savedPosition: currentPosition,
      });

      // Pause current playback
      setPaused(true);

      // Reset playing state refs so onProgress will detect playback start after restart
      isPlayingRef.current = false;
      hasStablePlaybackRef.current = false;
      setHasStablePlayback(false);

      // Force restart by transitioning through states
      dispatch({ type: "RETRY_WITH_TRANSCODE" });

      // Store selected audio track for URL generation and server reporting
      selectedAudioTrackIndexRef.current = newTrackIndex;
      audioStreamIndexForReportingRef.current = newTrackIndex;
      viewerPickedAudioRef.current = newTrackIndex;
    },
    [videoId, videoDetails],
  );

  /**
   * Store streamUrl in state to keep it stable across state transitions
   */
  const [streamUrl, setStreamUrl] = useState<string | null>(null);
  // For native failures, which name the source that failed.
  const streamUrlRef = useRef<string | null>(null);
  useEffect(() => {
    streamUrlRef.current = streamUrl;
  }, [streamUrl]);
  // Slipstream gateway sessions: RNV maxBitRate (→ preferredPeakBitRate, live)
  // caps which loopback variant AVPlayer may pick. A pinned quality preset
  // becomes this cap, seamless, no session rebuild; Auto and every
  // non-gateway session leave it null (prop omitted).
  const [videoMaxBitRate, setVideoMaxBitRate] = useState<number | null>(null);
  /** The viewer's audio track, re-applied by position after a rebuild; undefined = AVPlayer's own pick. */
  const [selectedAudioTrack, setSelectedAudioTrack] = useState<SelectedTrack | undefined>(undefined);
  /** preferredForwardBufferDuration for rung-lane sessions; null (AVPlayer's own threshold) elsewhere. */
  const [forwardBufferSeconds, setForwardBufferSeconds] = useState<number | null>(null);

  /** Resume handed to AVFoundation with the source (Mac). See VideoPlaybackResult. */
  const [startPositionMs, setStartPositionMs] = useState<number | null>(null);

  // Source stream index of the image subtitle track the viewer picked in
  // AVKit's own picker, or null when subtitles are off or the pick was a text
  // track (which AVKit renders itself). Drives the bitmap overlay.
  const [activeImageSubtitleStream, setActiveImageSubtitleStream] = useState<number | null>(null);

  /**
   * Rebuild the session from the state machine, resuming at `position`. Every lane change and
   * recovery goes through here: the player is unmounted with the stream URL so the dead source
   * cannot fire again, and the play/stable edges are re-armed so the next session reports them.
   */
  const restartAtPlayhead = useCallback((position?: number) => {
    if (position !== undefined) seekToPositionAfterLoadRef.current = position;
    autoPlayTriggeredRef.current = false;
    isPlayingRef.current = false;
    hasStablePlaybackRef.current = false;
    setHasStablePlayback(false);
    setStreamUrl(null);
    setImmediate(() => {
      if (!isMountedRef.current) return;
      dispatch({ type: "RETRY_WITH_TRANSCODE" });
    });
  }, []);

  /**
   * The engine is losing mid-play: one move to the server at the playhead, before the buffer
   * runs dry, in place of the stall ladder's restart-then-server. The link is fine, so the
   * server session opens at the viewer's own preset.
   */
  const handOverToServer = useCallback(
    (details: JellyfinVideoItem, sample: ThroughputSample) => {
      const watch = throughputRef.current;
      // A live channel has no server lane to hand over to.
      if (!isMountedRef.current || currentModeRef.current !== "localRemux" || watch.handedOver || isLiveRef.current) return;
      watch.handedOver = true;
      const position = currentTimeRef.current;
      logger.warn("Engine fell below realtime, leaving the engine lane at the playhead", {
        service: "useVideoPlayback",
        position: Math.round(position),
        produceSeconds: sample.produceSeconds,
        segmentSeconds: sample.segmentSeconds,
        cushion: sample.cushion,
      });
      // A held file goes back to its own disk at the playhead, never to a server: the engine
      // running short on a file this device already holds is a reason to stop remuxing it, not a
      // reason to ask the network for something the network need not be involved in.
      const heldReplay = playsFromDisk(details.Id);
      probeEmit("fallback", { from: "localRemux", to: heldReplay ? "direct" : "transcode", reason: "engine fell below realtime" });
      // A read-bound segment measured the LINK, not the device: the engine waited on a slow pull it
      // cannot speed up. Blocklisting the file (engineVerdicts) would then route every later play off
      // the engine on a link that has since changed. Only a produce-bound stall is a device verdict.
      if (!readBound(sample)) void recordVerdict(details, sample, "fell below realtime mid-play", { busy: deviceBusy() });
      stopLocalRemux(localRemuxTokenRef.current);
      localRemuxTokenRef.current = null;
      dropThroughputWatch(watch);
      if (heldReplay) {
        heldEngineSpentRef.current = true;
      } else {
        hasTriedTranscodingRef.current = true;
        setHasTriedTranscoding(true);
        // The engine starved on this link, so the server lane enters at the floor and adapts up.
        // Without this it takes the Auto startup pick, which trusts a bitrate probe that overreads a
        // throttled link and opens at Original: a bitrate the link cannot carry (black video, audio only).
        stallFallbackRef.current = true;
      }
      climbBackAtRef.current = Date.now() + CLIMB_BACK_COOLDOWN_MS;
      restartAtPlayhead(position);
    },
    [restartAtPlayhead],
  );

  /**
   * The reverse of handOverToServer: the link has recovered enough to carry the source, so leave
   * the server transcode and re-open the on-device copy at the playhead. A restart re-buffers (the
   * VOD scrub bar rules out a seamless in-playlist switch), so it fires at most once per cooldown
   * and only when even the leftover-bandwidth probe clears the source rate.
   */
  const climbBackToCopy = useCallback(
    (details: JellyfinVideoItem) => {
      if (!isMountedRef.current || currentModeRef.current !== "transcode" || isLiveRef.current || playsFromDisk(details.Id)) return;
      const position = currentTimeRef.current;
      logger.info("Link recovered, climbing back to the on-device copy at the playhead", { service: "useVideoPlayback", position: Math.round(position) });
      probeEmit("fallback", { from: "transcode", to: "localRemux", reason: "link recovered above source" });
      // Clear every flag that pins the session to the server so the mode picker chooses the engine
      // again; the link now measures able to carry it.
      hasTriedTranscodingRef.current = false;
      setHasTriedTranscoding(false);
      stallFallbackRef.current = false;
      directPlayFailedRef.current = false;
      climbBackAtRef.current = Date.now() + CLIMB_BACK_COOLDOWN_MS;
      restartAtPlayhead(position);
    },
    [restartAtPlayhead],
  );

  /**
   * Step 2: Generate stream URL when in CREATING_STREAM state
   */
  useEffect(() => {
    if (state.type !== "CREATING_STREAM") return;

    const { mode, details } = state;
    // An item change reaches this effect before the reset below moves the request id, with the
    // previous item's state and the new videoId. Nothing of the old item starts for the new one.
    if (details.Id !== videoId) return;
    // Capture current request ID to check for stale responses
    const currentRequestId = requestIdRef.current;

    const generateStreamUrl = async () => {
      // Both halves sit in their own function: a conditional or an optional chain inside a try
      // block is not lowerable, and one there costs the whole hook its memoization.
      const buildStream = async () => {
        // New stream = new server session: report Stopped for any in-flight session
        // (no-op if playback never started) and mint a fresh PlaySessionId before
        // building the URL that carries it. Central choke point for every path that
        // recreates the stream (initial load, audio switch, seek recovery, retries).
        resetPlaybackSessionRef.current?.();
        // The item bound to the player, so onProgress can read its source rate and re-open it on
        // the copy when the link recovers.
        activeDetailsRef.current = details;
        // A live channel reports under the session the server opened its stream for.
        playSessionIdRef.current = isLiveRef.current && details.PlaySessionId ? details.PlaySessionId : generatePlaySessionId();
        // A new server session orphans the group's view of us; tell it we are buffering
        // until the fresh stream reports ready, so the group waits rather than plays on.
        syncPlayManager.noteStreamRebuild();

        // Empty until a lane builds it; the guard below the branch is what catches a lane that did not.
        let url = "";

        // A live channel's server transcode, opened on first need; null when the server offers none.
        let liveServerRung: Promise<string | null> | null = null;
        // Its own function for the same reason as the lanes below: no value block may sit in a try.
        const openChannelOnServer = async (): Promise<string | null> => {
          const opened = await openChannel(videoId, details, { serverOnly: true });
          if (requestIdRef.current !== currentRequestId) {
            void closeLiveStream(opened.LiveStreamId);
            return null;
          }
          liveStreamIdRef.current = opened.LiveStreamId ?? null;
          mediaSourceIdRef.current = opened.MediaSources?.[0]?.Id ?? mediaSourceIdRef.current;
          // The transcode runs under the session the open named, which a Stopped report ends.
          if (opened.PlaySessionId) playSessionIdRef.current = opened.PlaySessionId;
          return opened.liveTranscodeUrl ?? null;
        };
        const openLiveServerRung = () => {
          if (liveServerRung !== null) return liveServerRung;
          liveServerRung = (async () => {
            if (details.liveTranscodeUrl) return details.liveTranscodeUrl;
            try {
              return await openChannelOnServer();
            } catch (openError) {
              logger.warn("Live channel has no server transcode to fall back on", openError, { service: "useVideoPlayback", videoId });
              // Neither lane plays it: the ring neither warms nor heats it for a while.
              noteOpenFailed(videoId);
              return null;
            }
          })();
          return liveServerRung;
        };

        // Adaptive-quality entry for the server lane (see services/adaptiveQuality.ts).
        // Returns the session's preset override, or undefined = the stored setting,
        // which is byte-for-byte the pre-adaptive URL.
        const resolveTranscodePreset = async (): Promise<QualityPreset | undefined> => {
          // A mid-session switch: the controller already holds the state, and nothing here is read.
          if (adaptiveOverrideIndexRef.current != null) return QUALITY_PRESETS[adaptiveOverrideIndexRef.current];
          const quality = await getQualitySettings();
          const need = measurementFor({ hasOverride: false, stallFallback: stallFallbackRef.current, mode: quality.mode });
          const measuredBps = need === "none" ? null : need === "remembered" ? await rememberedBitrate() : ((await rememberedBitrate()) ?? (await measureServerBitrate()));
          const plan = planTranscodePreset({
            overrideIndex: null,
            mode: quality.mode,
            qualityIndex: quality.index,
            stallFallback: stallFallbackRef.current,
            measuredBps,
            sourceBitrateBps: details.MediaSources?.[0]?.Bitrate ?? null,
            nowMs: Date.now(),
          });
          if (plan.reason === "stallFallback") stallFallbackRef.current = false;
          if (plan.adaptive) adaptiveRef.current = plan.adaptive;
          logger.info("Server lane quality", {
            service: "useVideoPlayback",
            reason: plan.reason,
            start: QUALITY_PRESETS[plan.startIndex].label,
            ceiling: QUALITY_PRESETS[plan.ceilingIndex].label,
            measuredMbps: measuredBps != null ? Math.round(measuredBps / 100_000) / 10 : null,
          });
          return plan.preset;
        };

        // The server's playlists re-served through the loopback (PlaylistShim.swift). A resume
        // rides in as EXT-X-START, so AVPlayer opens AT the pending position instead of buffering
        // position zero, and the consumed seek ref suppresses the post-load auto-seek. An HDR
        // source always goes through it: a server that does not tone-map answers H.264 with the
        // PQ tags intact under a master that says SDR, which AVPlayer refuses (-12927), so the
        // shim retags any avc1 init BT.709. Null shim (no module, fetch failure) = raw URL.
        const hdrSource = sourceIsHdr(details);
        const viaShim = async (rawUrl: string): Promise<string> => {
          const offset = seekToPositionAfterLoadRef.current;
          const resuming = offset != null && offset > 0;
          if ((!resuming && !hdrSource) || requestIdRef.current !== currentRequestId) return rawUrl;
          const shimUrl = await startPlaylistShim(rawUrl, resuming ? offset : 0, { sdrInit: hdrSource });
          if (shimUrl == null) return rawUrl;
          if (requestIdRef.current !== currentRequestId) {
            // Stale since the await: this run's shim goes, the offset stays for the run that owns it.
            stopPlaylistShim(localRemuxToken(shimUrl));
            return rawUrl;
          }
          stopPlaylistShim(playlistShimTokenRef.current);
          playlistShimTokenRef.current = localRemuxToken(shimUrl);
          if (resuming) {
            seekToPositionAfterLoadRef.current = null;
            // The playhead IS the offset until the first progress tick lands, so an adaptive
            // switch or error recovery capturing the position before then carries it, not 0.
            currentTimeRef.current = offset;
          }
          logger.info("Playlist shim: opening the server stream through the loopback", {
            service: "useVideoPlayback",
            offsetSeconds: resuming ? Math.round(offset) : 0,
            sdrInit: hdrSource,
          });
          return shimUrl;
        };

        /**
         * The engine times segment 0 before AVPlayer is bound, so a session that cannot produce
         * in realtime falls to the server with nothing on screen to restart. Throws when the
         * engine failed; false means the viewer already left this attempt.
         */
        const runEnginePreflight = async (engineUrl: string): Promise<boolean> => {
          setPlaybackStage("reading");
          // Pre-flight: the engine times segment 0 before AVPlayer is bound. Below realtime
          // means the server lane with nothing on screen to restart; the deadline is the
          // engine's own 20 s segment deadline. Later samples feed the mid-play watch.
          const token = localRemuxToken(engineUrl) ?? "";
          dropThroughputWatch(throughputRef.current);
          throughputRef.current.handedOver = false;
          // Owned before the wait, not after: a viewer who leaves during the pre-flight has to
          // have something to tear down.
          localRemuxTokenRef.current = token || null;
          const preflight = createPreflightGate();
          // Before the link subscription below: its first report can land in the first seconds,
          // and a cap under the smallest variant leaves AVPlayer nothing to play.
          capFloorRef.current = offeredTierBandwidths(details, audioStreamIndexForReportingRef.current ?? undefined)[0] ?? 0;
          const stopThroughput = subscribeEngineThroughput(token, (sample) => {
            throughputRef.current.samples = [...throughputRef.current.samples.slice(-7), sample];
            if (preflight.settle(sample)) return;
            // On the tier lane the primary is unproducible by design; its starvation is not
            // a reason to abandon the tier for a higher-bitrate server transcode.
            if (engineStarving(throughputRef.current.samples) && !onTierLaneRef.current) handOverToServer(details, sample);
          });
          // The engine's measured link becomes AVPlayer's ceiling, so it picks among the
          // variants the link carries instead of the ones the loopback makes look free. Applied
          // live (RNV maxBitRate -> preferredPeakBitRate), so a drop or a recovery moves it
          // without rebuilding the session; a fixed pin stays the ceiling it already is.
          const stopLink = subscribeEngineLink(token, ({ bps, copyListed }) => {
            probeEmit("link", { bps: Math.round(bps), copyListed: copyListed ?? null });
            setLinkAffordsFrames(linkAffordsChapterFrames(bps, details.MediaSources?.[0]?.Bitrate ?? 0));
            if (pinnedCapRef.current != null || currentModeRef.current !== "localRemux") return;
            // Never below the smallest variant in the master: a cap under all of them leaves
            // AVPlayer nothing it may play, and it wanders between every one of them without
            // ever showing a frame (drill S5 at 0.6 Mb/s).
            const cap = nextLinkCap({ bps, currentCap: linkCapRef.current, floorBps: capFloorRef.current });
            if (cap === null) return;
            linkCapRef.current = cap;
            setVideoMaxBitRate(cap);
            logger.info("Slipstream cap follows the measured link", { service: "useVideoPlayback", linkMbps: Math.round(bps / 100_000) / 10, capMbps: Math.round(cap / 100_000) / 10 });
          });
          // A master written for a link below the source carries no copy variant: AVPlayer
          // evaluates whatever it is offered, and a copy segment a slow link cannot finish
          // fails the whole item on its 6s deadline. So a link that recovers is climbed by
          // rebuilding the session at the playhead, once the recovery has held.
          const engineSourceBps = details.MediaSources?.[0]?.Bitrate ?? 0;
          const climbToCopy = (bps: number) => {
            climbTimerRef.current = null;
            if (!isMountedRef.current || currentModeRef.current !== "localRemux") return;
            climbAtRef.current = Date.now() + LINK_CLIMB_COOLDOWN_MS;
            logger.info("Link carries the source again, rebuilding on the on-device copy", {
              service: "useVideoPlayback",
              linkMbps: Math.round(bps / 100_000) / 10,
              position: Math.round(currentTimeRef.current),
            });
            probeEmit("fallback", { from: "localRemux", to: "localRemux", reason: "link recovered above source" });
            restartAtPlayhead(currentTimeRef.current);
          };
          const stopClimb = subscribeEngineLink(token, ({ bps, copyListed }) => {
            if (currentModeRef.current !== "localRemux") return;
            // The hold runs on a timer, not on the next report: a link fast enough to fill the
            // rung read-ahead stops the engine's server reads, and with them the reports it is
            // measured from (on the TV the last report came 1.5s into the recovery).
            const verdict = planLinkClimb({
              bps,
              sourceBps: engineSourceBps,
              copyListed,
              armed: climbTimerRef.current !== null,
              nowMs: Date.now(),
              cooldownUntilMs: climbAtRef.current,
            });
            if (verdict === "cancel") {
              if (climbTimerRef.current) clearTimeout(climbTimerRef.current);
              climbTimerRef.current = null;
            } else if (verdict === "arm") {
              climbTimerRef.current = setTimeout(() => climbToCopy(bps), LINK_CLIMB_HOLD_MS);
            }
          });
          // The engine reports a pipeline failure as it happens, so an input it could not open
          // ends the wait now rather than at the deadline.
          const stopFailure = subscribeEngineFailure(token, (failure) => preflight.settle({ failed: failure.message }));
          // The engine's startup steps, as they finish: the input is open, the tracks are known.
          const stopStage = subscribeEngineStage(token, ({ stage }) => {
            if (stage === "open_input") setPlaybackStage("analysing");
            else if (stage === "find_stream_info" || stage === "source_released") setPlaybackStage("preparing");
          });
          // The tier lane is armed only on the master's confirmed "listed" verdict: a lane AVPlayer
          // can actually ride. A declined or dropped tier disarms it, so starvation teardown and
          // stall recovery resume and the session falls to the plain server transcode, never hangs.
          const stopTier = subscribeEngineTier(token, (report) => {
            onTierLaneRef.current = report.state === "listed";
          });
          throughputRef.current.unsubscribe = () => {
            stopThroughput();
            stopLink();
            stopClimb();
            if (climbTimerRef.current) clearTimeout(climbTimerRef.current);
            climbTimerRef.current = null;
            stopFailure();
            stopStage();
            stopTier();
          };
          if (tierDeclaredFor(token)) {
            // A ladder is offered: AVPlayer opens on the variant the master leads with, so the
            // engine primary's segment 0 is never the startup gate. Serve the master now rather than wait on a pull the player will not use at
            // startup. Arm the tier lane up front; the tier report confirms it on "listed" or
            // clears it on "declined"/"dropped", so a ladder the server cannot deliver still falls
            // to the transcode and never hangs. Samples now feed the mid-play starvation watch.
            preflight.close();
            onTierLaneRef.current = true;
            // AVPlayer's own start threshold buffers around 24s of media, and every rung segment
            // costs a server encode: 0.6 Mb/s took 38s to a first frame. Two server segments is
            // enough to ride out the encoder's warm-up, which one is not (measured: segment 1
            // landed 0.3s late and AVPlayer then rebuffered for 12s).
            setForwardBufferSeconds(SLIPSTREAM_FORWARD_BUFFER_SECONDS);
            probeEmit("preflight", { produceSeconds: null, segmentSeconds: null, readSeconds: null, thermal: "unknown", remembered: false, keptForTier: true });
            logger.info("Ladder offered, opening without timing the engine primary", { service: "useVideoPlayback" });
          } else {
            // A failure reported before these listeners existed is never replayed: ask the session itself.
            const startedAlive = await engineProgress(token);
            if (startedAlive !== null && !startedAlive.alive) preflight.settle({ failed: "engine session ended before its pre-flight" });
            // A deadline that finds the session alive and still pulling bytes at the link's pace
            // is the link's deadline, not the engine's: wait again, up to the cap.
            let outcome: PreflightOutcome = null;
            let waitedMs = 0;
            let bytesSeen = -1;
            while (requestIdRef.current === currentRequestId) {
              outcome = await preflight.next(ENGINE_SEGMENT_DEADLINE_MS);
              waitedMs += ENGINE_SEGMENT_DEADLINE_MS;
              if (outcome !== null || waitedMs >= ENGINE_PREFLIGHT_CAP_MS) break;
              const progress = await engineProgress(token);
              if (!stillPullingInput(progress, bytesSeen, READ_BOUND_SHARE)) break;
              bytesSeen = progress.bytesRead;
              probeEmit("preflight", { produceSeconds: null, segmentSeconds: null, thermal: "unknown", remembered: false, extendedSeconds: waitedMs / 1000 });
              logger.info("Engine is still pulling the opening segment at the link's pace, waiting on it", {
                service: "useVideoPlayback",
                waitedSeconds: waitedMs / 1000,
                megabytesRead: Math.round(progress.bytesRead / 100_000) / 10,
              });
            }
            preflight.close();
            if (requestIdRef.current !== currentRequestId) {
              stopLocalRemux(token);
              // A newer run may own the shared token and watch by now; clearing them leaks its session.
              if (localRemuxTokenRef.current === token) {
                localRemuxTokenRef.current = null;
                dropThroughputWatch(throughputRef.current);
              }
              return false;
            }
            if (outcome && "failed" in outcome) {
              // Nothing was read, so nothing was measured about the device: no verdict.
              probeEmit("preflight", { produceSeconds: null, segmentSeconds: null, thermal: "unknown", remembered: false, failed: outcome.failed });
              stopLocalRemux(token);
              localRemuxTokenRef.current = null;
              dropThroughputWatch(throughputRef.current);
              if (engineInputMissing(outcome.failed) && !playsFromDisk(videoId)) throw new EngineInputMissingError(outcome.failed);
              throw new Error(`engine failed: ${outcome.failed}`);
            }
            const sample = outcome;
            const under = sample !== null && belowRealtime(sample);
            const keptFor = keptForReason({
              belowRealtime: under,
              live: isLiveRef.current,
              // The channel's own rung, opened only when one is needed to decide.
              liveHasServerRung: under && isLiveRef.current ? (await openLiveServerRung()) !== null : false,
              tierDeclared: tierDeclaredFor(token),
              readBound: sample !== null && readBound(sample),
            });
            if (requestIdRef.current !== currentRequestId) {
              stopLocalRemux(token);
              if (localRemuxTokenRef.current === token) {
                localRemuxTokenRef.current = null;
                dropThroughputWatch(throughputRef.current);
              }
              return false;
            }
            if (sample && keptFor) {
              probeEmit("preflight", {
                produceSeconds: sample.produceSeconds ?? null,
                segmentSeconds: sample.segmentSeconds,
                readSeconds: sample.readSeconds ?? null,
                thermal: sample.thermal,
                remembered: false,
                ...(keptFor === "tier" ? { keptForTier: true } : { keptForLink: true }),
              });
              logger.info("Engine is below realtime, keeping it", {
                service: "useVideoPlayback",
                keptFor,
                produceSeconds: sample.produceSeconds,
                segmentSeconds: sample.segmentSeconds,
                readSeconds: sample.readSeconds,
              });
            } else if (!sample || belowRealtime(sample)) {
              // A channel says nothing about the device: no verdict.
              const remembered = isLiveRef.current
                ? false
                : sample
                  ? await recordVerdict(details, sample, "below realtime at start", { busy: deviceBusy() })
                  : await recordTimeoutVerdict(details, waitedMs / 1000, { busy: deviceBusy() });
              // The measurement itself, so Diagnostics says what was timed and whether it was kept.
              probeEmit("preflight", {
                produceSeconds: sample?.produceSeconds ?? null,
                segmentSeconds: sample?.segmentSeconds ?? null,
                readSeconds: sample?.readSeconds ?? null,
                thermal: sample?.thermal ?? "unknown",
                remembered,
              });
              stopLocalRemux(token);
              localRemuxTokenRef.current = null;
              dropThroughputWatch(throughputRef.current);
              throw new Error(sample ? "engine below realtime" : `engine produced no segment within ${waitedMs / 1000}s`);
            }
          }
          return true;
        };

        if (mode === "transcode") {
          setPlaybackStage("server");
          // Single-variant server stream: nothing for a cap to steer.
          linkCapRef.current = 0;
          pinnedCapRef.current = null;
          onTierLaneRef.current = false;
          setVideoMaxBitRate(null);
          setForwardBufferSeconds(null);
          const hasSelectedAudioTrack = viewerPickedAudioRef.current !== null;

          // Multi-audio builds its own master from the server's transcodes and cannot retag their
          // init segments, so an HDR source takes the single-track path through the shim instead.
          // A track the viewer chose does not narrow it: the stream carries every track and the
          // choice is re-applied by position on its first report (planAudioReport).
          const useMultiAudio = serverLaneCarriesEveryTrack({ live: isLiveRef.current, hdrSource, loaderAvailable: isMultiAudioAvailable(), multiTrack: shouldUseMultiAudio(details) });

          if (useMultiAudio) {
            // Use multi-audio loader for seamless track switching
            logger.info("🎵 Using multi-audio custom protocol (seamless switching enabled)", {
              service: "useVideoPlayback",
              audioTrackCount: getAudioTracks(details).length,
            });

            // Base transcoding URL for the multi-audio custom protocol. It MUST match what 1.6.0
            // sent (which switches audio correctly): no PlaySessionId and no burn-in params.
            //  - playSessionId: the native module appends its OWN unique PlaySessionId per audio
            //    track (MultiAudioResourceLoader.swift) to force a separate transcode session per
            //    track, that's what makes seamless switching work. A fixed PlaySessionId in the
            //    base URL overrides the per-track ones and collapses every track into one session
            //    (this is what regressed after server-side resume added PlaySessionId here).
            //  - burn-in: SubtitleMethod=Encode ties the transcode to one audio track; keep it off
            //    the shared multi-audio base URL so subtitles can never affect audio switching.
            // The preset is the one the single-track branch opens at: a hand-over from a starved
            // engine enters at what the measured link carries, not at the viewer's ceiling.
            const baseUrl = await getTranscodingStreamUrl(videoId, details, undefined, undefined, undefined, undefined, await resolveTranscodePreset(), await videoDecodeSupport());

            // Then prepare multi-audio playback with custom protocol
            const cachedConfig = await getConfig();

            url = await prepareMultiAudioPlayback(videoId, details, baseUrl, cachedConfig.apiKey);

            isUsingMultiAudioRef.current = true;
            // The multi-audio base URL is contract-frozen (see above): no adaptive
            // controller on these sessions.
            adaptiveRef.current = null;
            adaptiveOverrideIndexRef.current = null;
          } else {
            // Regular transcoding. The reporting ref always carries the Jellyfin stream index;
            // selectedAudioTrackIndexRef holds AVPlayer's positional index after an auto-load,
            // which as AudioStreamIndex would point at the wrong stream (0 is video).
            const audioStreamIndex = audioStreamIndexForReportingRef.current ?? undefined;
            // A live channel plays the URL the server opened it with; nothing here is ours to steer.
            url =
              isLiveRef.current && details.liveTranscodeUrl
                ? details.liveTranscodeUrl
                : await viaShim(
                    await getTranscodingStreamUrl(
                      videoId,
                      details,
                      audioStreamIndex,
                      undefined,
                      burnInSubtitleIndexRef.current ?? undefined,
                      playSessionIdRef.current,
                      await resolveTranscodePreset(),
                      await videoDecodeSupport(),
                    ),
                  );

            isUsingMultiAudioRef.current = false;

            if (hasSelectedAudioTrack) {
              logger.info("🎯 Using single-track Jellyfin URL after restart", {
                service: "useVideoPlayback",
                audioStreamIndex,
              });
            }
          }
        } else if (mode === "localRemux") {
          // Rewrap on device and play the loopback HLS URL. A failure here is
          // not fatal: fall through to the server transcode the file would
          // have used anyway.
          isUsingMultiAudioRef.current = false;
          // The engine carries the original bits, no adaptive controller.
          adaptiveRef.current = null;
          adaptiveOverrideIndexRef.current = null;
          // Each half is its own function: a try block that holds a conditional or an optional
          // chain is not lowerable, and one there costs the whole hook its memoization.
          // False means this attempt is over (stale, or the error was already dispatched).
          const openEngineLane = async (): Promise<boolean> => {
            // The playing track's Jellyfin index must reach the remux engine:
            // it orders the HLS renditions so that track is DEFAULT=YES. In-
            // playback switches are seamless (AVPlayer swaps renditions, no
            // rebuild), this matters for rebuilds (error recovery, seek
            // recovery), which would otherwise revert to Jellyfin's default.
            // A pending resume/seek rides into the session as EXT-X-START:
            // AVPlayer opens at the offset and its first request restarts the
            // producer there. The producer opens at segment 0 regardless, which
            // is what sets the session's timeline anchor. Consumed only on
            // success, so the transcode fallback below still sees the position.
            const engineOffset = seekToPositionAfterLoadRef.current;
            const adopted = adoptedLiveRef.current;
            adoptedLiveRef.current = null;
            if (adopted && adopted.videoId !== videoId) void stopLocalRemux(adopted.token);
            if (adopted && adopted.videoId === videoId && adopted.ready) {
              // Already cutting segments: no start, no pre-flight, the player binds it now.
              url = adopted.url;
              localRemuxTokenRef.current = adopted.token;
              logger.info("Live channel bound to its hot ring session", { service: "useVideoPlayback", videoId });
            } else {
              if (adopted && adopted.videoId === videoId) {
                // Still cutting its first segments: its head start is kept and it is timed like a fresh one.
                url = adopted.url;
                logger.info("Live channel bound to its warming ring session", { service: "useVideoPlayback", videoId });
              } else {
                setPlaybackStage("engine");
                url = await startLocalRemux(details, audioStreamIndexForReportingRef.current ?? undefined, engineOffset ?? undefined);
                if (requestIdRef.current !== currentRequestId) {
                  // Stale since the await: a session nobody will play, stopped here instead of at the cap.
                  stopLocalRemux(localRemuxToken(url));
                  return false;
                }
              }
              if (!(await runEnginePreflight(url))) return false;
            }
            liveSessionUrlRef.current = isLiveRef.current ? url : null;
            if (isLiveRef.current) {
              // The tracks the engine found on the open input, in the order its master lists them.
              const discovered = await liveSubtitleRenditions(localRemuxTokenRef.current);
              if (requestIdRef.current !== currentRequestId) return false;
              if (discovered) subtitleRenditionsRef.current = discovered;
            }
            if (engineOffset != null && engineOffset > 0) {
              seekToPositionAfterLoadRef.current = null;
              currentTimeRef.current = engineOffset;
              logger.info("Engine session opens at the resume point", { service: "useVideoPlayback", offsetSeconds: Math.round(engineOffset) });
            }
            // The master carries the on-device copy and every server rung, and AVPlayer switches
            // between them itself. What it cannot know is the link behind the loopback, which it
            // measures as 127.0.0.1: without a ceiling it commits to a variant the link cannot
            // deliver and stalls between attempts (drill S3). So the engine's measured link becomes
            // the cap, and a viewer's fixed pin outranks it.
            if (!isLiveRef.current && slipstreamEligible(details) && !playsFromDisk(videoId)) {
              const quality = await getQualitySettings();
              const pinned = gatewayMaxBitRate(quality);
              pinnedCapRef.current = pinned ?? null;
              linkCapRef.current = 0;
              onTierLaneRef.current = true;
              setVideoMaxBitRate(pinned ?? null);
            } else {
              pinnedCapRef.current = null;
              linkCapRef.current = 0;
              capFloorRef.current = 0;
              onTierLaneRef.current = false;
              setVideoMaxBitRate(null);
            }
            return true;
          };

          const engineFallback = async (remuxError: unknown): Promise<boolean> => {
            // A run the viewer already left: its session is torn down, and every ref below belongs
            // to the item that replaced it.
            if (requestIdRef.current !== currentRequestId) return false;
            const liveServerUrl = isLiveRef.current ? await openLiveServerRung() : null;
            if (requestIdRef.current !== currentRequestId) return false;
            if (liveServerUrl) {
              // The server's transcode is the rung below the engine; its open stays held for it.
              liveLaneRef.current = "server";
              setPlaybackStage("server");
              logger.warn("Live channel failed on the engine, taking the server's transcode", remuxError, { service: "useVideoPlayback", videoId });
              probeEmit("fallback", { from: "localRemux", to: "transcode", reason: remuxError instanceof Error ? remuxError.message : String(remuxError) });
              currentModeRef.current = "transcode";
              hasTriedTranscodingRef.current = true;
              setHasTriedTranscoding(true);
              isUsingMultiAudioRef.current = false;
              adaptiveRef.current = null;
              adaptiveOverrideIndexRef.current = null;
              setVideoMaxBitRate(null);
              url = liveServerUrl;
            } else if (isLiveRef.current) {
              // No rung below the engine: a channel it could not open at all (a DRM'd origin, a
              // dead feed) fails the same way on a second open, so this is the error.
              logger.error("Live channel failed on the engine", remuxError, { service: "useVideoPlayback", videoId });
              probeEmit("error", { mode: "localRemux", message: remuxError instanceof Error ? remuxError.message : String(remuxError), willRetry: false });
              void closeLiveStream(liveStreamIdRef.current);
              liveStreamIdRef.current = null;
              dispatch({
                type: "PLAYER_ERROR",
                error: { message: getPlaybackErrorMessage(classifyPlaybackError(remuxError)) },
                mode: "localRemux",
                hasTriedTranscode: true,
              });
              return false;
            } else if (remuxError instanceof EngineInputMissingError) {
              // The server has no file at the path; the transcode lane would read the same path.
              logger.error("The server could not find the file", remuxError, { service: "useVideoPlayback", videoId });
              probeEmit("error", { mode: "localRemux", message: remuxError.message, willRetry: false });
              dispatch({
                type: "PLAYER_ERROR",
                error: { message: getPlaybackErrorMessage(PlaybackErrorType.NOT_FOUND) },
                mode: "direct",
                hasTriedTranscode: true,
              });
              return false;
            } else {
              // A session that never opened, which the pre-flight throw above reaches too. For a
              // file already on this device that is not a reason to ask a server for it: AVPlayer
              // opens the file, and the subtitles the engine would have carried are what the
              // replay costs.
              const heldReplay = playsFromDisk(videoId);
              logger.warn(heldReplay ? "Engine session failed, replaying the held file from its disk" : "Local remux failed, falling back to server transcode", remuxError, {
                service: "useVideoPlayback",
                videoId,
              });
              probeEmit("fallback", { from: "localRemux", to: heldReplay ? "direct" : "transcode", reason: remuxError instanceof Error ? remuxError.message : String(remuxError) });
              setPlaybackStage(heldReplay ? "player" : "server");
              if (heldReplay) {
                heldEngineSpentRef.current = true;
                currentModeRef.current = "direct";
                isUsingMultiAudioRef.current = false;
                adaptiveRef.current = null;
                adaptiveOverrideIndexRef.current = null;
                setVideoMaxBitRate(null);
                url = getVideoStreamUrl(videoId, details);
              } else {
                currentModeRef.current = "transcode";
                hasTriedTranscodingRef.current = true;
                setHasTriedTranscoding(true);
                url = await viaShim(
                  await getTranscodingStreamUrl(videoId, details, undefined, undefined, undefined, playSessionIdRef.current, await resolveTranscodePreset(), await videoDecodeSupport()),
                );
              }
            }
            return true;
          };

          let carryOn = true;
          try {
            carryOn = await openEngineLane();
          } catch (remuxError) {
            carryOn = await engineFallback(remuxError);
          }
          if (!carryOn) return;
        } else {
          // Direct play
          url = getVideoStreamUrl(videoId, details);

          isUsingMultiAudioRef.current = false;
          adaptiveRef.current = null;
          adaptiveOverrideIndexRef.current = null;
          setVideoMaxBitRate(null);
        }

        // The on-device frame grabber never runs during playback: it steals the throttled link
        // from the stream. Player chapters use the server's pre-extracted images only; frame
        // grabbing is the browsing cards' alone.

        // Check if this response is stale (videoId changed while fetching)
        if (requestIdRef.current !== currentRequestId) {
          logger.debug("Ignoring stale stream URL response", { service: "useVideoPlayback" });
          return;
        }

        logger.info("Stream URL generated", {
          service: "useVideoPlayback",
          mode: mode.toUpperCase(),
          streamType: url.includes(".m3u8") ? "HLS" : "Direct",
          // Distinct facts: how many tracks are being served, and whether the
          // server-side custom-protocol path is the one serving them. Reporting
          // only the latter as "isMultiAudio" read as false for local remux
          // even when it was serving several tracks.
          audioTrackCount: details ? getAudioTracks(details).length : 0,
          multiAudioProtocol: url.includes("jellyfin-multi://"),
        });

        if (!url) fail("Failed to generate stream URL");

        setPlaybackStage("player");
        streamGenerationRef.current += 1;
        setStreamUrl(url);
        // Captured here rather than at load: every path that resumes (first play,
        // audio-switch restart, seek recovery) sets the ref before this line.
        setStartPositionMs(IS_MAC && seekToPositionAfterLoadRef.current ? seekToPositionAfterLoadRef.current * 1000 : null);
        probeEmit("stream", { mode: currentModeRef.current, url });
        dispatch({ type: "STREAM_CREATED", streamUrl: url });

        // Both HLS paths expose several audio tracks to the player, so both need
        // the index mapping below. Local remux was previously excluded, leaving
        // the mapping empty: switching audio then warned and reported no
        // AudioStreamIndex to the server, so its session view showed the wrong
        // track.
        if ((mode === "transcode" || mode === "localRemux") && details) {
          const subtitles = getTextSubtitleStreams(details);
          const audioTracks = getAudioTracks(details);

          // The mapping must match the order handed to the native side (prepareMultiAudioPlayback
          // for transcode, startLocalRemux for the engine), or the next switch targets the wrong
          // stream.
          if (details.MediaStreams && audioTracks.length > 0) {
            audioTrackMappingRef.current = orderAudioTracks(audioTracks, mode === "localRemux" ? audioStreamIndexForReportingRef.current : null);
            // First report of a fresh session: the default track at position 0 is what plays.
            if (audioStreamIndexForReportingRef.current === null) {
              audioStreamIndexForReportingRef.current = audioTrackMappingRef.current[0] ?? null;
            }
            logger.debug("Built audio track mapping", { service: "useVideoPlayback", mapping: audioTrackMappingRef.current });
          }

          if (subtitles.length > 0 || audioTracks.length > 0) {
            logger.debug("Available tracks in HLS stream", {
              service: "useVideoPlayback",
              subtitleCount: subtitles.length,
              audioTrackCount: audioTracks.length,
              subtitleLanguages: subtitles.map((s) => s.Language || "und").join(", "),
              audioLanguages: audioTracks.map((a) => a.Language).join(", "),
            });
          }
        }
      };

      const failed = (error: unknown) => {
        // Check for stale response before dispatching error
        if (requestIdRef.current !== currentRequestId) {
          return;
        }

        logger.error("Error generating stream URL", error, { service: "useVideoPlayback" });

        dispatch({
          type: "PLAYER_ERROR",
          error: {
            message: "Failed to create video stream. Please check your settings.",
          },
          mode,
          hasTriedTranscode: hasTriedTranscodingRef.current,
        });
      };

      try {
        await buildStream();
      } catch (error) {
        failed(error);
      }
    };

    generateStreamUrl();
    // The flag is read from its ref, never taken as a dependency: the fallback path
    // above sets it mid-run and a dependency here re-entered this effect on top of
    // itself. `state` is what legitimately re-runs it, the retry dispatches RETRY.
  }, [state, videoId, handOverToServer, restartAtPlayhead]);

  /**
   * Step 3: Create video ref for Video component
   */
  const videoRef = useRef<VideoRef>(null);

  // Server playback reporting (Sessions/Playing*), decoupled from playback state machine
  const { markStarted, markEnded, reportPauseChange, resetSession } = usePlaybackReporter({
    videoId,
    videoRef,
    durationRef,
    mediaSourceIdRef,
    playSessionIdRef,
    isPlayingRef,
    currentModeRef,
    audioStreamIndexRef: audioStreamIndexForReportingRef,
    wasPlayedAtStartRef,
    positionSecondsRef: currentTimeRef,
    pendingSeekTargetRef,
    isLiveRef,
    liveStreamIdRef,
  });
  // Synced post-commit; safe because every reader (stream-rotation effect,
  // unmount cleanup) runs at least one commit after mount, and CREATING_STREAM
  // is never the first committed state.
  useEffect(() => {
    resetPlaybackSessionRef.current = resetSession;
  }, [resetSession]);

  /**
   * Step 5: Video event callbacks (replacing player.addListener calls)
   */

  // Callback: Video loaded and ready
  const onLoad = useCallback(
    (data: OnLoadData) => {
      if (!isMountedRef.current) return;

      durationRef.current = data.duration;

      logger.debug("Player loaded and ready", {
        service: "useVideoPlayback",
        duration: data.duration,
      });

      // Startup grace for the adaptive lane: AVPlayer's initial buffering edge
      // is expected filling, not link failure, and without this it reaches the
      // stall path and down-switches within the first second. Resumes used to
      // get this for free from the auto-seek's "seeked" event; the playlist
      // shim consumes that seek, so the grace is armed here for every
      // adaptive session instead.
      if (adaptiveRef.current && currentModeRef.current === "transcode") {
        adaptiveRef.current = advanceAdaptive(adaptiveRef.current, { kind: "seeked", nowMs: Date.now() }).state;
      }
      // Auto-seek to saved position if this is a restart (audio track switch)
      const seekPosition = seekToPositionAfterLoadRef.current;
      if (seekPosition !== null && seekPosition > 0) {
        logger.info("⏩ Auto-seeking to saved position", {
          service: "useVideoPlayback",
          position: seekPosition,
        });

        // Small delay to ensure player is ready for seek. Tracked + mount-guarded like
        // autoPlayTimerRef: an orphaned firing after unmount would markStarted() and POST
        // a Playing report the cleanup's Stopped already closed out.
        if (seekTimerRef.current) {
          clearTimeout(seekTimerRef.current);
        }
        seekTimerRef.current = setTimeout(() => {
          seekTimerRef.current = null;
          if (!isMountedRef.current) return;
          // On a Mac the source's startPosition already did this at item-ready.
          // Seeking again after the first frame is decoded leaves the video render
          // chain torn down and never rebuilt: audio and the clock resume, the
          // picture never does.
          if (!IS_MAC) {
            pendingSeekTargetRef.current = seekPosition; // Mute reporter sampling until the seek settles
            videoRef.current?.seek(seekPosition);
          }
          seekToPositionAfterLoadRef.current = null; // Clear after use

          // In a SyncPlay group the player stays paused until the server's Unpause: report
          // Ready from this position instead of resuming, or we play ahead of the group.
          if (syncPlayManager.wantsPausedStart(videoId)) {
            syncPlayManager.notePlayerReady(videoId, seekPosition);
          } else {
            setPaused(false);
          }
          markStarted(seekPosition * JELLYFIN_TIME.TICKS_PER_SECOND);

          // Re-enables multi-audio: the viewer can switch again after the restart.
          selectedAudioTrackIndexRef.current = null;

          logger.info("Auto-seek complete, playback resumed", {
            service: "useVideoPlayback",
            position: seekPosition,
          });
        }, 100);
      }

      // Deferred one tick, NOT hopped to another thread: this runs inside a native
      // callback, and dispatching synchronously there re-enters render from it.
      // (RN 0.85's InteractionManager, which this replaced, was already a
      // setImmediate stub, it never moved work off the JS thread either.)
      setPlaybackStage("buffering");
      setImmediate(() => {
        if (!isMountedRef.current) return;
        dispatch({ type: "PLAYER_READY" });
      });

      // Auto-play on first load
      if (!autoPlayTriggeredRef.current && isMountedRef.current) {
        logger.debug("Scheduling auto-play", { service: "useVideoPlayback" });

        // Clear any existing timer
        if (autoPlayTimerRef.current) {
          clearTimeout(autoPlayTimerRef.current);
        }

        // Timer then a tick, so play() lands clear of the load callback it was queued from.
        autoPlayTimerRef.current = setTimeout(() => {
          if (!isMountedRef.current) {
            logger.debug("Component unmounted, skipping auto-play", { service: "useVideoPlayback" });
            return;
          }

          setImmediate(() => {
            if (!isMountedRef.current) return;

            try {
              logger.debug("Auto-playing video", { service: "useVideoPlayback" });
              // In a group the player holds paused for the handshake; report Ready instead.
              if (syncPlayManager.wantsPausedStart(videoId)) {
                syncPlayManager.notePlayerReady(videoId, currentTimeRef.current);
              } else {
                setPaused(false);
              }
              // Report Playing at the current position (0 for a fresh start; transcode
              // resume streams start their own timeline at the offset). Idempotent if
              // the resume-seek path already registered the session.
              markStarted(Math.round(currentTimeRef.current * JELLYFIN_TIME.TICKS_PER_SECOND));
              // Only mark as triggered after successful play
              autoPlayTriggeredRef.current = true;
            } catch (error) {
              logger.error("Error auto-playing", error, { service: "useVideoPlayback" });
              // Deferred a tick, same reason as the PLAYER_READY dispatch above.
              setImmediate(() => {
                if (!isMountedRef.current) return;
                dispatch({
                  type: "PLAYER_ERROR",
                  error: {
                    message: "Failed to start video playback. The video file may be corrupted or incompatible.",
                  },
                  mode: currentModeRef.current,
                  hasTriedTranscode: hasTriedTranscoding,
                });
              });
            }
          });

          autoPlayTimerRef.current = null;
        }, 100);
      }
    },
    [hasTriedTranscoding, markStarted, videoId],
  );

  // Callback: Video progress update
  // Apply an adaptive controller verdict: rebuild the transcode session at the
  // target preset, resuming at the playhead, same restart mechanics as the
  // audio switch and seek recovery.
  const applyAdaptiveSwitch = useCallback(
    (targetIndex: number) => {
      if (currentModeRef.current !== "transcode" || !isMountedRef.current) return;
      logger.info("Adaptive quality switch", {
        service: "useVideoPlayback",
        to: QUALITY_PRESETS[targetIndex].label,
        position: Math.round(currentTimeRef.current),
      });
      probeEmit("qualitySwitch", { to: QUALITY_PRESETS[targetIndex].label });
      adaptiveOverrideIndexRef.current = targetIndex;
      restartAtPlayhead(currentTimeRef.current);
    },
    [restartAtPlayhead],
  );

  const onProgress = useCallback(
    (data: OnProgressData) => {
      if (!isMountedRef.current) return;

      // Only the item that has a player may report. Earlier states have no stream
      // URL, so a tick there is the previous player's, and it would consume the
      // edge below that is the only thing dispatching PLAYER_PLAYING.
      if (state.type !== "INITIALIZING_PLAYER" && state.type !== "READY" && state.type !== "PLAYING") return;

      currentTimeRef.current = data.currentTime;
      syncPlayManager.notePosition(data.currentTime);
      probeProgress(data.currentTime);

      // A playhead advance disarms the direct-lane stall watchdog (safety
      // for a missed isBuffering:false edge).
      if (stallWatchRef.current != null && data.currentTime > stallWatchRef.current.pos + PLAYHEAD_EPSILON_SEC) {
        clearTimeout(stallWatchRef.current.timer);
        stallWatchRef.current = null;
      }

      // Adaptive quality (transcode lane): buffer occupancy is the control
      // signal (playableDuration - playhead); the pure controller decides.
      if (adaptiveRef.current && currentModeRef.current === "transcode" && state.type === "PLAYING") {
        const occupancySec = Math.max(0, (data.playableDuration ?? 0) - data.currentTime);
        const nowMs = Date.now();
        const result = advanceAdaptive(adaptiveRef.current, { kind: "tick", occupancySec, nowMs });
        adaptiveRef.current = result.state;
        if (result.switchTo != null) {
          applyAdaptiveSwitch(result.switchTo);
        } else if (shouldProbeThroughput(result.state, occupancySec, nowMs)) {
          // A healthy buffer keeps the probe off a struggling stream, but
          // AVPlayer still tops up its forward buffer, so the reading bounds
          // the LEFTOVER bandwidth, it feeds the step-up decision and never
          // the per-server routing memory.
          adaptiveRef.current = markProbeStarted(result.state, nowMs);
          measureServerBitrate({ remember: false }).then((bps) => {
            if (bps != null && adaptiveRef.current && isMountedRef.current) {
              adaptiveRef.current = advanceAdaptive(adaptiveRef.current, { kind: "throughput", bps, nowMs: Date.now() }).state;
            }
            // Climb back to the on-device copy once the link plainly carries the source. This probe
            // reads the LEFTOVER bandwidth behind the current transcode, so clearing the source rate
            // here means the link has real headroom, not a marginal recovery that would re-stall.
            const climbSourceBps = activeDetailsRef.current?.MediaSources?.[0]?.Bitrate ?? 0;
            if (bps != null && climbSourceBps > 0 && bps >= climbSourceBps && Date.now() >= climbBackAtRef.current && activeDetailsRef.current) {
              climbBackToCopy(activeDetailsRef.current);
            }
          });
        }
      }

      // Update playing state
      const nowPlaying = !paused;
      const wasPlaying = isPlayingRef.current;

      if (nowPlaying !== wasPlaying) {
        isPlayingRef.current = nowPlaying;

        if (nowPlaying) {
          probeFirstPlaying();
          // Video started playing
          if (!hasStablePlaybackRef.current) {
            setImmediate(() => {
              if (!isMountedRef.current) return;
              dispatch({ type: "PLAYER_PLAYING" });
            });

            // Start stable playback detection after video starts playing
            if (stablePlaybackTimerRef.current) {
              clearTimeout(stablePlaybackTimerRef.current);
            }

            stablePlaybackTimerRef.current = setTimeout(() => {
              if (isMountedRef.current && isPlayingRef.current) {
                logger.debug("Stable playback detected, hiding spinner", { service: "useVideoPlayback" });
                hasStablePlaybackRef.current = true;
                resetPlaybackStages();
                // The short forward buffer is a startup device only: once the picture is up
                // AVPlayer goes back to building the deep buffer a link drop is survived on
                // (measured with 6s held: the 30 -> 1.5 Mb/s drop stalled 37s).
                setForwardBufferSeconds(null);
                setImmediate(() => {
                  if (!isMountedRef.current) return;
                  setHasStablePlayback(true);
                });
                stablePlaybackTimerRef.current = null;
              }
            }, 500);
          }
        } else {
          // Video paused or stopped, clear the stable playback timer
          if (stablePlaybackTimerRef.current && !hasStablePlaybackRef.current) {
            clearTimeout(stablePlaybackTimerRef.current);
            stablePlaybackTimerRef.current = null;
          }
        }
      }
    },
    [paused, state.type, applyAdaptiveSwitch, climbBackToCopy],
  );

  // Callback: buffering edge from the player. A stall while the adaptive
  // controller is live is its most urgent down-switch signal.
  const onBuffer = useCallback(
    (data: { isBuffering: boolean }) => {
      if (!isMountedRef.current) return;
      syncPlayManager.noteBuffering(data.isBuffering, currentTimeRef.current);
      // Diagnostics and the ABR drill score stalls from these edges; nothing else emitted them.
      probeEmit("buffering", { on: data.isBuffering, position: Math.round(currentTimeRef.current) });
      // Direct-lane stall watchdog. Buffer-empty is AVPlayer's own starvation
      // signal (isPlaybackBufferEmpty KVO, fires for progressive assets, and
      // a user pause cannot raise it: only the buffer observers write the
      // flag, RCTVideo.swift:1950/1957). A starved direct stream raises no
      // error, and onProgress ticks stop with the playhead, so only a timer
      // armed here can observe the stall. Expiry with the playhead still
      // frozen re-routes through the existing ladder: directPlayFailedRef
      // re-picks the engine, which opens AT the playhead via EXT-X-START.
      if (currentModeRef.current === "direct") {
        if (data.isBuffering && stallWatchRef.current == null) {
          const arm = () => {
            const pos = currentTimeRef.current;
            stallWatchRef.current = {
              pos,
              timer: setTimeout(() => {
                stallWatchRef.current = null;
                if (!isMountedRef.current || currentModeRef.current !== "direct") return;
                // A pause freezes the playhead too: keep watching, never re-route a paused session.
                if (pausedRef.current) {
                  arm();
                  return;
                }
                if (Math.abs(currentTimeRef.current - pos) > PLAYHEAD_EPSILON_SEC) return;
                logger.warn("Direct play stalled without an error, re-routing at the playhead", {
                  service: "useVideoPlayback",
                  position: Math.round(pos),
                });
                probeEmit("fallback", { from: "direct", to: "remux-or-transcode", reason: "silent stall" });
                directPlayFailedRef.current = true;
                restartAtPlayhead(currentTimeRef.current);
              }, DIRECT_STALL_DEADLINE_MS),
            };
          };
          arm();
        } else if (!data.isBuffering && stallWatchRef.current != null) {
          clearTimeout(stallWatchRef.current.timer);
          stallWatchRef.current = null;
        }
        return;
      }
      if (!data.isBuffering) return;
      if (!adaptiveRef.current || currentModeRef.current !== "transcode") return;
      const result = advanceAdaptive(adaptiveRef.current, { kind: "stall", nowMs: Date.now() });
      adaptiveRef.current = result.state;
      if (result.switchTo != null) applyAdaptiveSwitch(result.switchTo);
    },
    [applyAdaptiveSwitch, restartAtPlayhead],
  );

  // Callback: Video playback ended
  const onEnd = useCallback(() => {
    if (!isMountedRef.current) return;

    logger.info("Video playback ended, triggering callback", { service: "useVideoPlayback" });

    probeEmit("ended");

    // Mark video as ended, clears saved progress
    markEnded();

    setImmediate(() => {
      if (!isMountedRef.current) return;
      onPlaybackEndRef.current?.();
    });
  }, [markEnded]);

  // Callback: Video error
  const onError = useCallback(
    (error: OnVideoErrorData) => {
      if (!isMountedRef.current) return;
      // A source this player moved on from (a held or replaced stream) is not the item on screen failing.
      const failedUri = (error as OnVideoErrorData & { uri?: string }).uri;
      if (failedUri && failedUri !== streamUrlRef.current) {
        logger.debug("Ignoring a failure from a source this player moved on from", { service: "useVideoPlayback" });
        return;
      }

      const currentMode = currentModeRef.current;
      // Extract error message from react-native-video error object
      const originalMessage = error.error?.localizedDescription || error.error?.errorString || String(error.error || "");
      const errorType = classifyPlaybackError(error.error);

      if (isLiveRef.current) {
        const { reopen, toServer, retry } = planLiveErrorRecovery({
          mode: currentMode,
          errorType,
          hasReopened: liveReopenedRef.current,
          lane: liveLaneRef.current,
        });
        if (reopen) liveReopenedRef.current = true;
        if (toServer) liveLaneRef.current = "server";
        if (retry) setPlaybackStage("reopening");
        logger.error("Live playback error", error, { service: "useVideoPlayback", lane: currentMode, next: reopen ? "reopen" : toServer ? "server" : "error" });
        probeEmit("error", { mode: currentMode, message: originalMessage, willRetry: retry });
        stopLocalRemux(localRemuxTokenRef.current);
        localRemuxTokenRef.current = null;
        dropThroughputWatch(throughputRef.current);
        void closeLiveStream(liveStreamIdRef.current);
        liveStreamIdRef.current = null;
        const attempt = requestIdRef.current;
        setImmediate(() => {
          if (!isMountedRef.current || requestIdRef.current !== attempt) return;
          dispatch({ type: "PLAYER_ERROR", error: { message: getPlaybackErrorMessage(errorType) }, mode: currentMode, hasTriedTranscode: !retry });
        });
        return;
      }

      // Tier lane: a mid-play starvation stall is the engine primary being unproducible on this
      // link (expected while capped to the tier). The tier is the survival floor and the plain
      // server transcode is a HIGHER bitrate, so a teardown would regress, not recover. Ignore it;
      // the native producer-hold frees the link for the tier and AVPlayer recovers on its own.
      if (onTierLaneRef.current && errorType === PlaybackErrorType.STALLED && currentTimeRef.current > 1) {
        logger.info("Tier-lane starvation stall ignored, the tier is the survival floor", { service: "useVideoPlayback", position: Math.round(currentTimeRef.current) });
        probeEmit("error", { mode: currentMode, message: originalMessage, willRetry: false });
        return;
      }

      // The whole ladder decision is pure (see planErrorRecovery); this callback only applies it.
      const decision = planErrorRecovery({
        mode: currentMode,
        errorType,
        currentTimeSec: currentTimeRef.current,
        hasTriedRemuxRestart: hasTriedRemuxRestartRef.current,
        hasTriedTranscoding,
        hasTriedSeekRecovery,
        hasTriedCredentialRefresh,
        heldOnDisk: playsFromDisk(videoId),
        hasDroppedSubtitles: heldEngineSpentRef.current,
      });
      const { willRetryWithTranscode } = decision;

      if (decision.dropSubtitles) {
        heldEngineSpentRef.current = true;
        logger.info("Engine lane failed for a held file, replaying it from disk without subtitles", { service: "useVideoPlayback" });
      }

      if (decision.stopRemuxSession) {
        // The loopback session is dead; without this the retry path leaked it until unmount.
        stopLocalRemux(localRemuxTokenRef.current);
        localRemuxTokenRef.current = null;
        dropThroughputWatch(throughputRef.current);
      }
      if (decision.carryPositionSec != null) {
        // Resume the next session at the playhead, not the item's original start.
        seekToPositionAfterLoadRef.current = decision.carryPositionSec;
      }
      if (decision.stallFallback) {
        stallFallbackRef.current = true;
      }
      // Mark the fallback as spent up front for a failed local remux.
      // Otherwise the retry re-evaluates the same file, still picks localRemux
      // (nothing has recorded that it failed), and loops on the same error
      // instead of reaching the server.
      if (decision.latchTranscodeUpFront) {
        logger.warn("Local remux errored mid-playback, retrying on the server", {
          service: "useVideoPlayback",
          message: originalMessage,
        });
        hasTriedTranscodingRef.current = true;
        setHasTriedTranscoding(true);
      }

      probeEmit("error", { mode: currentMode, message: originalMessage, willRetry: willRetryWithTranscode });

      logger.debug("Error classified", {
        service: "useVideoPlayback",
        errorType,
        willRetryWithTranscode,
        hasTriedCredentialRefresh,
      });

      // One engine restart for a mid-playback starvation: the file was playing fine,
      // the feed stalled, a fresh session at the playhead beats a server transcode.
      if (decision.action.kind === "restartRemux") {
        logger.info("Local remux starved mid-playback, restarting the engine at the playhead", {
          service: "useVideoPlayback",
          position: decision.carryPositionSec,
        });
        hasTriedRemuxRestartRef.current = true;
        probeEmit("engineRestart", { position: decision.carryPositionSec });
        // hasTriedTranscoding is still false, so the metadata fetch re-picks the engine.
        restartAtPlayhead();
        return;
      }

      if (decision.action.kind === "refreshCredentials") {
        logger.info("Authentication error detected, attempting to refresh demo credentials", {
          service: "useVideoPlayback",
          error: originalMessage,
        });

        // Try to refresh demo credentials and retry playback
        (async () => {
          try {
            const inDemoMode = await isDemoMode();
            if (inDemoMode) {
              logger.info("Reconnecting to demo server for fresh credentials", {
                service: "useVideoPlayback",
              });

              // Pass false to preserve folder navigation and library state
              await connectToDemoServer(false);
              await refreshConfig();

              logger.info("Demo credentials refreshed, retrying playback", {
                service: "useVideoPlayback",
              });

              // Mark that we tried credential refresh
              setHasTriedCredentialRefresh(true);

              // Retry playback by resetting state
              setImmediate(() => {
                if (!isMountedRef.current) return;
                dispatch({ type: "RETRY" });
              });

              return;
            }
          } catch (error) {
            logger.error("Failed to refresh demo credentials", error, {
              service: "useVideoPlayback",
            });
          }

          // If not in demo mode or refresh failed, show the error
          const errorMessage = getPlaybackErrorMessage(errorType);
          setImmediate(() => {
            if (!isMountedRef.current) return;
            dispatch({
              type: "PLAYER_ERROR",
              error: { message: errorMessage },
              mode: currentMode,
              hasTriedTranscode: hasTriedTranscoding,
            });
          });
        })();

        return;
      }

      // Seek recovery: when a transcode stream crashes mid-playback (e.g. seek to non-keyframe),
      // restart the transcode session from the last known position (carryPositionSec was
      // already written to seekToPositionAfterLoadRef above). Limited to 1 attempt.
      if (decision.action.kind === "transcodeSeekRecovery") {
        logger.info("Seek crash detected during transcode, attempting recovery", {
          service: "useVideoPlayback",
          lastPositionSec: decision.carryPositionSec,
        });

        setHasTriedSeekRecovery(true);
        restartAtPlayhead();
        return;
      }

      // Log at INFO level if we'll auto-retry, ERROR level if this is a real failure
      if (willRetryWithTranscode) {
        logger.info("Direct play failed, will retry with transcoding", error, { service: "useVideoPlayback" });
      } else {
        logger.error("Playback error", error, { service: "useVideoPlayback" });
      }

      const errorMessage = getPlaybackErrorMessage(errorType);

      // Deferred a tick: onError arrives from a native callback.
      const attempt = requestIdRef.current;
      setImmediate(() => {
        if (!isMountedRef.current || requestIdRef.current !== attempt) return;
        dispatch({
          type: "PLAYER_ERROR",
          error: { message: errorMessage },
          mode: currentMode,
          hasTriedTranscode: hasTriedTranscoding,
        });
      });
    },
    [videoId, hasTriedTranscoding, hasTriedCredentialRefresh, hasTriedSeekRecovery, restartAtPlayhead],
  );

  // Callback: Audio tracks discovered from HLS manifest
  const onAudioTracks = useCallback(
    (data: { audioTracks: AudioTrack[] }) => {
      if (!isMountedRef.current) return;

      const selected = data.audioTracks.find((track) => track.selected);
      const signature = `${data.audioTracks.length}:${selected?.index ?? -1}`;
      if (signature !== lastLoggedAudioTracksRef.current) {
        lastLoggedAudioTracksRef.current = signature;
        // The count AVPlayer actually offers, so a drill can see a variant switch drop a track.
        probeEmit("tracks", { audio: data.audioTracks.length, selected: selected?.index ?? -1 });
        logger.debug("Audio tracks", { service: "useVideoPlayback", count: data.audioTracks.length, selected: selected?.index });
      }

      const freshManifest = isFreshManifestReport(data.audioTracks.length, audioReportGenerationRef.current, streamGenerationRef.current);
      if (data.audioTracks.length > 0) audioReportGenerationRef.current = streamGenerationRef.current;
      const plan = planAudioReport({
        tracks: data.audioTracks,
        mapping: audioTrackMappingRef.current,
        viewerPickedStreamIndex: viewerPickedAudioRef.current,
        lastSelectedIndex: selectedAudioTrackIndexRef.current,
        freshManifest,
        stablePlayback: hasStablePlaybackRef.current,
        // Both seamless lanes serve every track as a rendition, so AVPlayer has already switched.
        seamless: isUsingMultiAudioRef.current || currentModeRef.current === "localRemux",
      });

      if (plan.reapplyPosition !== null) {
        // Cast as for selectedTextTrack below: the lib's `type` is a string enum the tests cannot import.
        setSelectedAudioTrack({ type: "index", value: String(plan.reapplyPosition) } as SelectedTrack);
      }
      if (plan.unmapped) {
        logger.warn("Could not map audio track index to a Jellyfin stream index", {
          service: "useVideoPlayback",
          trackIndex: selected?.index,
          mappingSize: audioTrackMappingRef.current.length,
        });
      }
      if (plan.recordStreamIndex !== null) {
        // AVPlayer already swapped renditions; record the stream so server reports and any
        // later engine rebuild carry the track that is actually playing.
        audioStreamIndexForReportingRef.current = plan.recordStreamIndex;
        viewerPickedAudioRef.current = plan.recordStreamIndex;
        logger.info("Audio track switched seamlessly", { service: "useVideoPlayback", jellyfinStreamIndex: plan.recordStreamIndex });
      }
      if (plan.setLastSelectedIndex !== null) selectedAudioTrackIndexRef.current = plan.setLastSelectedIndex;
      if (plan.restartStreamIndex !== null) {
        logger.info("Audio track changed by the viewer, restarting", { service: "useVideoPlayback", jellyfinStreamIndex: plan.restartStreamIndex });
        handleAudioTrackSwitch(plan.restartStreamIndex);
      }
    },
    [handleAudioTrackSwitch],
  );

  // Callback: Text tracks (subtitles) discovered
  // Identity changes only when the applied preference does, which is once per
  // item. Cast because the lib types `type` as SelectedTrackType, a string ENUM
  // a plain literal cannot satisfy, and importing the enum for real would break
  // every hook test: jest.setup.js replaces react-native-video with a bare
  // forwardRef that has no named exports. The member values are these strings.
  const selectedTextTrack = useMemo(() => selectedTextTrackFor(appliedSubtitlePreference) as SelectedTrack, [appliedSubtitlePreference]);

  // When a report last said nothing is selected; a live subtitle request older than that is stale.
  const lastSubtitleDeselectAtRef = useRef(0);

  const onTextTracks = useCallback(
    (data: { textTracks: TextTrack[] }) => {
      if (!isMountedRef.current) return;

      // RNV's handleTracksChange discards its AVPlayerItem and re-reads _player in
      // an unordered Task, so a report can describe the previous item. Direct play
      // has no manifest, so a file with no subtitle stream cannot have a legible
      // track: that payload is stale. Not applied to the server lane, where
      // Jellyfin's undeclared CLOSED-CAPTIONS makes AVKit draw a real phantom.
      if (currentModeRef.current === "direct" && !itemHasSubtitleStreamsRef.current && data.textTracks.length > 0) {
        return;
      }

      // An image rendition carries no cues, so the viewer's pick is the only signal for which
      // bitmaps to draw. Resolved on the engine's lane alone: the server's legible group is
      // Jellyfin's, so the counts legitimately differ and there are no bitmaps to draw anyway.
      const onEngineLane = currentModeRef.current === "localRemux";
      const renditions = onEngineLane ? subtitleRenditionsRef.current : [];
      // A repackaged download carries each bitmap track as an empty tx3g track, so the player
      // lists and reports it like any other; the manifest says which source stream that
      // position was, and the overlay draws the sets decoded beside the file.
      const heldOrdinal = onEngineLane ? null : (data.textTracks.find((track) => track.selected === true)?.index ?? null);
      const pick = onEngineLane
        ? resolveSubtitlePick(renditions, data.textTracks)
        : {
            imageStreamIndex: heldOrdinal === null ? null : heldImageSubtitleForOrdinal(videoId, heldOrdinal),
            rendition: null,
            ordinal: heldOrdinal,
          };
      setActiveImageSubtitleStream((current) => (current === pick.imageStreamIndex ? current : pick.imageStreamIndex));
      // Deselecting does change the item's tracks (measured), so this report is the live deselect.
      if (onEngineLane && isLiveRef.current && !data.textTracks.some((track) => track.selected === true)) lastSubtitleDeselectAtRef.current = Date.now();

      // Deduplicate on the SELECTION, not just the count. The count alone never
      // changes once the tracks load, so a selection made in AVKit's own picker
      // was invisible here.
      const trackSignature = `${data.textTracks.length}:${pick.ordinal ?? "none"}:${pick.reason ?? ""}`;
      if (trackSignature !== lastLoggedTextTracksRef.current) {
        lastLoggedTextTracksRef.current = trackSignature;
        const selected = data.textTracks.find((track) => track.selected);
        const detail = {
          service: "useVideoPlayback",
          count: data.textTracks.length,
          published: renditions.length,
          selected: selected ? { index: selected.index, title: selected.title, language: selected.language } : null,
          imageStreamIndex: pick.imageStreamIndex,
          // AVFoundation preserving master playlist order in its legible group is
          // undocumented, and the ordinal mapping rests on it. Logging the label
          // we published against the one AVKit reports is what confirms it on a
          // real device: a mismatch means the order is not preserved and identity
          // has to come from the rendition URI the engine is asked for instead.
          resolved: pick.rendition ? { ordinal: pick.ordinal, streamIndex: pick.rendition.index, published: pick.rendition.name, reported: selected?.title } : null,
          tracks: data.textTracks.map((track) => ({ index: track.index, title: track.title, selected: track.selected === true })),
        };
        // A refusal is not a debug detail: the viewer asked for subtitles and is
        // getting none, and the reason is the only thing that says why.
        if (pick.reason) logger.warn(`📝 Subtitles: refusing to draw, ${pick.reason}`, detail);
        else logger.debug("📝 Subtitles", detail);
      }

      // Languages this item actually offers, for the effect that selects a track, it has
      // no report of its own to read. ABOVE the refusal bail: a pick that cannot be
      // resolved to an image stream says nothing about which languages exist, and
      // recording them under it left that effect permanently blind on a refusal.
      const languages = data.textTracks.map((track) => track.language || "und");
      setTextTrackLanguages((current) => (current.length === languages.length && current.every((tag, at) => tag === languages[at]) ? current : languages));

      // Remember what the viewer settled on, so the next item opens the same way.
      // AVKit owns the picker, so this report is the only signal there is.
      //
      // A refused pick could not be read at all, and a report with no signal in it
      // (no tracks, or nothing selected because nothing matched) says nothing
      // either way. observedFromReport draws that line.
      if (pick.reason) return;

      // Selected, but none of ours: one of AVFoundation's phantom options (see resolveSubtitlePick).
      // Storing its language turns subtitles OFF on every later item, since nothing there matches it.
      if (onEngineLane && pick.rendition === null && data.textTracks.some((track) => track.selected === true)) return;

      const observed = observedFromReport({
        tracks: data.textTracks,
        applied: appliedSubtitlePreferenceRef.current,
        // The engine's rendition carries Jellyfin's language, which beats whatever
        // AVFoundation inferred for the same track.
        renditionLanguage: pick.rendition?.language,
      });
      if (!observed) return;
      lastObservedSubtitleRef.current = observed;

      // Starting an item moves the selection by itself: the preference is applied,
      // the auto-seek re-resolves the legible group, the engine restarts its
      // pipeline. A viewer cannot reach the picker before playback is stable, so
      // anything earlier is the player talking to itself.
      if (!hasStablePlaybackRef.current) return;

      // And let it settle. Each report restarts the timer, so a burst only ever
      // persists what it lands on. Device log 2026-08-13: a track was reported
      // selected at 19:51:59.415 and deselected at .432 with nobody touching the
      // remote, and an earlier version of this stored that as "off".
      if (subtitleCaptureTimerRef.current) clearTimeout(subtitleCaptureTimerRef.current);
      subtitleCaptureTimerRef.current = setTimeout(() => {
        subtitleCaptureTimerRef.current = null;
        const settled = lastObservedSubtitleRef.current;
        if (!isMountedRef.current || !settled) return;

        const previous = getSubtitlePreferenceSync();

        if (classifyObservedChoice({ settled, autoApplied: autoAppliedDefaultRef.current }) === "echoOfDefault") {
          logger.debug("📝 Subtitles: not storing the file's own default", { service: "useVideoPlayback", preference: autoAppliedDefaultRef.current });
          return;
        }
        autoAppliedDefaultRef.current = null;

        const updated = nextPreference({ observed: settled, previous, viewerDriven: true, trustworthy: true });
        if (!updated) {
          // Silence here is what made this impossible to diagnose from a device
          // log: the capture was running and deciding nothing, which reads exactly
          // like the capture never running.
          logger.debug("📝 Subtitles: nothing to remember", {
            service: "useVideoPlayback",
            observed: settled.kind === "language" ? settled.tag : settled.kind,
            stored: previous.kind === "language" ? previous.tag : previous.kind,
          });
          return;
        }

        logger.info("📝 Subtitles: remembering the viewer's choice", {
          service: "useVideoPlayback",
          preference: updated.kind === "language" ? updated.tag : updated.kind,
        });
        // Cache and disk only. The prop is NOT updated here: re-applying mid-item
        // would re-run setSelectedTextTrack, and RCTPlayerOperations selects the
        // FIRST option matching the language, so on a file carrying both English
        // and English SDH a pick of the second would snap to the first.
        void saveSubtitlePreference(updated);
      }, SUBTITLE_CAPTURE_SETTLE_MS);
      // videoId: a held file's bitmap tracks are looked up per item, and a queue advance
      // reuses this callback.
    },
    [videoId],
  );

  // Live: selecting a rendition changes no track, so no report above fires for it (measured). AVPlayer
  // asks the engine for a rendition's playlist only while it is selected, so that request is the pick.
  useEffect(() => {
    const token = streamUrl ? localRemuxToken(streamUrl) : null;
    if (!token || !isLiveRef.current || currentModeRef.current !== "localRemux") return;
    return subscribeSubtitleRequests(token, ({ streamIndex, requestedAt }) => {
      if (!isMountedRef.current || requestedAt <= lastSubtitleDeselectAtRef.current) return;
      if (!subtitleRenditionsRef.current.some((rendition) => rendition.index === streamIndex && rendition.isImage)) return;
      setActiveImageSubtitleStream((current) => (current === streamIndex ? current : streamIndex));
    });
  }, [streamUrl]);

  /**
   * Setup and cleanup on mount/unmount
   */
  useEffect(() => {
    // The ref object itself never changes; captured so the cleanup reads it without the lint's DOM-node caveat.
    const throughputWatch = throughputRef.current;
    isMountedRef.current = true;

    return () => {
      isMountedRef.current = false;

      // Clear timers
      if (autoPlayTimerRef.current) {
        clearTimeout(autoPlayTimerRef.current);
        autoPlayTimerRef.current = null;
      }
      if (stablePlaybackTimerRef.current) {
        clearTimeout(stablePlaybackTimerRef.current);
        stablePlaybackTimerRef.current = null;
      }
      if (seekTimerRef.current) {
        clearTimeout(seekTimerRef.current);
        seekTimerRef.current = null;
      }
      if (subtitleCaptureTimerRef.current) {
        clearTimeout(subtitleCaptureTimerRef.current);
        subtitleCaptureTimerRef.current = null;
      }
      // Stop playback on unmount
      setPaused(true);

      // Tear down THIS player's remux session so its pipeline thread and cached
      // segments don't outlive the screen. The token is per-instance: during a
      // screen transition two players are briefly mounted at once, and passing
      // anything shared here would stop the incoming player's session instead.
      // A live channel left while playing stays hot in the ring, so flipping back to it is instant.
      const liveDetails = liveDetailsRef.current;
      const liveToken = localRemuxTokenRef.current;
      const liveUrl = liveSessionUrlRef.current;
      const retained =
        isLiveRef.current &&
        hasStablePlaybackRef.current &&
        liveDetails !== null &&
        liveToken !== null &&
        liveUrl !== null &&
        retainLiveSession({ channelId: liveDetails.Id, details: liveDetails, url: liveUrl, token: liveToken });
      if (!retained) stopLocalRemux(liveToken);
      localRemuxTokenRef.current = null;
      dropThroughputWatch(throughputWatch);
      // The server holds the tuner until every open is closed.
      if (!retained) void closeLiveStream(liveStreamIdRef.current);
      liveStreamIdRef.current = null;
      liveDetailsRef.current = null;
      liveSessionUrlRef.current = null;
      if (adoptedLiveRef.current) {
        void stopLocalRemux(adoptedLiveRef.current.token);
        adoptedLiveRef.current = null;
      }
      isLiveRef.current = false;
      resetPlaybackStages();
      stopFrameProvider(frameProviderTokenRef.current);
      frameProviderTokenRef.current = null;
      stopPlaylistShim(playlistShimTokenRef.current);
      playlistShimTokenRef.current = null;
      if (stallWatchRef.current != null) {
        clearTimeout(stallWatchRef.current.timer);
        stallWatchRef.current = null;
      }
    };
  }, [videoId]);

  /**
   * tvOS chapter pictures the server has none of: the engine lane serves them from its own session
   * directory, every other lane needs a provider over the original file. A grab decodes from the
   * source, so it waits for the player's own PLAYING edge, and on a session with a ladder for a
   * link measured to carry the copy with room: a listed ladder alone says nothing about the link.
   */
  useEffect(() => {
    if (chapterFrameBaseUrl !== null || !Platform.isTV || state.type !== "PLAYING") return;
    if (currentModeRef.current === "transcode") return;
    const laddered = currentModeRef.current === "localRemux" && tierDeclaredFor(localRemuxToken(streamUrl));
    if (laddered && !linkAffordsFrames && !playsFromDisk(videoId)) return;
    if ((videoDetails?.Chapters ?? []).filter((chapter) => !chapter.ImageTag).length < 2) return;
    if (currentModeRef.current === "localRemux") {
      setChapterFrameBaseUrl(sessionBaseUrl(streamUrl));
      return;
    }
    let cancelled = false;
    const details = videoDetails;
    void (async () => {
      if (!details) return;
      const base = await startFrameProvider(getVideoStreamUrl(videoId, details), videoId);
      if (cancelled || !isMountedRef.current) {
        // Stale since the await: this run's provider goes, never one a live run holds.
        void stopFrameProvider(localRemuxToken(base));
        return;
      }
      void stopFrameProvider(frameProviderTokenRef.current);
      frameProviderTokenRef.current = localRemuxToken(base);
      setChapterFrameBaseUrl(base);
    })();
    return () => {
      cancelled = true;
    };
  }, [chapterFrameBaseUrl, linkAffordsFrames, state.type, streamUrl, videoDetails, videoId]);

  /**
   * Reset state when video ID changes
   */
  const resetHasRunRef = useRef(false);
  useEffect(() => {
    // Mount writes every ref and state below the value it already holds, so the only thing
    // the first run produces is a RETRY dispatch onto the IDLE it is already in: two state
    // transitions logged before anything plays. Skipped, since PlayerHost mounts this hook
    // once for the life of the app and every later run is a real item change.
    if (!resetHasRunRef.current) {
      resetHasRunRef.current = true;
      return;
    }
    // Increment request ID to invalidate any in-flight async operations
    requestIdRef.current += 1;

    // Clear any pending timers
    if (autoPlayTimerRef.current) {
      clearTimeout(autoPlayTimerRef.current);
      autoPlayTimerRef.current = null;
    }
    if (stablePlaybackTimerRef.current) {
      clearTimeout(stablePlaybackTimerRef.current);
      stablePlaybackTimerRef.current = null;
    }
    if (seekTimerRef.current) {
      clearTimeout(seekTimerRef.current);
      seekTimerRef.current = null;
    }

    dispatch({ type: "RETRY" });
    // Queue advance (videoId swap without remount) must wipe the old item's
    // state in the same commit, or the new video's first render leaks the
    // previous stream URL and details. Deliberate synchronous cascade.

    setVideoDetails(null);
    setStreamUrl(null);
    hasTriedTranscodingRef.current = false;
    setHasTriedTranscoding(false);
    setHasTriedCredentialRefresh(false);
    setHasTriedSeekRecovery(false);
    hasTriedRemuxRestartRef.current = false;
    liveReopenedRef.current = false;
    liveLaneRef.current = "engine";
    dropThroughputWatch(throughputRef.current);
    // One hand-over per item, like the transcode latch above it.
    throughputRef.current.handedOver = false;
    stallFallbackRef.current = false;
    adaptiveRef.current = null;
    adaptiveOverrideIndexRef.current = null;
    linkCapRef.current = 0;
    pinnedCapRef.current = null;
    capFloorRef.current = 0;
    setForwardBufferSeconds(null);
    if (climbTimerRef.current) clearTimeout(climbTimerRef.current);
    climbTimerRef.current = null;
    onTierLaneRef.current = false;
    stopFrameProvider(frameProviderTokenRef.current);
    frameProviderTokenRef.current = null;
    setChapterFrameBaseUrl(null);
    setLinkAffordsFrames(false);
    setVideoMaxBitRate(null);
    setHasStablePlayback(false);
    hasStablePlaybackRef.current = false;
    // onProgress dispatches PLAYER_PLAYING on the EDGE of this ref, so a stale
    // true from the previous item means the edge never comes: no PLAYER_PLAYING,
    // no stable-playback timer, and the loading spinner sits over audio that is
    // already playing. It used to reset itself because leaving /player unmounted
    // this hook; PlayerHost keeps it mounted for the life of the app so PiP can
    // outlive the route, which makes resetting it here the only thing that does.
    isPlayingRef.current = false;
    autoPlayTriggeredRef.current = false;
    isSeekingRef.current = false;
    lastStatusChangeRef.current = 0;
    // The reporter reads this as its live position source, without the reset a queue
    // advance would stamp the new video's first reports with the previous video's clock.
    currentTimeRef.current = 0;
    currentModeRef.current = "direct";
    seekToPositionAfterLoadRef.current = null;
    pendingSeekTargetRef.current = null;
    mediaSourceIdRef.current = null; // PlaySessionId rotates in the CREATING_STREAM effect
    wasPlayedAtStartRef.current = null; // re-captured on the new video's first metadata fetch
    selectedAudioTrackIndexRef.current = null;
    viewerPickedAudioRef.current = null;
    setSelectedAudioTrack(undefined);
    audioStreamIndexForReportingRef.current = null;
    burnInSubtitleIndexRef.current = null;
    audioTrackMappingRef.current = [];
    isUsingMultiAudioRef.current = false;
    // Per item, like the transcode latch beside it: the next video gets its own
    // three rungs, and a queue advance must not start already spent.
    directPlayFailedRef.current = false;
    heldEngineSpentRef.current = false;
    // A new item's selection reports describe automatic selection, not a choice,
    // so the capture starts over. The pending timer especially: letting it fire
    // after the swap would bank the previous item's selection.
    if (subtitleCaptureTimerRef.current) {
      clearTimeout(subtitleCaptureTimerRef.current);
      subtitleCaptureTimerRef.current = null;
    }
    lastObservedSubtitleRef.current = null;
    // Every item opens UNSET, and the stored choice is applied later, once the
    // item has reported its tracks. Applying it here instead looked right and
    // silently did nothing: RCTVideo.setSelectedTextTrack bails on `_source`
    // being nil, and RCTPlayerOperations bails again when the asset has no
    // legible group parsed yet, both without a word. Starting unset is also what
    // guarantees the prop CHANGES when the choice is applied; re-sending a value
    // the prop already holds would not reach the lib at all.
    subtitlesAppliedForItemRef.current = false;
    autoAppliedDefaultRef.current = null;
    appliedSubtitlePreferenceRef.current = SUBTITLES_UNSET;
    setTextTrackLanguages([]);
    setAppliedSubtitlePreference(SUBTITLES_UNSET);
  }, [videoId]);

  /**
   * Waits for stable playback on purpose: AVFoundation wipes the legible selection ~0.4s in,
   * so anything applied earlier is thrown away. The rules are in videoPlayback/subtitleSession.
   */
  useEffect(() => {
    if (!hasStablePlayback || subtitlesAppliedForItemRef.current) return;
    // Nothing reported means no legible group to select in. This effect re-runs when the
    // report lands, which is why the languages are state.
    if (textTrackLanguages.length === 0) return;
    subtitlesAppliedForItemRef.current = true;

    const plan = planSubtitleApplication({
      stored: getSubtitlePreferenceSync(),
      languages: textTrackLanguages,
      defaultRenditionLanguage: subtitleRenditionsRef.current.find((rendition) => rendition.isDefault)?.language,
    });
    if (plan.kind === "leave") {
      logger.debug("📝 Subtitles: leaving automatic selection alone", { service: "useVideoPlayback", reason: plan.reason, available: textTrackLanguages.join(", ") });
      return;
    }
    if (plan.kind === "autoDefault") autoAppliedDefaultRef.current = plan.tag;
    logger.debug("📝 Subtitles: selecting", {
      service: "useVideoPlayback",
      preference: plan.preference.kind === "language" ? plan.preference.tag : plan.preference.kind,
      fromFileDefault: plan.kind === "autoDefault",
    });
    appliedSubtitlePreferenceRef.current = plan.preference;
    setAppliedSubtitlePreference(plan.preference);
  }, [hasStablePlayback, textTrackLanguages]);

  /**
   * Start metadata fetch when in IDLE or FETCHING_METADATA state
   */
  useEffect(() => {
    // PlayerHost keeps this hook mounted for the life of the app so Picture in
    // Picture can outlive the /player route, and holds it here between sessions.
    // Everything else stays armed: the videoId-keyed effects above still run, so
    // ending a session tears its stream down exactly as unmounting used to.
    if (skip) return;
    if (state.type === "IDLE") {
      dispatch({ type: "FETCH_METADATA" });
    } else if (state.type === "FETCHING_METADATA") {
      // The machine's driver: entering a state triggers its async work, whose
      // completion dispatches the next state. The cascade is the design.

      fetchMetadata();
    }
  }, [skip, state.type, fetchMetadata]);

  /**
   * A session that never reaches the player: the origin (a live transcode on a dead upstream, or
   * an on-device/copy open the link cannot carry) can leave AVPlayer waiting minutes with no error.
   * Bound the open here so it bails to its next lane fast. Live gets a longer deadline; a movie on
   * the copy/direct lane (each of which has a server fallback) gets the shorter one.
   */
  useEffect(() => {
    if (state.type !== "INITIALIZING_PLAYER") return;
    const live = isLiveRef.current;
    const boundsNonLive = currentModeRef.current === "localRemux" || currentModeRef.current === "direct";
    if (!live && !boundsNonLive) return;
    const ms = live ? LIVE_START_DEADLINE_MS : VOD_OPEN_DEADLINE_MS;
    const timer = setTimeout(() => {
      if (!isMountedRef.current) return;
      logger.warn(live ? "Live channel did not start in time" : "Player did not open in time, bailing to the next lane", {
        service: "useVideoPlayback",
        lane: currentModeRef.current,
        seconds: ms / 1000,
      });
      onError({ error: { errorString: `playback did not start within ${ms / 1000}s` } } as OnVideoErrorData);
    }, ms);
    return () => clearTimeout(timer);
  }, [state.type, onError]);

  /**
   * Handle retry with transcoding when direct play fails
   */
  useEffect(() => {
    if (state.type !== "ERROR" || !state.canRetryWithTranscode || !isMountedRef.current) return;

    // Don't auto-retry if error message suggests file is corrupted
    const isCorruptedFile = state.error.includes("corrupted") || state.error.includes("HostFunction") || state.error.includes("invalid");

    if (isCorruptedFile) {
      logger.warn("File appears corrupted, skipping auto-retry with transcoding", { service: "useVideoPlayback" });
      // Don't auto-retry, let user manually retry or go back
      return;
    }

    // A failed DIRECT play gets the engine as its next rung, not the server: AVPlayer refusing
    // a file whose codec and container both check out is usually a wrapper fault, which is what
    // the engine fixes. The engine failing in turn lands here as localRemux and reaches the server.
    if (heldEngineSpentRef.current && currentModeRef.current === "localRemux") {
      // A held file replaying from its own disk without its subtitles. Nothing is latched: the
      // lane picker has already dropped the subtitle ask, and spending a rung here is what sent
      // it to a server instead. Keyed on the spent engine rather than on a one-shot, so a
      // duplicate error lands on the same answer instead of undoing it.
    } else if (currentModeRef.current === "direct" && !hasTriedTranscodingRef.current) {
      directPlayFailedRef.current = true;
    } else {
      hasTriedTranscodingRef.current = true;
      setHasTriedTranscoding(true);
    }
    autoPlayTriggeredRef.current = false;
    isPlayingRef.current = false;

    // Clear streamUrl to unmount Video component during retry
    // This prevents the old URL from firing additional errors
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setStreamUrl(null);

    // Auto-retry with transcoding
    const retryTimer = setTimeout(() => {
      if (isMountedRef.current) {
        dispatch({ type: "RETRY_WITH_TRANSCODE" });
      }
    }, 500);

    return () => clearTimeout(retryTimer);
  }, [state]);

  /**
   * Playback control functions
   */
  const play = useCallback(() => {
    setPaused(false);
    reportPauseChange(false);
  }, [reportPauseChange]);

  const pause = useCallback(() => {
    setPaused(true);
    reportPauseChange(true);
  }, [reportPauseChange]);

  // Relative seek for remote-driven skips (tvOS audio-only: AVKit's audio presentation
  // exposes no focusable UI, so left/right remote events must seek from JS).
  const seekBy = useCallback((offsetSeconds: number) => {
    const duration = durationRef.current;
    if (duration <= 0) return; // not loaded yet
    const target = Math.max(0, Math.min(duration - 1, currentTimeRef.current + offsetSeconds));
    // Optimistic update so rapid presses accumulate instead of seeking from a stale position
    currentTimeRef.current = target;
    videoRef.current?.seek(target);
  }, []);

  // Absolute seek for the SyncPlay manager. pendingSeekTargetRef mutes the reporter's
  // pre-seek sampling, the same guard the auto-seek path uses.
  const seekTo = useCallback((seconds: number, toleranceMs?: number) => {
    const duration = durationRef.current;
    const target = duration > 0 ? Math.max(0, Math.min(duration - 1, seconds)) : Math.max(0, seconds);
    currentTimeRef.current = target;
    pendingSeekTargetRef.current = target;
    videoRef.current?.seek(target, toleranceMs);
  }, []);

  // With controls={true}, react-native-video's programmatic seek pauses the player
  // internally, mis-latches that pause as user intent (_paused), and re-applies it when
  // the seek completes, permanently stalling playback. onSeek fires after that re-apply
  // in the same native completion (RCTVideo.swift setSeek), so reasserting our intent
  // here always lands last. A seek issued while genuinely paused stays paused.
  const onSeek = useCallback(() => {
    // Seek completed, the player clock is trustworthy again for the reporter.
    pendingSeekTargetRef.current = null;
    syncPlayManager.noteSeekCompleted(currentTimeRef.current);
    // A seek fragments buffered ranges, so occupancy readings lie while the
    // new range refills; the controller holds its fire through the grace.
    if (adaptiveRef.current) {
      adaptiveRef.current = advanceAdaptive(adaptiveRef.current, { kind: "seeked", nowMs: Date.now() }).state;
    }
    if (!pausedRef.current) {
      videoRef.current?.resume();
    }
  }, []);

  // A viewer touching AVKit's own transport surfaces here; the manager forwards it to
  // the group. Player changes the manager itself caused are marked and ignored.
  const onPlaybackStateChanged = useCallback((event: OnPlaybackStateChangedData) => {
    syncPlayManager.notePlaybackState(event);
  }, []);

  /**
   * Retry playback from the beginning
   */
  const retry = useCallback(() => {
    // Clear any pending timers
    if (autoPlayTimerRef.current) {
      clearTimeout(autoPlayTimerRef.current);
      autoPlayTimerRef.current = null;
    }
    if (stablePlaybackTimerRef.current) {
      clearTimeout(stablePlaybackTimerRef.current);
      stablePlaybackTimerRef.current = null;
    }

    hasTriedTranscodingRef.current = false;
    setHasTriedTranscoding(false);
    setHasTriedSeekRecovery(false);
    hasTriedRemuxRestartRef.current = false;
    liveReopenedRef.current = false;
    liveLaneRef.current = "engine";
    heldEngineSpentRef.current = false;
    resetPlaybackStages();
    stallFallbackRef.current = false;
    adaptiveRef.current = null;
    adaptiveOverrideIndexRef.current = null;
    setHasStablePlayback(false);
    hasStablePlaybackRef.current = false;
    autoPlayTriggeredRef.current = false;
    isPlayingRef.current = false;
    dispatch({ type: "RETRY" });
  }, []);

  /**
   * Compute UI state from state machine
   */
  // Check if current video is audio-only
  const isAudioOnlyFile = videoDetails ? isAudioOnly(videoDetails) : false;

  const isLoading =
    state.type === "FETCHING_METADATA" || state.type === "CREATING_STREAM" || state.type === "INITIALIZING_PLAYER" || state.type === "READY" || (state.type === "PLAYING" && !hasStablePlayback);

  const showLoadingOverlay = isLoading;

  /**
   * Video callbacks object for Video component props
   */
  const videoCallbacks = useMemo(
    () => ({
      onLoad,
      onProgress,
      onError,
      onEnd,
      onSeek,
      onBuffer,
      onAudioTracks,
      onTextTracks,
      onPlaybackStateChanged,
    }),
    [onLoad, onProgress, onError, onEnd, onSeek, onBuffer, onAudioTracks, onTextTracks, onPlaybackStateChanged],
  );

  // Hand the manager a way to drive this player while a group is joined. Re-registered
  // per item so a queue advance never leaves the manager holding the previous session.
  useEffect(() => {
    const detach = syncPlayManager.attachControls({
      videoId,
      seekTo,
      setPaused,
      getPositionSeconds: () => currentTimeRef.current,
    });
    return () => {
      detach();
      syncPlayManager.notePlayerGone(videoId);
    };
  }, [videoId, seekTo]);

  return {
    videoRef,
    sourceUri: streamUrl,
    startPositionMs,
    paused,
    maxBitRate: videoMaxBitRate,
    chapterFrameBaseUrl,
    forwardBufferSeconds,
    videoCallbacks,
    state,
    videoDetails,
    isAudioOnly: isAudioOnlyFile,
    isLoading,
    showLoadingOverlay,
    play,
    pause,
    seekBy,
    seekTo,
    retry,
    // Bitmap subtitles: the engine's session URL to fetch cues and images from,
    // and which track the viewer selected. Both null unless local remux is the
    // active lane and an image track is on. Read off the reducer state rather
    // than currentModeRef, which is a ref and would not re-render the overlay.
    // The engine serves its sets over loopback; a held file's sit beside it, and the stream
    // URL is already inside that directory either way.
    imageSubtitleSessionUrl: "mode" in state && (state.mode === "localRemux" || (state.mode === "direct" && playsRepackaged(videoId))) ? streamUrl : null,
    activeImageSubtitleStream,
    currentTimeRef,
    selectedTextTrack,
    selectedAudioTrack,
  };
}
