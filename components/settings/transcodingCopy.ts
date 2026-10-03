/** The Server transcoding setting's copy: one title and hint per level, and what the server's own policy adds. */
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

/** What the server forbids this account, in the server's words; null while allowed or unread. */
export function serverTranscodingNotice(permissions: TranscodePermissions | null): string | null {
  if (!permissions) return null;
  if (!permissions.video) return t("settings.transcoding.serverForbidsVideo");
  if (!permissions.audio) return t("settings.transcoding.serverForbidsAudio");
  return null;
}

/** The Settings tab row's second line: the server's refusal leads, the device's level otherwise. */
export function transcodingRowSubtitle(level: ServerTranscoding, permissions: TranscodePermissions | null): string {
  return permissions && !permissions.video ? t("settings.transcoding.serverOff") : transcodingLevelTitle(level);
}
