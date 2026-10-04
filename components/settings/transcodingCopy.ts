/** The Server transcoding setting's copy: one title and hint per level, and what the server itself allows this account. */
import { t } from "@/services/i18n";
import type { StringKey } from "@/services/i18n/strings";
import type { TranscodePermissions } from "@/services/jellyfin/transcodePermissions";
import type { ServerTranscoding } from "@/services/uiPreferences";

const LEVEL_KEYS: Record<ServerTranscoding, { title: StringKey; hint: StringKey }> = {
  linkOrFile: { title: "settings.transcoding.linkOrFile", hint: "settings.transcoding.linkOrFileHint" },
  fileOnly: { title: "settings.transcoding.fileOnly", hint: "settings.transcoding.fileOnlyHint" },
  never: { title: "settings.transcoding.never", hint: "settings.transcoding.neverHint" },
};

export function transcodingLevelTitle(level: ServerTranscoding): string {
  return t(LEVEL_KEYS[level].title);
}

export function transcodingLevelHint(level: ServerTranscoding): string {
  return t(LEVEL_KEYS[level].hint);
}

/** The server's own setting for this account, as the page's status row states it; null until read. */
export interface ServerTranscodingStatus {
  state: "on" | "off" | "audioOff";
  title: string;
  subtitle: string;
}

export function serverTranscodingStatus(permissions: TranscodePermissions | null): ServerTranscodingStatus | null {
  if (!permissions) return null;
  if (!permissions.video) return { state: "off", title: t("settings.transcoding.serverForbidsVideoTitle"), subtitle: t("settings.transcoding.serverForbidsVideo") };
  if (!permissions.audio) return { state: "audioOff", title: t("settings.transcoding.serverForbidsAudioTitle"), subtitle: t("settings.transcoding.serverForbidsAudio") };
  return { state: "on", title: t("settings.transcoding.serverOn"), subtitle: t("settings.transcoding.serverOnHint") };
}

/** The Settings tab row's second line: the server's refusal leads, the device's level otherwise. */
export function transcodingRowSubtitle(level: ServerTranscoding, permissions: TranscodePermissions | null): string {
  return permissions && !permissions.video ? t("settings.transcoding.serverOff") : transcodingLevelTitle(level);
}
