import { getSends, subscribeSends } from "@/services/diagnosticsInbox";
import type { SentSession } from "@/services/diagnosticsOutbox";
import { useSyncExternalStore } from "react";

/** The sends the inbox has read off the server, newest first, live as the inbox refreshes. */
export function useSentSessions(): SentSession[] {
  return useSyncExternalStore(subscribeSends, getSends, getSends);
}
