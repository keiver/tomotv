import React, { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from "react";
import type { ReactVideoProps } from "react-native-video";

import type { SubtitleAlignment } from "@keiver/tomo-engine";
import type { ActiveTextSubtitle, VideoPlayerState } from "@/hooks/useVideoPlayback";
import type { MediaSegmentWindow } from "@/services/jellyfinApi";
import { logger } from "@/utils/logger";

/**
 * The protocol between PlayerHost and the screen that owns its session (the /player route, or Live TV's pinned channel). The route drives
 * playback through these commands and renders from the state the host publishes.
 */

export type HostMode =
  | "idle" // no session; nothing mounted
  | "loading" // session requested, stream not resolved yet
  | "video" // playing (or buffering over) video, host owns the screen
  | "error" // playback failed; the route's error UI owns the screen
  | "pip-active" // PiP window up, route still mounted
  | "pip-detached"; // PiP window up, route popped: the reason this host exists

/** The AVKit surfaces and segment skips the route computes and the host applies. */
export interface PlayerTvConfig {
  skipWindows?: readonly MediaSegmentWindow[];
  contentProposal?: ReactVideoProps["contentProposal"];
  contextualActions?: ReactVideoProps["contextualActions"];
  infoPanelItems?: ReactVideoProps["infoPanelItems"];
  infoPanelTitle?: ReactVideoProps["infoPanelTitle"];
  /** Live channel flipping: the neighbours AVKit's interstitial names; unset disables the gesture. */
  liveChannelFlip?: ReactVideoProps["liveChannelFlip"];
  /** Custom buttons in the transport bar's control row (the favorite heart). */
  transportBarButtons?: ReactVideoProps["transportBarButtons"];
}

export interface PlayerSessionRequest {
  videoId: string;
  /** Carried so the host can re-push /player itself when PiP asks to restore. */
  videoName?: string;
  /** Resume position the launching screen already displayed. */
  startPositionTicks?: number;
  /** Played flag the launching screen already displayed. */
  playedAtStart?: boolean;
  /** Regression-suite deep links pass probe=1 or the driver's URL. */
  probe?: string;
  /** Deep-link nonce of the requesting body; a new one for the same item restarts it. */
  sessionKey: string;
  /** Set by the host's own restore push: adopt the live session, never restart. */
  adopt?: boolean;
  /** A Live TV channel: the player keeps one AVKit instance across channel flips. */
  isLive?: boolean;
  /** A queue advance: under a PiP window the item swaps inside the one player. */
  advance?: boolean;
  /** An item of the play queue: a window with no route left rolls into the next one itself. */
  queueMode?: boolean;
  /** Plays with AVKit's controls in the frame the screen reports (setInlineFrame), instead of AVKit's presented player. */
  inline?: boolean;
}

/** Where an inline player draws, in window coordinates. */
export interface InlineFrame {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Which session a route believes it owns. */
export interface PlayerSessionOwner {
  videoId: string;
  sessionKey: string;
}

/** Registered apart from the request: these change identity on every render. */
export interface PlayerSessionHandlers {
  onPlaybackEnd: () => void;
  onContentProposalAccepted: () => void;
  onContentProposalRejected: () => void;
  onInfoPanelItemSelected: (event: { id: string }) => void;
  /** tvOS live channel flip: +1 next, -1 previous. */
  onSkipChannel: (direction: 1 | -1) => void;
  /** tvOS transport bar custom button press, by the button's id. */
  onTransportBarButtonSelected: (event: { id: string }) => void;
  /** Leave the player: the phone's ✕/swipe, and the tvOS Menu press. */
  onRequestBack: () => void;
  /** A PiP window took the video: leave the player, keeping the session and its queue for the window. */
  onPipStarted?: () => void;
}

/** State the host publishes for the route to render from. */
export interface PlayerSessionSnapshot {
  hostMode: HostMode;
  sessionVideoId: string | null;
  playbackState: VideoPlayerState;
  showLoadingOverlay: boolean;
  /** True once a stream URL exists, i.e. AVKit has chrome of its own on screen. */
  hasStream: boolean;
  /** The text rendition of ours the viewer has on, or null. */
  activeTextSubtitle: ActiveTextSubtitle | null;
}

export type { ActiveTextSubtitle };

/** The imperative surface PlayerHost registers on mount. */
export interface PlayerHostBridge {
  /** Play this item, adopt it if already playing, or switch to it. */
  requestSession: (request: PlayerSessionRequest) => void;
  /** Swap the playing live channel in place, keeping the player. `picked`: chosen from a list, not swiped to. */
  switchLiveChannel: (target: { videoId: string; videoName?: string; picked?: boolean }) => void;
  /** Named by what it played: an advance overlaps two screens for a commit. */
  releaseRoute: (owner: PlayerSessionOwner) => void;
  stopSession: () => void;
  signalRoutePresented: () => void;
  setTvConfig: (config: PlayerTvConfig) => void;
  pause: () => void;
  retry: () => void;
  /** Rebuilds the running session at the playhead, so a subtitle just saved or kept is listed; `selectSubtitleStream` turns that rendition on. */
  reloadSubtitles: (selectSubtitleStream?: number) => void;
  /** Moves a text track's cues in the running session by `offsetMs`. */
  applySubtitleTimeOffset: (streamIndex: number, offsetMs: number) => void;
  /** Lines a text track up with the speech in the running session; `attempt` moves the window along the file. */
  alignSubtitleTiming: (streamIndex: number, attempt: number) => Promise<SubtitleAlignment>;
  /** Relative seek, for the hardware keyboard. The AVKit chrome owns every other scrub. */
  seekBy: (offsetSeconds: number) => void;
  /** Play or pause, for the hardware keyboard. */
  togglePlay: () => void;
  /** Letterbox off and on again: the Mac's double click. */
  toggleVideoFill: () => void;
  /** Where an inline session plays; null parks it, still playing, while the screen shows none. */
  setInlineFrame: (frame: InlineFrame | null) => void;
  /** Drawn over an inline session's picture, never over the presented player; null draws nothing. */
  setInlineOverlay: (overlay: ReactNode | null) => void;
  /** An inline session plays without sound; an item that is not inline always has its sound. */
  setInlineMuted: (muted: boolean) => void;
  /** An inline session goes to AVKit's presented player. */
  presentFullscreen: () => void;
}

interface PlayerSessionContextValue extends PlayerSessionSnapshot, PlayerHostBridge {
  setHandlers: (handlers: PlayerSessionHandlers | null) => void;
  /** Unregisters these handlers, and only these: a screen that took over keeps its own. */
  clearHandlers: (handlers: PlayerSessionHandlers) => void;
}

const IDLE_SNAPSHOT: PlayerSessionSnapshot = {
  hostMode: "idle",
  sessionVideoId: null,
  playbackState: { type: "IDLE" },
  showLoadingOverlay: false,
  hasStream: false,
  activeTextSubtitle: null,
};

const PlayerSessionContext = createContext<PlayerSessionContextValue | undefined>(undefined);

interface PlayerSessionHostValue {
  registerHost: (bridge: PlayerHostBridge | null) => void;
  publish: React.Dispatch<React.SetStateAction<PlayerSessionSnapshot>>;
  handlersRef: React.RefObject<PlayerSessionHandlers | null>;
}

const PlayerSessionHostContext = createContext<PlayerSessionHostValue | undefined>(undefined);

export function PlayerSessionProvider({ children }: { children: ReactNode }) {
  const [snapshot, setSnapshot] = useState<PlayerSessionSnapshot>(IDLE_SNAPSHOT);

  // Refs, not state: registering the host or swapping the route's handlers must
  // never re-render this provider, which sits above the whole navigator.
  const bridgeRef = useRef<PlayerHostBridge | null>(null);
  const handlersRef = useRef<PlayerSessionHandlers | null>(null);

  /**
   * The route can command the host before the host exists.
   *
   * PlayerHost is rendered after the navigator (app/_layout.tsx) because a view above a
   * focusable occludes it on tvOS, so on the one commit that mounts both (a launch whose
   * initial route is already /player, i.e. every deep link and every Top Shelf selection
   * into a cold app) the route's effects run first and find a null bridge. The commands
   * that describe INTENT are held here and replayed at registration; the rest need a live
   * host by definition. Nothing in this file may depend on mount order.
   */
  const pendingRef = useRef<{
    request?: PlayerSessionRequest;
    tvConfig?: PlayerTvConfig;
    routePresented?: boolean;
    inlineFrame?: InlineFrame | null;
    inlineOverlay?: ReactNode | null;
    inlineMuted?: boolean;
  }>({});

  const registerHost = useCallback((bridge: PlayerHostBridge | null) => {
    bridgeRef.current = bridge;
    if (!bridge) return;
    const pending = pendingRef.current;
    pendingRef.current = {};
    // Session first: the config and the presentation signal both describe it.
    if (pending.request) bridge.requestSession(pending.request);
    if (pending.tvConfig) bridge.setTvConfig(pending.tvConfig);
    if (pending.routePresented) bridge.signalRoutePresented();
    if (pending.inlineFrame !== undefined) bridge.setInlineFrame(pending.inlineFrame);
    if (pending.inlineOverlay !== undefined) bridge.setInlineOverlay(pending.inlineOverlay);
    if (pending.inlineMuted !== undefined) bridge.setInlineMuted(pending.inlineMuted);
  }, []);

  /** Commands that only mean something while a host is live. A miss is a bug, not a state. */
  const withHost = useCallback((command: string, call: (bridge: PlayerHostBridge) => void) => {
    const bridge = bridgeRef.current;
    if (!bridge) {
      logger.warn("Player command dropped, no host registered", { service: "PlayerSession", command });
      return;
    }
    call(bridge);
  }, []);

  const setHandlers = useCallback((handlers: PlayerSessionHandlers | null) => {
    handlersRef.current = handlers;
  }, []);
  const clearHandlers = useCallback((handlers: PlayerSessionHandlers) => {
    if (handlersRef.current === handlers) handlersRef.current = null;
  }, []);

  // Latest wins for all three: they are the current intent, not a log of calls.
  const requestSession = useCallback((request: PlayerSessionRequest) => {
    const bridge = bridgeRef.current;
    if (!bridge) {
      pendingRef.current.request = request;
      return;
    }
    bridge.requestSession(request);
  }, []);
  const setTvConfig = useCallback((config: PlayerTvConfig) => {
    const bridge = bridgeRef.current;
    if (!bridge) {
      pendingRef.current.tvConfig = config;
      return;
    }
    bridge.setTvConfig(config);
  }, []);
  const signalRoutePresented = useCallback(() => {
    const bridge = bridgeRef.current;
    if (!bridge) {
      pendingRef.current.routePresented = true;
      return;
    }
    bridge.signalRoutePresented();
  }, []);

  const releaseRoute = useCallback(
    (owner: PlayerSessionOwner) => {
      // A route that leaves before the host arrives takes its unstarted request with it,
      // and there is nothing else to release.
      const pending = pendingRef.current;
      if (pending.request && pending.request.videoId === owner.videoId && pending.request.sessionKey === owner.sessionKey) {
        pendingRef.current = {};
        return;
      }
      withHost("releaseRoute", (bridge) => bridge.releaseRoute(owner));
    },
    [withHost],
  );
  // Stopping what never started is the no-op it looks like, so this one stays quiet.
  const stopSession = useCallback(() => {
    pendingRef.current = {};
    bridgeRef.current?.stopSession();
  }, []);
  const switchLiveChannel = useCallback((target: { videoId: string; videoName?: string; picked?: boolean }) => withHost("switchLiveChannel", (bridge) => bridge.switchLiveChannel(target)), [withHost]);
  const pause = useCallback(() => withHost("pause", (bridge) => bridge.pause()), [withHost]);
  const retry = useCallback(() => withHost("retry", (bridge) => bridge.retry()), [withHost]);
  const reloadSubtitles = useCallback((selectSubtitleStream?: number) => withHost("reloadSubtitles", (bridge) => bridge.reloadSubtitles(selectSubtitleStream)), [withHost]);
  const alignSubtitleTiming = useCallback(
    (streamIndex: number, attempt: number): Promise<SubtitleAlignment> => bridgeRef.current?.alignSubtitleTiming(streamIndex, attempt) ?? Promise.resolve({ ok: false, reason: "noSession" }),
    [],
  );
  const applySubtitleTimeOffset = useCallback(
    (streamIndex: number, offsetMs: number) => withHost("applySubtitleTimeOffset", (bridge) => bridge.applySubtitleTimeOffset(streamIndex, offsetMs)),
    [withHost],
  );
  const seekBy = useCallback((offsetSeconds: number) => withHost("seekBy", (bridge) => bridge.seekBy(offsetSeconds)), [withHost]);
  const togglePlay = useCallback(() => withHost("togglePlay", (bridge) => bridge.togglePlay()), [withHost]);
  const toggleVideoFill = useCallback(() => withHost("toggleVideoFill", (bridge) => bridge.toggleVideoFill()), [withHost]);
  const setInlineFrame = useCallback((frame: InlineFrame | null) => {
    const bridge = bridgeRef.current;
    if (!bridge) {
      pendingRef.current.inlineFrame = frame;
      return;
    }
    bridge.setInlineFrame(frame);
  }, []);
  const setInlineOverlay = useCallback((overlay: ReactNode | null) => {
    const bridge = bridgeRef.current;
    if (!bridge) {
      pendingRef.current.inlineOverlay = overlay;
      return;
    }
    bridge.setInlineOverlay(overlay);
  }, []);
  const setInlineMuted = useCallback((muted: boolean) => {
    const bridge = bridgeRef.current;
    if (!bridge) {
      pendingRef.current.inlineMuted = muted;
      return;
    }
    bridge.setInlineMuted(muted);
  }, []);
  const presentFullscreen = useCallback(() => withHost("presentFullscreen", (bridge) => bridge.presentFullscreen()), [withHost]);

  const value = useMemo(
    () => ({
      ...snapshot,
      requestSession,
      switchLiveChannel,
      releaseRoute,
      stopSession,
      signalRoutePresented,
      setTvConfig,
      pause,
      retry,
      reloadSubtitles,
      applySubtitleTimeOffset,
      alignSubtitleTiming,
      seekBy,
      togglePlay,
      toggleVideoFill,
      setInlineFrame,
      setInlineOverlay,
      setInlineMuted,
      presentFullscreen,
      setHandlers,
      clearHandlers,
    }),
    [
      snapshot,
      requestSession,
      switchLiveChannel,
      releaseRoute,
      stopSession,
      signalRoutePresented,
      setTvConfig,
      pause,
      retry,
      reloadSubtitles,
      applySubtitleTimeOffset,
      alignSubtitleTiming,
      seekBy,
      togglePlay,
      toggleVideoFill,
      setInlineFrame,
      setInlineOverlay,
      setInlineMuted,
      presentFullscreen,
      setHandlers,
      clearHandlers,
    ],
  );

  const hostValue = useMemo(() => ({ registerHost, publish: setSnapshot, handlersRef }), [registerHost]);

  return (
    <PlayerSessionContext.Provider value={value}>
      <PlayerSessionHostContext.Provider value={hostValue}>{children}</PlayerSessionHostContext.Provider>
    </PlayerSessionContext.Provider>
  );
}

/** Route side: drive playback and read what to render. */
export function usePlayerSession() {
  const context = useContext(PlayerSessionContext);
  if (context === undefined) {
    throw new Error("usePlayerSession must be used within a PlayerSessionProvider");
  }
  return context;
}

/** Host side: register the bridge, publish state, reach the route's handlers. */
export function usePlayerSessionHost() {
  const context = useContext(PlayerSessionHostContext);
  if (context === undefined) {
    throw new Error("usePlayerSessionHost must be used within a PlayerSessionProvider");
  }
  return context;
}
