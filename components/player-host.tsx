import { DismissPan } from "@/components/dismiss-pan";
import { ImageSubtitleOverlay } from "@/components/image-subtitle-overlay";
import { usePlayerSessionHost, type HostMode, type PlayerHostBridge, type PlayerTvConfig } from "@/contexts/PlayerSessionContext";
import { setForegroundRefreshHold } from "@/hooks/useAppStateRefresh";
import { useVideoPlayback } from "@/hooks/useVideoPlayback";
import { getPosterUrl, hasPoster } from "@/services/jellyfinApi";
import { logger } from "@/utils/logger";
import { router } from "expo-router";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Platform, StyleSheet, TVEventControl, useTVEventHandler, View } from "react-native";
import Video from "react-native-video";
import type { OnLoadData, OnPictureInPictureStatusChangedData, OnVideoErrorData } from "react-native-video";

/**
 * The app's one video player, mounted above the navigator so a PiP window can
 * outlive /player. Parks off screen whenever the route has something focusable,
 * since a view above a focusable strands tvOS focus.
 */

/** How far after a PiP restore the completion flag is re-armed, in ms. */
const RESTORE_REARM_MS = 1000;

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

  const endSession = useCallback(() => {
    if (!sessionRef.current) return;
    logger.info("Player host: session ended", { service: "PlayerHost" });
    applySession(null);
    setTvConfig({});
    setPip("none");
    // Never outlives the session it was covering: an opaque curtain over a dead stage is
    // a black screen with nothing left to dismiss it.
    setCurtainUp(false);
  }, [applySession, setPip]);

  // The route's callbacks, reached through the provider's ref so the queue can
  // churn their identities without restarting playback. A session with no route
  // attached is a detached PiP window: nothing is listening, so playback ending
  // ends the session instead.
  const handlePlaybackEnd = useCallback(() => {
    if (!handlersRef.current) {
      endSession();
      return;
    }
    handlersRef.current.onPlaybackEnd();
  }, [endSession, handlersRef]);

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

  const { videoRef, sourceUri, paused, videoCallbacks, state, showLoadingOverlay, pause, retry, videoDetails, imageSubtitleSessionUrl, activeImageSubtitleStream, currentTimeRef, selectedTextTrack } =
    useVideoPlayback({
      videoId: session?.videoId ?? "",
      skip: session === null,
      startPositionTicks: session?.startPositionTicks,
      playedAtStart: session?.playedAtStart,
      onPlaybackEnd: handlePlaybackEnd,
      probe: session?.probe,
    });

  // Only once there is a picture to show. Loading and error belong to the route,
  // whose overlay and buttons are the focus anchors. tvOS PiP hides the host too;
  // phone PiP keeps it, since the inline player behind the window is the UI.
  const hostVisible = session !== null && sourceUri !== null && !showLoadingOverlay && !ended && state.type !== "ERROR" && (!Platform.isTV || pip === "none");
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

  // Suppress the foreground refresh storm for as long as a session lives — a
  // Top Shelf launch foregrounds the app straight into playback, and the
  // library/folder refetches would compete with stream startup. Held through a
  // detached PiP window too: that is still playback (see useAppStateRefresh).
  useEffect(() => {
    setForegroundRefreshHold(session !== null);
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
    if (!presentsNativeFullscreen) return videoCallbacks;
    return {
      ...videoCallbacks,
      onFullscreenPlayerDidPresent: () => setCurtainUp(true),
      onLoad: (data: OnLoadData) => {
        videoCallbacks.onLoad(data);
        if (sessionRef.current) {
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
        setEnded(true);
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
  // kill PiP), so the close decision is deferred one beat: if PiP turned out to be starting,
  // the dismissal is swallowed and the hand-off flag is CONSUMED (one-shot). Consuming it
  // matters: the lib detaches the first PiP session's delegate during that same cleanup, so no
  // end-of-PiP signal ever arrives, and a sticky flag would suppress every later close — the
  // "can't leave the player" trap. Dismissals after the hand-off window (e.g. manual expand →
  // ✕ on the inline player) close normally. Phone only; tvOS never presents.
  const pipHandoffArmedRef = useRef(false);
  const pipHandoffUntilRef = useRef(0);
  const pendingCloseRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const handlePresentationDismiss = useCallback(() => {
    logger.info("Player host: presentation dismissed", { service: "PlayerHost", programmatic: programmaticDismissRef.current, hasSession: sessionRef.current !== null });
    if (!sessionRef.current || programmaticDismissRef.current) return;
    if (Date.now() < pipHandoffUntilRef.current) return; // duplicate event from the hand-off burst
    if (pendingCloseRef.current) clearTimeout(pendingCloseRef.current);
    pendingCloseRef.current = setTimeout(() => {
      pendingCloseRef.current = null;
      if (pipHandoffArmedRef.current) {
        pipHandoffUntilRef.current = Date.now() + 1500;
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
    }, 250);
  }, [endSession, handlersRef]);

  const restoreRearmRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    return () => {
      if (pendingCloseRef.current) clearTimeout(pendingCloseRef.current);
      if (restoreRearmRef.current) clearTimeout(restoreRearmRef.current);
    };
  }, []);

  const handlePipStatusChanged = useCallback(
    ({ isActive }: OnPictureInPictureStatusChangedData) => {
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

  // The one JS Menu handler in the app. Focus is in AVKit's transport, a child of
  // the root view rather than the navigator, so nothing native pops the route and
  // nothing native can race this. Off unless the host owns the screen; with the
  // transport bar up, Menu is AVKit's own close gesture.
  useEffect(() => {
    if (!Platform.isTV || !hostVisible) return;
    TVEventControl.enableTVMenuKey();
    return () => TVEventControl.disableTVMenuKey();
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
      logger.info("Player host: starting session", { service: "PlayerHost", videoName: next.videoName });
      setCurtainUp(false);
      setEnded(false);
      setPip("none");
      pipHandoffArmedRef.current = false;
      programmaticDismissRef.current = false;
      applySession(next);
    },
    [applySession, setPip],
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
        // The whole point of this host: on tvOS a live PiP window outlives the
        // route that started it, and the app stays browsable around it.
        if (Platform.isTV && pipRef.current === "active") {
          logger.info("Player host: route popped, PiP window keeps playing", { service: "PlayerHost" });
          setPip("detached");
          return;
        }
        endSession();
      },
      stopSession: () => {
        applyPending(null);
        endSession();
      },
      signalRoutePresented: () => {
        if (!pendingRestoreRef.current) return;
        pendingRestoreRef.current = false;
        answerRestore();
      },
      setTvConfig,
      pause,
      retry,
    }),
    [answerRestore, applyPending, applySession, endSession, pause, retry, setPip],
  );

  useEffect(() => {
    registerHost(bridge);
    return () => registerHost(null);
  }, [registerHost, bridge]);

  return (
    <DismissPan onDismiss={handleDismissGesture} style={hostVisible ? styles.stage : styles.offstage} pointerEvents={hostVisible ? "auto" : "none"}>
      {session !== null && sourceUri && (
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
          onInfoPanelItemSelected={(event) => handlersRef.current?.onInfoPanelItemSelected(event)}
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
    backgroundColor: "#000000",
  },
  // Parked, never unmounted: the AVPlayer has to keep running for PiP and for a
  // stream that is still resolving, and neither needs a visible view. Off screen
  // rather than zero-sized or hidden, so it cannot occlude tvOS focus.
  offstage: {
    position: "absolute",
    left: -10000,
    top: -10000,
    width: 1,
    height: 1,
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
});
