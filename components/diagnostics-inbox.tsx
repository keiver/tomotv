import { useAuth } from "@/contexts/AuthContext";
import { clearSends, pokeInbox, setInboxOffer } from "@/services/diagnosticsInbox";
import { buildLog, logText } from "@/services/diagnosticsLog";
import { type SentSession } from "@/services/diagnosticsOutbox";
import { mailLog } from "@/services/diagnosticsShare";
import { describePlayback } from "@/services/playbackStory";
import { logger } from "@/utils/logger";
import { useRouter } from "expo-router";
import { useEffect } from "react";
import { Alert, AppState, Platform } from "react-native";

const IS_TV = Platform.isTV;

/**
 * Arms the inbox on the phone and offers a session an Apple TV sent, once. The reads happen on
 * sign-in and on every foreground here, and on the Settings tab as it is looked at; nothing runs
 * on a timer, and nothing runs over the player.
 */
export function DiagnosticsInbox() {
  const { isConnected } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (IS_TV) return;
    if (!isConnected) {
      setInboxOffer(null);
      clearSends();
      return;
    }

    setInboxOffer((found: SentSession) => {
      const story = describePlayback(found.session, found.device, false);
      const text = logText(buildLog(found.session, found.session), story);
      const when = new Date(found.sentAt).toLocaleString([], { dateStyle: "medium", timeStyle: "short" });
      Alert.alert(`Diagnostics from your ${found.device}`, `Received ${when}. ${story}`, [
        { text: "Not now", style: "cancel" },
        { text: "Email", onPress: () => void mailLog(text, `Tomo TV diagnostics, ${found.device}`).catch((error) => logger.warn("Mail unavailable", error, { service: "DiagnosticsInbox" })) },
        { text: "View", onPress: () => router.push({ pathname: "/diagnostics", params: { sender: found.sender } }) },
      ]);
    });

    void pokeInbox(true);
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") void pokeInbox(true);
    });
    return () => {
      subscription.remove();
      setInboxOffer(null);
    };
  }, [isConnected, router]);

  return null;
}
