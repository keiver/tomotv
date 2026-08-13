import React, { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from "react";
import type { ReactVideoProps } from "react-native-video";

import type { VideoPlayerState } from "@/hooks/useVideoPlayback";

/**
 * The protocol between the /player route and PlayerHost. The route drives
 * playback through these commands and renders from the state the host publishes.
 */

export type HostMode =
  | "idle" // no session; nothing mounted
  | "loading" // session requested, stream not resolved yet
  | "video" // playing (or buffering over) video, host owns the screen
  | "error" // playback failed; the route's error UI owns the screen
  | "pip-active" // PiP window up, route still mounted
  | "pip-detached"; // PiP window up, route popped — the reason this host exists

/** tvOS AVKit surfaces the route computes and the host hands to <Video>. */
export interface PlayerTvConfig {
  contentProposal?: ReactVideoProps["contentProposal"];
  contextualActions?: ReactVideoProps["contextualActions"];
  infoPanelItems?: ReactVideoProps["infoPanelItems"];
}

export interface PlayerSessionRequest {
  videoId: string;
  /** Carried so the host can re-push /player itself when PiP asks to restore. */
  videoName?: string;
  /** Resume position the launching screen already displayed. */
  startPositionTicks?: number;
  /** Played flag the launching screen already displayed. */
  playedAtStart?: boolean;
  /** Regression-suite deep links pass probe=1. */
  probe?: boolean;
  /** Deep-link nonce of the requesting body; a new one for the same item restarts it. */
  sessionKey: string;
  /** Set by the host's own restore push: adopt the live session, never restart. */
  adopt?: boolean;
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
  /** Leave the player: the phone's ✕/swipe, and the tvOS Menu press. */
  onRequestBack: () => void;
}

/** State the host publishes for the route to render from. */
export interface PlayerSessionSnapshot {
  hostMode: HostMode;
  sessionVideoId: string | null;
  playbackState: VideoPlayerState;
  showLoadingOverlay: boolean;
  /** True once a stream URL exists, i.e. AVKit has chrome of its own on screen. */
  hasStream: boolean;
}

/** The imperative surface PlayerHost registers on mount. */
export interface PlayerHostBridge {
  /** Play this item, adopt it if already playing, or switch to it. */
  requestSession: (request: PlayerSessionRequest) => void;
  /** Named by what it played: an advance overlaps two screens for a commit. */
  releaseRoute: (owner: PlayerSessionOwner) => void;
  stopSession: () => void;
  signalRoutePresented: () => void;
  setTvConfig: (config: PlayerTvConfig) => void;
  pause: () => void;
  retry: () => void;
}

interface PlayerSessionContextValue extends PlayerSessionSnapshot, PlayerHostBridge {
  setHandlers: (handlers: PlayerSessionHandlers | null) => void;
}

const IDLE_SNAPSHOT: PlayerSessionSnapshot = {
  hostMode: "idle",
  sessionVideoId: null,
  playbackState: { type: "IDLE" },
  showLoadingOverlay: false,
  hasStream: false,
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

  const registerHost = useCallback((bridge: PlayerHostBridge | null) => {
    bridgeRef.current = bridge;
  }, []);

  const setHandlers = useCallback((handlers: PlayerSessionHandlers | null) => {
    handlersRef.current = handlers;
  }, []);

  const requestSession = useCallback((request: PlayerSessionRequest) => bridgeRef.current?.requestSession(request), []);
  const releaseRoute = useCallback((owner: PlayerSessionOwner) => bridgeRef.current?.releaseRoute(owner), []);
  const stopSession = useCallback(() => bridgeRef.current?.stopSession(), []);
  const signalRoutePresented = useCallback(() => bridgeRef.current?.signalRoutePresented(), []);
  const setTvConfig = useCallback((config: PlayerTvConfig) => bridgeRef.current?.setTvConfig(config), []);
  const pause = useCallback(() => bridgeRef.current?.pause(), []);
  const retry = useCallback(() => bridgeRef.current?.retry(), []);

  const value = useMemo(
    () => ({
      ...snapshot,
      requestSession,
      releaseRoute,
      stopSession,
      signalRoutePresented,
      setTvConfig,
      pause,
      retry,
      setHandlers,
    }),
    [snapshot, requestSession, releaseRoute, stopSession, signalRoutePresented, setTvConfig, pause, retry, setHandlers],
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
