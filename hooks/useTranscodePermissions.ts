import { getTranscodePermissions, subscribeTranscodePermissions, type TranscodePermissions } from "@/services/jellyfin/transcodePermissions";
import { useSyncExternalStore } from "react";

/** The server's transcoding permissions for this account, following every read. */
export function useTranscodePermissions(): TranscodePermissions | null {
  return useSyncExternalStore(subscribeTranscodePermissions, getTranscodePermissions);
}
