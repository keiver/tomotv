import { useAuth } from "@/contexts/AuthContext";
import { checkInbox, clearSends, markSeen, refreshSends } from "@/services/diagnosticsInbox";
import { buildLog, logText } from "@/services/diagnosticsLog";
import { type SentSession } from "@/services/diagnosticsOutbox";
import { mailLog } from "@/services/diagnosticsShare";
import { isPlaybackHeld } from "@/services/playbackHold";
import { describePlayback } from "@/services/playbackStory";
import { logger } from "@/utils/logger";
import { useRouter } from "expo-router";
import { useEffect } from "react";
import { Alert, AppState, Platform } from "react-native";

const IS_TV = Platform.isTV;
// Two seconds: a send from the Apple TV has to land while the viewer is still looking at it.
// One small authenticated read each, and none while playback holds the link.
const POLL_MS = 2_000;

/**
 * Watches the account's diagnostics slots on the phone and offers a session an Apple TV sent,
 * once: on sign-in, on every foreground, and every two seconds in between. Never over the player.
 */
export function DiagnosticsInbox() {
  const { isConnected } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (IS_TV) return;
    if (!isConnected) {
      clearSends();
      return;
    }
    let active = true;
    let busy = false;

    const offer = (found: SentSession) => {
      const story = describePlayback(found.session, found.device, false);
      const text = logText(buildLog(found.session, found.session), story);
      const when = new Date(found.sentAt).toLocaleString([], { dateStyle: "medium", timeStyle: "short" });
      Alert.alert(`Diagnostics from your ${found.device}`, `Received ${when}. ${story}`, [
        { text: "Not now", style: "cancel" },
        { text: "Email", onPress: () => void mailLog(text, `Tomo TV diagnostics, ${found.device}`).catch((error) => logger.warn("Mail unavailable", error, { service: "DiagnosticsInbox" })) },
        { text: "View", onPress: () => router.push({ pathname: "/diagnostics", params: { sender: found.sender } }) },
      ]);
    };

    const check = async () => {
      if (busy || isPlaybackHeld()) return;
      busy = true;
      try {
        await refreshSends();
        if (!active) return;
        const found = await checkInbox();
        if (!active || !found) return;
        await markSeen(found.sender, found.sentAt);
        offer(found);
      } finally {
        busy = false;
      }
    };

    void check();
    const timer = setInterval(() => void check(), POLL_MS);
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") void check();
    });
    return () => {
      active = false;
      clearInterval(timer);
      subscription.remove();
    };
  }, [isConnected, router]);

  return null;
}
