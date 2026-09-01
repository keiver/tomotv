import { usePlayerSession, usePlayerSessionHost, type HostMode } from "@/contexts/PlayerSessionContext";
import { audioPlayerManager } from "@/services/audioPlayerManager";
import { claimMacContextKeys, MAC_SEEK_SECONDS, subscribeMacKeyCommand, type MacKey } from "@/services/macKeyCommands";
import { IS_MAC } from "@/utils/hostEnvironment";
import { logger } from "@/utils/logger";
import { router } from "expo-router";
import { useEffect, useRef } from "react";

/** What one Escape press means, given what is on screen. */
export type EscapeAction = "leavePlayer" | "endSession" | "goBack" | "ignore";

/** What any press means. Escape keeps its own rule; the rest fold into this one. */
export type MacKeyAction = EscapeAction | "openSearch" | "openSettings" | "togglePlay" | "previousTrack" | "nextTrack" | "seekBackward" | "seekForward";

/** What the rule reads: the session, the navigator, and whether a queue is running. */
export interface MacKeyState {
  hostMode: HostMode;
  hasRouteHandlers: boolean;
  canGoBack: boolean;
  audioActive: boolean;
}

/**
 * The rule, exported so it can be read and tested on its own — the same reason
 * leavingByPan is exported from dismiss-pan.tsx, and it decides the same thing:
 * whether a live session is about to be torn down.
 *
 * A session always wins over the navigator. Escape out of the player has to end
 * the player, never pop whatever route is sitting behind it.
 */
export function escapeAction(hostMode: HostMode, hasRouteHandlers: boolean, canGoBack: boolean): EscapeAction {
  if (hostMode !== "idle") return hasRouteHandlers ? "leavePlayer" : "endSession";
  return canGoBack ? "goBack" : "ignore";
}

/**
 * The rule for every key, exported for the same reason escapeAction is.
 *
 * Two invariants: a live session outranks the navigator, so no press pushes a tab
 * under a presented player; and transport is the audio queue's, so with no queue
 * running the press belongs to AVKit or to nobody.
 */
export function macKeyAction(key: MacKey, state: MacKeyState): MacKeyAction {
  switch (key) {
    case "escape":
      return escapeAction(state.hostMode, state.hasRouteHandlers, state.canGoBack);
    case "search":
      return state.hostMode === "idle" ? "openSearch" : "ignore";
    case "settings":
      return state.hostMode === "idle" ? "openSettings" : "ignore";
    case "playPause":
      return state.audioActive || state.hostMode !== "idle" ? "togglePlay" : "ignore";
    case "previousTrack":
      return state.audioActive ? "previousTrack" : "ignore";
    case "nextTrack":
      return state.audioActive ? "nextTrack" : "ignore";
    // Bare arrows reach JS only while a screen has claimed them natively. Seek belongs to
    // whatever is playing; the photo keys belong to the viewer, which subscribes itself.
    case "seekBackward":
      return state.audioActive || state.hostMode !== "idle" ? "seekBackward" : "ignore";
    case "seekForward":
      return state.audioActive || state.hostMode !== "idle" ? "seekForward" : "ignore";
    case "previousPhoto":
    case "nextPhoto":
      return "ignore";
  }
}

/**
 * Hardware keys on the Mac, where the player is inline and carries no ✕ and no
 * Menu button.
 *
 * The single subscriber on purpose: two of them would let one press both pop the
 * player and pop the route behind it. Mounted beside PlayerHost, above the
 * navigator, so it reaches the live route's handlers the same way the tvOS Menu
 * handler does (components/player-host.tsx).
 */
export function MacKeyCommands() {
  // A module constant, so this branch is fixed for the process: off a Mac nothing
  // below mounts, no hook runs and no listener is registered.
  if (!IS_MAC) return null;
  return <MacKeyCommandsListener />;
}

function MacKeyCommandsListener() {
  const { hostMode, stopSession, seekBy, togglePlay } = usePlayerSession();
  const { handlersRef } = usePlayerSessionHost();

  // Read when a key arrives rather than resubscribed on every playback state change.
  const hostModeRef = useRef(hostMode);
  useEffect(() => {
    hostModeRef.current = hostMode;
  }, [hostMode]);

  // The contextual keys only exist natively while something wants them, so a grid keeps its
  // arrow scrolling and its focused control keeps Return everywhere else. A live video session
  // wants them; so does a running audio queue, which outlives any route. The photo viewer
  // claims them for itself on top of both.
  useEffect(() => {
    if (hostMode === "idle") return;
    return claimMacContextKeys("player", "seek");
  }, [hostMode]);

  useEffect(() => {
    let release: (() => void) | null = null;
    const apply = (active: boolean) => {
      if (active && !release) release = claimMacContextKeys("audio", "seek");
      else if (!active && release) {
        release();
        release = null;
      }
    };
    apply(audioPlayerManager.getUIState().active);
    const unsubscribe = audioPlayerManager.subscribe((state) => apply(state.active));
    return () => {
      unsubscribe();
      release?.();
    };
  }, []);

  useEffect(() => {
    // Deps are stable (a ref, and a useCallback with no deps), so this subscribes once.
    return subscribeMacKeyCommand((key) => {
      const audio = audioPlayerManager.getUIState();
      const action = macKeyAction(key, {
        hostMode: hostModeRef.current,
        hasRouteHandlers: handlersRef.current !== null,
        canGoBack: router.canGoBack(),
        audioActive: audio.active,
      });
      logger.info("Mac keyboard", { service: "MacKeyCommands", key, action });
      switch (action) {
        case "leavePlayer":
          // Exactly what the drag gesture and the tvOS Menu press do. handleBack in
          // app/player.tsx pops its OWN navigator, which is what keeps a folder from
          // going with it.
          handlersRef.current?.onRequestBack();
          return;
        case "endSession":
          // Nothing listening (a detached window): the session ends itself.
          stopSession();
          return;
        case "goBack":
          router.back();
          return;
        // navigate, not push: expo-router turns a NAVIGATE on the tabs navigator into
        // JUMP_TO (getNavigationAction.js), which leaves the target tab's own stack
        // standing. A repeatable shortcut must not reset Search to an empty screen.
        case "openSearch":
          router.navigate("/(tabs)/search");
          return;
        case "openSettings":
          router.navigate("/(tabs)/settings");
          return;
        // Audio first, same rule as seek: a live queue owns transport, the video session
        // takes it otherwise.
        case "togglePlay":
          if (audio.active) void audioPlayerManager.setPlaying(!audio.playing);
          else togglePlay();
          return;
        case "previousTrack":
          void audioPlayerManager.previous();
          return;
        case "nextTrack":
          void audioPlayerManager.next();
          return;
        // Audio first: its queue player owns its own timeline, and a live audio queue is
        // never the video session.
        case "seekBackward":
          if (audio.active) void audioPlayerManager.seekBy(-MAC_SEEK_SECONDS);
          else seekBy(-MAC_SEEK_SECONDS);
          return;
        case "seekForward":
          if (audio.active) void audioPlayerManager.seekBy(MAC_SEEK_SECONDS);
          else seekBy(MAC_SEEK_SECONDS);
          return;
        case "ignore":
          return;
      }
    });
  }, [handlersRef, stopSession, seekBy, togglePlay]);

  return null;
}
