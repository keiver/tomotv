import { usePlayerSession, usePlayerSessionHost, type HostMode } from "@/contexts/PlayerSessionContext";
import { subscribeMacKeyCommand } from "@/services/macKeyCommands";
import { IS_MAC } from "@/utils/hostEnvironment";
import { logger } from "@/utils/logger";
import { router } from "expo-router";
import { useEffect, useRef } from "react";

/** What one Escape press means, given what is on screen. */
export type EscapeAction = "leavePlayer" | "endSession" | "goBack" | "ignore";

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
 * Escape as the back key on the Mac, where the player is inline and carries no ✕
 * and no Menu button.
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
  const { hostMode, stopSession } = usePlayerSession();
  const { handlersRef } = usePlayerSessionHost();

  // Read when a key arrives rather than resubscribed on every playback state change.
  const hostModeRef = useRef(hostMode);
  useEffect(() => {
    hostModeRef.current = hostMode;
  }, [hostMode]);

  useEffect(() => {
    // Deps are stable (a ref, and a useCallback with no deps), so this subscribes once.
    return subscribeMacKeyCommand(() => {
      const action = escapeAction(hostModeRef.current, handlersRef.current !== null, router.canGoBack());
      logger.info("Mac keyboard: escape", { service: "MacKeyCommands", action });
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
        case "ignore":
          return;
      }
    });
  }, [handlersRef, stopSession]);

  return null;
}
