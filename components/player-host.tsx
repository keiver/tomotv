import { DismissPan } from "@/components/dismiss-pan";
import { ImageSubtitleOverlay } from "@/components/image-subtitle-overlay";
import { COLORS } from "@/constants/colors";
import { usePlayerSessionHost, type HostMode, type PlayerHostBridge, type PlayerTvConfig } from "@/contexts/PlayerSessionContext";
import { setPlaybackHold } from "@/services/playbackHold";
import { useVideoPlayback } from "@/hooks/useVideoPlayback";
import { getPosterUrl, hasPoster, JELLYFIN_TIME } from "@/services/jellyfinApi";
import { IS_MAC } from "@/utils/hostEnvironment";
import { backkeyProbe } from "@/utils/backkeyProbe";
import { logger } from "@/utils/logger";
import { router } from "expo-router";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Platform, StyleSheet, TVEventControl, useTVEventHandler, View } from "react-native";
import Video from "react-native-video";
import type { OnLoadData, OnPictureInPictureStatusChangedData, OnVideoErrorData } from "react-native-video";
import type { JellyfinVideoItem } from "@/types/jellyfin";

/**
 * The app's one video player, mounted above the navigator so a PiP window can
 * outlive /player. Parks off screen whenever the route has something focusable,
 * since a view above a focusable strands tvOS focus.
 */

/** How far after a PiP restore the completion flag is re-armed, in ms. */
const RESTORE_REARM_MS = 1000;

/**
 * Phone playback runs inside AVKit's presented player. tvOS never presents, and
 * neither does a Mac: presenting hands the player's geometry to
 * UIScreen.main.bounds (RCTVideo.setFullscreen), which on a desktop is the
 * display rather than the window, and the video output lands in a coordinate
 * space the window does not share. Inline, React Native owns the size.
 */
const PRESENTS_NATIVE_FULLSCREEN = Platform.OS === "ios" && !Platform.isTV && !IS_MAC;
/** How long a requested presentation has to confirm before a waiting teardown stops waiting, in ms. */
const PRESENT_CONFIRM_TIMEOUT_MS = 1500;
/** Same, for a requested dismissal. The native backstop covers the teardown that goes ahead anyway. */
const DISMISS_CONFIRM_TIMEOUT_MS = 1500;
/** How long after a PiP hand-off a second dismissal event still counts as part of it, in ms. */
const PIP_HANDOFF_BURST_MS = 1500;

/**
 * The item's chapter markers in the shape react-native-video wants, or undefined
 * when there are none worth sending.
 *
 * Exported so the rule can be read and tested on its own, the same reason
 * escapeAction is exported from mac-key-commands.tsx.
 *
 * The library maps this prop onto the player item's navigationMarkerGroups,
 * which is what puts a Chapters tab in AVKit's swipe-down info panel. That
 * property exists only in the tvOS SDK, and the library's own wiring sits behind
 * `#if os(tvOS)`, so the caller sends this on TV alone rather than shipping an
 * array everywhere for a prop only one platform reads.
 *
 * Not routed through PlayerTvConfig like the skip pills and the Up Next tab are:
 * those are computed from the QUEUE, which only the route knows, while chapters
 * come off the item the host has already loaded.
 *
 * No image uri on purpose. RCTVideoTVUtils.makeTimedMetadataGroup fetches each
 * chapter's artwork with a SYNCHRONOUS Data(contentsOf:) as it builds the player
 * item, so a film with thirty remote chapter images would block construction
 * thirty times over before playback could begin.
 */
export function playerChapters(item: JellyfinVideoItem | null): { title: string; startTime: number; endTime: number }[] | undefined {
  if (!item?.Chapters?.length) return undefined;
  const runtimeSeconds = item.RunTimeTicks / JELLYFIN_TIME.TICKS_PER_SECOND;
  const starts = item.Chapters.map((chapter) => chapter.StartPositionTicks / JELLYFIN_TIME.TICKS_PER_SECOND);
  const chapters = item.Chapters.map((chapter, index) => ({
    // Jellyfin sends no Name for files whose chapters were never titled, which is most of them.
    title: chapter.Name?.trim() || `Chapter ${index + 1}`,
    startTime: starts[index],
    // A chapter ends where the next begins; the last ends at the runtime.
    endTime: index + 1 < starts.length ? starts[index + 1] : runtimeSeconds,
  })).filter((chapter) => chapter.endTime > chapter.startTime);
  // A single chapter spanning the whole film is what ffmpeg reports for a file
  // with no real chapters, and a one-entry list is a worse info panel than none.
  return chapters.length > 1 ? chapters : undefined;
}

/**
 * Where AVKit's presented player is in its life. See endSession.
 *
 * "dismissing" is entered only when WE ask for the dismissal, never from the will-event: AVKit
 * announces that one for transitions the viewer can still cancel, and a state the viewer can
 * strand us in is the bug this whole file is built around.
 */
type PresentationState = "none" | "pending" | "up" | "dismissing";

interface HostSession {
  videoId: string;
  videoName?: string;
  startPositionTicks?: number;
  playedAtStart?: boolean;
  probe?: boolean;
  sessionKey: string;
}

type PipState = "none" | "active" | "detached";

export function PlayerHost() {
  const { registerHost, publish, handlersRef } = usePlayerSessionHost();

  // State for rendering, ref for the AVKit callbacks and the bridge, which are
  // called from outside React and need the current value.
  const [session, setSession] = useState<HostSession | null>(null);
  const sessionRef = useRef<HostSession | null>(null);
  const applySession = useCallback((next: HostSession | null) => {
    sessionRef.current = next;
    setSession(next);
  }, []);

  // The next item waits for the current one to finish leaving. Starting one on
  // top of a live session overlaps two players, two engine sessions and two
  // reporters, in no defined order.
  const [pending, setPending] = useState<HostSession | null>(null);
  const pendingRef = useRef<HostSession | null>(null);
  const applyPending = useCallback((next: HostSession | null) => {
    pendingRef.current = next;
    setPending(next);
  }, []);

  const [tvConfig, setTvConfig] = useState<PlayerTvConfig>({});

  // Playback finished, and the route owns the screen from here: the phone's Up Next card,
  // or the pop that ends the session. Nothing in the state machine says so — onEnd reports
  // to the server and calls the route, leaving state.type PLAYING — so without this the
  // stage stays up, opaque, above the navigator and wearing the closing curtain, and the
  // card the route just mounted is announced behind a black screen. Set only from the
  // presented (phone) callbacks: tvOS draws its Up Next INSIDE AVKit and needs the host on
  // screen to do it. Cleared whenever a session starts or is adopted.
  const [ended, setEnded] = useState(false);

  const [pip, setPipState] = useState<PipState>("none");
  const pipRef = useRef<PipState>("none");
  const setPip = useCallback((next: PipState) => {
    pipRef.current = next;
    setPipState(next);
  }, []);

  // Closing curtain: opaque black over the inline video. A user ✕/swipe dismissal only
  // reaches native code AFTER the slide-down finished (viewDidDisappear), and the lib
  // re-embeds the same player inline on the next runloop tick — faster than any JS
  // reaction to the dismiss event, so a reactive cover would leak frames of chromeless
  // video. Instead the curtain goes up invisibly BEHIND the presentation as soon as it's
  // confirmed on screen (DidPresent), so the re-embed lands under it and every close pops
  // over black. It comes down only when a dismissal turns out to be the PiP hand-off,
  // where the inline player behind the PiP window is the accepted UI.
  const [curtainUp, setCurtainUp] = useState(false);

  // The presented player's life, and a teardown that arrived before it could be presented or
  // dismissed. Both waits exist for the same reason: unmounting <Video> while AVKit still has a
  // presentation on screen strands it (see endSession).
  const presentationRef = useRef<PresentationState>("none");
  const endWhenPresentedRef = useRef(false);
  const presentWaitRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const endWhenDismissedRef = useRef(false);
  const dismissWaitRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const programmaticDismissRef = useRef(false);

  // The route's callbacks, reached through the provider's ref so the queue can
  // churn their identities without restarting playback. A session with no route
  // attached is a detached PiP window: nothing is listening, so playback ending
  // ends the session instead.
  //
  // endSession is reached through a ref rather than directly, because it needs the player
  // that useVideoPlayback owns and this is an argument to that hook. Safe by ordering: the
  // effect below assigns it on the host's first commit, and nothing can have finished
  // playing by then.
  const endSessionRef = useRef<() => void>(() => {});
  const handlePlaybackEnd = useCallback(() => {
    if (!handlersRef.current) {
      endSessionRef.current();
      return;
    }
    handlersRef.current.onPlaybackEnd();
  }, [handlersRef]);

  const {
    videoRef,
    sourceUri,
    startPositionMs,
    paused,
    maxBitRate,
    videoCallbacks,
    state,
    showLoadingOverlay,
    pause,
    retry,
    videoDetails,
    seekBy,
    imageSubtitleSessionUrl,
    activeImageSubtitleStream,
    currentTimeRef,
    selectedTextTrack,
  } = useVideoPlayback({
    videoId: session?.videoId ?? "",
    skip: session === null,
    startPositionTicks: session?.startPositionTicks,
    playedAtStart: session?.playedAtStart,
    onPlaybackEnd: handlePlaybackEnd,
    probe: session?.probe,
  });

  // Disarm a teardown that is waiting on a presentation. Called wherever a session is
  // established as well as torn down: the flag outliving the session that armed it would
  // have the NEXT item's presentation end the session it just started.
  const clearPresentationWait = useCallback(() => {
    endWhenPresentedRef.current = false;
    if (presentWaitRef.current) {
      clearTimeout(presentWaitRef.current);
      presentWaitRef.current = null;
    }
    endWhenDismissedRef.current = false;
    if (dismissWaitRef.current) {
      clearTimeout(dismissWaitRef.current);
      dismissWaitRef.current = null;
    }
  }, []);

  // The teardown itself: the session is gone, and <Video> unmounts with it.
  const finishSession = useCallback(() => {
    logger.info("Player host: session ended", { service: "PlayerHost" });
    presentationRef.current = "none";
    clearPresentationWait();
    applySession(null);
    setTvConfig({});
    setPip("none");
    // Never outlives the session it was covering: an opaque curtain over a dead stage is
    // a black screen with nothing left to dismiss it.
    setCurtainUp(false);
  }, [applySession, clearPresentationWait, setPip]);

  /**
   * Take the presentation down, once. Flagged so the dismissal event it triggers is not read as
   * a user close, and stated so nothing asks twice while the animation is still running.
   */
  const requestDismissal = useCallback(() => {
    if (presentationRef.current !== "up") return;
    programmaticDismissRef.current = true;
    presentationRef.current = "dismissing";
    videoRef.current?.setFullScreen(false);
  }, [videoRef]);

  /**
   * End the session, but never out from under a presentation.
   *
   * Unmounting <Video> while AVKit's player is presented strands it: RCTVideo's
   * removeFromSuperview nils the player and pulls the controller's view out of the presentation
   * container. So a teardown mid-present waits for DidPresent, and one over a live presentation
   * asks for the dismissal and waits for DidDismiss — asking is not the same as it having
   * happened, and the animation outlives this call. Both waits give up on a timeout rather than
   * hold a session nothing can end; the patch's teardown dismiss is what makes giving up safe.
   */
  const endSession = useCallback(() => {
    if (!sessionRef.current) return;

    if (PRESENTS_NATIVE_FULLSCREEN && presentationRef.current === "pending") {
      if (endWhenPresentedRef.current) return;
      logger.info("Player host: teardown waiting for the presentation to land", { service: "PlayerHost" });
      endWhenPresentedRef.current = true;
      presentWaitRef.current = setTimeout(() => {
        presentWaitRef.current = null;
        if (!endWhenPresentedRef.current || !sessionRef.current) return;
        logger.warn("Player host: presentation never confirmed, ending the session anyway", { service: "PlayerHost" });
        finishSession();
      }, PRESENT_CONFIRM_TIMEOUT_MS);
      return;
    }

    if (PRESENTS_NATIVE_FULLSCREEN && (presentationRef.current === "up" || presentationRef.current === "dismissing")) {
      requestDismissal(); // no-op if onEnd/onError already asked
      if (endWhenDismissedRef.current) return;
      endWhenDismissedRef.current = true;
      logger.info("Player host: teardown waiting for the dismissal to land", { service: "PlayerHost" });
      dismissWaitRef.current = setTimeout(() => {
        dismissWaitRef.current = null;
        if (!endWhenDismissedRef.current || !sessionRef.current) return;
        logger.warn("Player host: dismissal never confirmed, ending the session anyway", { service: "PlayerHost" });
        finishSession();
      }, DISMISS_CONFIRM_TIMEOUT_MS);
      return;
    }

    finishSession();
  }, [finishSession, requestDismissal]);

  useEffect(() => {
    endSessionRef.current = endSession;
  }, [endSession]);

  /**
   * The route is leaving, and a live PiP window outlives it. Tested against "none" rather
   * than "active" because handleBack stops the session and THEN pops: the release that
   * follows arrives already detached and must not tear the window down.
   */
  const leaveRoute = useCallback(() => {
    if (pipRef.current === "none") {
      endSession();
      return;
    }
    logger.info("Player host: route left, PiP window keeps playing", { service: "PlayerHost" });
    setPip("detached");
  }, [endSession, setPip]);

  // Drag down to leave (phone). AVKit's ✕ and swipe are the way out of the presented player;
  // this is the way out of every state where the presentation is NOT what's on screen and the
  // stage covers the app anyway. Same rule as above: no route attached, the session ends itself.
  const handleDismissGesture = useCallback(() => {
    if (!sessionRef.current) return;
    logger.info("Player host: dismissed by drag", { service: "PlayerHost" });
    if (!handlersRef.current) {
      endSession();
      return;
    }
    handlersRef.current.onRequestBack();
  }, [endSession, handlersRef]);

  // Only once there is a picture to show. Loading and error belong to the route,
  // whose overlay and buttons are the focus anchors. tvOS PiP hides the host; phone PiP
  // keeps it while the route is up, and a detached window parks it on both.
  const hostVisible = session !== null && sourceUri !== null && !showLoadingOverlay && !ended && state.type !== "ERROR" && (pip === "none" || (!Platform.isTV && pip === "active"));
  // For the Menu handler, which always arrives after the commit that set this.
  const hostVisibleRef = useRef(false);
  useEffect(() => {
    hostVisibleRef.current = hostVisible;
  }, [hostVisible]);

  const hostMode: HostMode = useMemo(() => {
    if (session === null) return "idle";
    if (pip === "detached") return "pip-detached";
    if (pip === "active") return "pip-active";
    if (state.type === "ERROR") return "error";
    return hostVisible ? "video" : "loading";
  }, [session, pip, state.type, hostVisible]);

  // Publish what the route renders from.
  useEffect(() => {
    publish({
      hostMode,
      sessionVideoId: session?.videoId ?? null,
      playbackState: state,
      showLoadingOverlay,
      hasStream: sourceUri !== null,
    });
  }, [publish, hostMode, session, state, showLoadingOverlay, sourceUri]);

  // Playback owns the link and the JS thread while a session lives, so competing
  // background work stands down. Held through a detached PiP window too.
  useEffect(() => {
    setPlaybackHold("video", session !== null);
    return () => setPlaybackHold("video", false);
  }, [session]);

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

  // tvOS chapter list, gated here rather than inside playerChapters so the rule
  // stays testable off a TV. See that function for what AVKit does with it.
  const chapters = useMemo(() => (Platform.isTV ? playerChapters(videoDetails) : undefined), [videoDetails]);

  // Phone playback (video AND audio) lives inside AVKit's PRESENTED player — Apple's default
  // full-screen state: every native control works and the stock ✕ is visible from the start
  // (no expand arrow). Presented on onLoad (the native setter no-ops before the AVPlayer
  // exists), skipped if a dismissal already started. onError/onEnd dismiss BEFORE their
  // navigation unmounts <Video>, flagged so the dismissal event they trigger isn't read as a
  // user close; endSession above holds the same line for every other way out. Audio note: the
  // RN poster squircle renders behind the presentation, so presented audio shows AVKit's own
  // audio chrome instead.
  const presentedCallbacks = useMemo(() => {
    if (!PRESENTS_NATIVE_FULLSCREEN) {
      // tvOS draws its Up Next INSIDE AVKit and needs the host on screen for it.
      // A Mac has no presentation to slide away, so nothing else would park the
      // stage and the route's card would be announced behind opaque black.
      if (Platform.isTV) return videoCallbacks;
      return {
        ...videoCallbacks,
        onEnd: () => {
          setEnded(true);
          videoCallbacks.onEnd();
        },
      };
    }
    return {
      ...videoCallbacks,
      onFullscreenPlayerDidPresent: () => {
        presentationRef.current = "up";
        setCurtainUp(true);
        // A teardown that arrived while this was still arriving: there is finally
        // something for setFullscreen(false) to act on, so it can run now.
        if (endWhenPresentedRef.current) {
          endWhenPresentedRef.current = false;
          endSession();
        }
      },
      onLoad: (data: OnLoadData) => {
        videoCallbacks.onLoad(data);
        if (sessionRef.current) {
          programmaticDismissRef.current = false;
          presentationRef.current = "pending";
          videoRef.current?.setFullScreen(true);
        }
      },
      onError: (error: OnVideoErrorData) => {
        requestDismissal();
        videoCallbacks.onError(error);
      },
      onEnd: () => {
        setEnded(true);
        requestDismissal();
        videoCallbacks.onEnd();
      },
    };
  }, [endSession, requestDismissal, videoCallbacks, videoRef]);

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
  //
  // The same signal gates the Menu handler below.
  const [controls, setControls] = useState<{ visible: boolean; unobscuredBottom: number | null }>({ visible: false, unobscuredBottom: null });
  const controlsVisibleRef = useRef(false);

  const playerCallbacks = useMemo(
    () => ({
      ...presentedCallbacks,
      onLoad: (data: OnLoadData) => {
        if (data.naturalSize?.width && data.naturalSize?.height) {
          setVideoSize({ width: data.naturalSize.width, height: data.naturalSize.height });
        }
        presentedCallbacks.onLoad(data);
      },
      onControlsVisibilityChange: (event: { isVisible: boolean; unobscuredBottom?: number }) => {
        controlsVisibleRef.current = event.isVisible;
        setControls({ visible: event.isVisible, unobscuredBottom: typeof event.unobscuredBottom === "number" ? event.unobscuredBottom : null });
      },
    }),
    [presentedCallbacks],
  );

  // PiP: tapping AVKit's PiP button auto-dismisses the presentation (AVKit default), and the
  // lib's cleanup re-embeds the same player inline behind it. ACCEPTED tradeoff: PiP plays,
  // the screen behind shows the same video inline, and that inline player is fully functional.
  // The auto-dismissal must not read as a close (stopping the session would unmount <Video> and
  // kill PiP), so the dismissal is swallowed while this flag is armed and the flag is CONSUMED
  // (one-shot). Consuming it matters: the lib detaches the first PiP session's delegate during
  // that same cleanup, so no end-of-PiP signal ever arrives, and a sticky flag would suppress
  // every later close, the "can't leave the player" trap. Dismissals after the hand-off window
  // (e.g. manual expand then ✕ on the inline player) close normally. Phone only; tvOS never presents.
  //
  // Read SYNCHRONOUSLY, never behind a timer: viewDidDisappear nils the AVPlayerViewController
  // delegate one line before it emits the dismissal, so a PiP-start that lands later is never
  // delivered at all and any event we do see arrived first. The old 250ms wait was black screen.
  const pipHandoffArmedRef = useRef(false);
  const pipHandoffUntilRef = useRef(0);
  /**
   * The will-event is an ANNOUNCEMENT, not an outcome. AVKit's full-screen transition is
   * interruptible (AVPlayerViewController.h, willBeginFullScreenPresentation), and RNV emits
   * this one unconditionally while guarding only its Did counterpart with context.isCancelled.
   * Acting here is what ended a live session on a drag the viewer never finished, and unmounting
   * <Video> under the presentation that stayed up is the unrecoverable black screen. Log only.
   */
  const handlePresentationWillDismiss = useCallback(() => {}, []);

  /** The dismissal actually happened. Every decision that used to live in the will-event. */
  const handlePresentationDidDismiss = useCallback(() => {
    logger.info("Player host: presentation dismissed", {
      service: "PlayerHost",
      presentation: presentationRef.current,
      programmatic: programmaticDismissRef.current,
      hasSession: sessionRef.current !== null,
    });
    // Both native emitters can deliver this for one dismissal (the setFullscreen completion
    // handler and viewDidDisappear), and a torn-down session leaves it at "none" too.
    if (presentationRef.current === "none") return;
    presentationRef.current = "none";
    // A teardown that asked for this dismissal and has been waiting for it can finish now.
    if (endWhenDismissedRef.current) {
      finishSession();
      return;
    }
    if (!sessionRef.current || programmaticDismissRef.current) return;
    if (Date.now() < pipHandoffUntilRef.current) return; // duplicate event from the hand-off burst
    if (pipHandoffArmedRef.current) {
      pipHandoffUntilRef.current = Date.now() + PIP_HANDOFF_BURST_MS;
      pipHandoffArmedRef.current = false;
      setCurtainUp(false);
      return;
    }
    // With no route listening this used to drop the event, leaving a live session behind
    // an opaque curtain: the black screen with nothing left to dismiss it.
    if (!handlersRef.current) {
      endSession();
      return;
    }
    handlersRef.current.onRequestBack();
  }, [endSession, finishSession, handlersRef]);

  const restoreRearmRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    return () => {
      if (restoreRearmRef.current) clearTimeout(restoreRearmRef.current);
      if (presentWaitRef.current) clearTimeout(presentWaitRef.current);
      if (dismissWaitRef.current) clearTimeout(dismissWaitRef.current);
    };
  }, []);

  const handlePipStatusChanged = useCallback(
    ({ isActive }: OnPictureInPictureStatusChangedData) => {
      // Must print BEFORE "presentation dismissed" on a PiP hand-off; that ordering is what
      // lets the dismissal handler read the flag synchronously.
      logger.info("Player host: PiP status changed", { service: "PlayerHost", isActive, pip: pipRef.current });
      pipHandoffArmedRef.current = isActive;
      if (isActive) {
        setPip("active");
        return;
      }
      // The window closed on its own (the viewer pressed its ✕) with no route
      // left to go back to: the session has no surface and no owner.
      if (pipRef.current === "detached") {
        endSession();
        return;
      }
      setPip("none");
    },
    [endSession, setPip],
  );

  // PiP "return to app". AVKit parks the transition on a completion handler and
  // stalls until JS answers, so answer as soon as there is a route to restore to.
  const pendingRestoreRef = useRef(false);
  const answerRestore = useCallback(() => {
    videoRef.current?.restoreUserInterfaceForPictureInPictureStopCompleted(true);
    // The lib never resets this prop, so a second cycle would re-send `true` and
    // React would see no change. Put it back once the transition is over.
    if (restoreRearmRef.current) clearTimeout(restoreRearmRef.current);
    restoreRearmRef.current = setTimeout(() => {
      videoRef.current?.restoreUserInterfaceForPictureInPictureStopCompleted(false);
    }, RESTORE_REARM_MS);
  }, [videoRef]);

  const handleRestoreFromPip = useCallback(() => {
    const current = sessionRef.current;
    if (!current) return;
    if (pipRef.current !== "detached") {
      answerRestore();
      return;
    }
    if (pendingRestoreRef.current) return;
    pendingRestoreRef.current = true;
    logger.info("Player host: restoring the popped player for PiP", { service: "PlayerHost" });
    router.push({
      pathname: "/player" as const,
      params: { videoId: current.videoId, videoName: current.videoName ?? "", adopt: "1" },
    });
  }, [answerRestore]);

  // The one JS Menu handler in the app, and MANDATORY: focus is in AVKit's transport, a child of
  // the root view rather than the navigator, so the press reaches no navigation controller and the
  // system suspends the app instead of popping. Deleting this to satisfy the zero-handlers rule is
  // what proved it (2026-08-14). Off unless the host owns the screen; with the transport bar up,
  // Menu is AVKit's own close gesture.
  //
  // Nothing NATIVE races this, but the press can still reach here more than once, which is why the
  // pop it triggers is scoped to the route's own navigator (see handleBack in app/player.tsx).
  useEffect(() => {
    if (!Platform.isTV || !hostVisible) return;
    // [backkey] dev-only diagnostics for the Menu/back investigation
    backkeyProbe("TV menu key ENABLED (hostVisible)");
    TVEventControl.enableTVMenuKey();
    return () => {
      backkeyProbe("TV menu key disabled");
      TVEventControl.disableTVMenuKey();
    };
  }, [hostVisible]);

  useTVEventHandler(
    useCallback(
      (event: { eventType: string }) => {
        if (!Platform.isTV || event.eventType !== "menu") return;
        if (!hostVisibleRef.current || controlsVisibleRef.current) return;
        handlersRef.current?.onRequestBack();
      },
      [handlersRef],
    ),
  );

  const beginSession = useCallback(
    (next: HostSession) => {
      logger.info("Player host: starting session", { service: "PlayerHost", videoName: next.videoName, presented: PRESENTS_NATIVE_FULLSCREEN });
      setCurtainUp(false);
      setEnded(false);
      setPip("none");
      pipHandoffArmedRef.current = false;
      programmaticDismissRef.current = false;
      presentationRef.current = "none";
      clearPresentationWait();
      applySession(next);
    },
    [applySession, clearPresentationWait, setPip],
  );

  // The handover: the next item starts only once the last one is fully gone,
  // which is <Video> unmounted, so its player, engine session and reporter are
  // all torn down rather than racing the new ones.
  useEffect(() => {
    if (!pending || session !== null || sourceUri !== null) return;
    // Deliberate cascade: the teardown has committed, so the next item starts now.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    applyPending(null);
    beginSession(pending);
  }, [pending, session, sourceUri, applyPending, beginSession]);

  const bridge: PlayerHostBridge = useMemo(
    () => ({
      requestSession: (request) => {
        const current = sessionRef.current;
        // Adopt rather than restart when the live session IS what is being
        // asked for: the host's own restore push says so outright, and a route
        // re-requesting the same item under the same deep-link nonce is the
        // same screen asking twice. A new nonce for the same item is a fresh
        // Top Shelf selection and has to restart the stream.
        const adopt = current !== null && (request.adopt === true || (current.videoId === request.videoId && current.sessionKey === request.sessionKey));
        if (adopt) {
          applySession({ ...current, sessionKey: request.sessionKey, videoName: request.videoName ?? current.videoName });
          setEnded(false);
          // A route asking for this session back cancels the teardown the departing one left
          // waiting on the presentation.
          clearPresentationWait();
          // Coming back from a detached window: clear the flag before AVKit
          // reports the stop, or that report reads as "closed with no route".
          setPip("none");
          return;
        }
        applyPending({
          videoId: request.videoId,
          videoName: request.videoName,
          startPositionTicks: request.startPositionTicks,
          playedAtStart: request.playedAtStart,
          probe: request.probe,
          sessionKey: request.sessionKey,
        });
        endSession();
      },
      releaseRoute: (owner) => {
        const queued = pendingRef.current;
        if (queued && queued.videoId === owner.videoId && queued.sessionKey === owner.sessionKey) applyPending(null);
        const current = sessionRef.current;
        // A screen releasing an item this host has already moved on from is the
        // outgoing half of a queue advance, whose replace remounts the route and
        // overlaps the two screens. Its teardown is not ours to run.
        if (!current || current.videoId !== owner.videoId || current.sessionKey !== owner.sessionKey) return;
        // The whole point of this host: a live PiP window outlives the route that
        // started it, and the app stays browsable around it.
        leaveRoute();
      },
      stopSession: () => {
        applyPending(null);
        // A detached window has no route to leave; ending it is the teardown its own ✕ takes.
        if (pipRef.current === "detached") {
          endSession();
          return;
        }
        leaveRoute();
      },
      signalRoutePresented: () => {
        if (!pendingRestoreRef.current) return;
        pendingRestoreRef.current = false;
        answerRestore();
      },
      setTvConfig,
      // Both callers are the route leaving and the route's error state, and neither of
      // them paused anything a PiP window is playing.
      pause: () => {
        if (pipRef.current !== "none") return;
        pause();
      },
      retry,
      seekBy,
    }),
    [answerRestore, applyPending, applySession, clearPresentationWait, endSession, leaveRoute, pause, retry, seekBy, setPip],
  );

  useEffect(() => {
    registerHost(bridge);
    return () => registerHost(null);
  }, [registerHost, bridge]);

  // Where the player waits out loading. tvOS parks at 1x1 (see the style), every
  // other platform parks at the stage's size, because that size is what AVKit
  // hands the video pipeline as its output geometry.
  const parked = Platform.isTV ? styles.offstage : styles.parked;

  return (
    <DismissPan onDismiss={handleDismissGesture} style={hostVisible ? styles.stage : parked} pointerEvents={hostVisible ? "auto" : "none"}>
      {session !== null && sourceUri && (
        <Video
          key={sourceUri} // Force remount when switching from direct play to transcoding
          ref={videoRef}
          source={{
            uri: sourceUri,
            // jellyfin-multi:// is treated as network by patched react-native-video
            metadata: sourceMetadata,
            // Null off the Mac, where the hook seeks after load instead.
            ...(startPositionMs !== null ? { startPosition: startPositionMs } : {}),
          }}
          style={styles.video}
          resizeMode="contain"
          controls={true}
          paused={paused}
          // Slipstream: live variant cap (pins); undefined everywhere else.
          maxBitRate={maxBitRate ?? undefined}
          // The viewer's remembered subtitle choice, applied at item start.
          // Unset is {type: "system"}, which is the automatic path the lib
          // already takes, so a fresh install is unchanged.
          selectedTextTrack={selectedTextTrack}
          allowsExternalPlayback={true}
          // RNV hard-disables AVKit's own now-playing publishing (updatesNowPlayingInfoCenter
          // = false); this prop is what turns on the lib's replacement publisher, which feeds
          // the AirPlay route sheet / lock screen card from source.metadata (title + poster).
          // Not on TV: it registers global MPRemoteCommandCenter targets that would compete
          // with the Siri remote's tuned seek/pause handling.
          showNotificationControls={!Platform.isTV}
          playWhenInactive={true} // Keep playing through the resign-active window so PiP entry doesn't find a paused player
          // tvOS native Up Next / skip pills, computed by the route from the queue
          // and this item's media segments.
          contentProposal={tvConfig.contentProposal}
          onContentProposalAccepted={() => handlersRef.current?.onContentProposalAccepted()}
          onContentProposalRejected={() => handlersRef.current?.onContentProposalRejected()}
          contextualActions={tvConfig.contextualActions}
          infoPanelItems={tvConfig.infoPanelItems}
          // tvOS Chapters tab in the same info panel, from this item's markers.
          chapters={chapters}
          onInfoPanelItemSelected={(event) => handlersRef.current?.onInfoPanelItemSelected(event)}
          // The presented player coming down: ✕, swipe-down, a PiP hand-off, or our own
          // onEnd/onError dismissals — the DID handler closes only for the first two. Will is
          // observed and never acted on; it fires for transitions that get cancelled.
          onFullscreenPlayerWillDismiss={handlePresentationWillDismiss}
          onFullscreenPlayerDidDismiss={handlePresentationDidDismiss}
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
    </DismissPan>
  );
}

const styles = StyleSheet.create({
  stage: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: COLORS.MEDIA_BACKGROUND,
  },
  // Parked, never unmounted: the AVPlayer has to keep running for PiP and for a
  // stream that is still resolving, and neither needs a visible view. Off screen
  // rather than zero-sized or hidden, so it cannot occlude tvOS focus. tvOS only,
  // where the inline player's size is the stage's size anyway.
  offstage: {
    position: "absolute",
    left: -10000,
    top: -10000,
    width: 1,
    height: 1,
  },
  // The same park, keeping the stage's size. A 1x1 player view is reported to
  // CoreMedia as a 1x1 video output, which caps decode resolution and, on macOS,
  // left the picture black while the chrome drew fine. Moved by transform, so the
  // size never changes and the flip to the stage costs no relayout.
  parked: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    transform: [{ translateX: -10000 }],
    backgroundColor: COLORS.MEDIA_BACKGROUND,
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
    backgroundColor: COLORS.MEDIA_BACKGROUND,
  },
});
