import { useAuth } from "@/contexts/AuthContext";
import { armInbox, clearSends, pokeInbox } from "@/services/diagnosticsInbox";
import { subscribeAuthChange } from "@/services/jellyfinApi";
import { useEffect } from "react";
import { AppState, Platform } from "react-native";

const IS_TV = Platform.isTV;

/**
 * Arms the inbox on the phone. The reads happen on sign-in and on every foreground here, and
 * on the Settings tab as it is looked at; nothing runs on a timer, and nothing runs over the
 * player. A send is a row under About Tomo TV, never a prompt.
 */
export function DiagnosticsInbox() {
  const { isConnected } = useAuth();

  useEffect(() => {
    if (IS_TV) return;
    if (!isConnected) {
      armInbox(false);
      clearSends();
      return;
    }

    armInbox(true);
    void pokeInbox(true);
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") void pokeInbox(true);
    });
    // A switch of account or server leaves `isConnected` true, so this effect never re-runs for
    // one: the slots read from the account being left are dropped here instead.
    const unsubscribeAuth = subscribeAuthChange(() => {
      clearSends();
      void pokeInbox(true);
    });
    return () => {
      subscription.remove();
      unsubscribeAuth();
      armInbox(false);
    };
  }, [isConnected]);

  return null;
}
