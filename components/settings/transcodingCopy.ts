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

/** The server's own setting for this account as one sentence, split around the state word the footer inks. */
export interface ServerTranscodingSentence {
  before: string;
  state: string;
  enabled: boolean;
  after: string;
}

export function serverTranscodingFooter(permissions: TranscodePermissions | null): ServerTranscodingSentence | null {
  if (!permissions) return null;
  // Both alike read as one; when they differ, the one the server turned off is the news.
  const same = permissions.video === permissions.audio;
  const enabled = same && permissions.video;
  const template = same
    ? t("settings.transcoding.serverBoth")
    : t("settings.transcoding.serverOne").replace("{kind}", t(permissions.video ? "settings.transcoding.kindAudio" : "settings.transcoding.kindVideo"));
  const [before, after = ""] = template.split("{state}");
  return { before, state: t(enabled ? "settings.transcoding.enabled" : "settings.transcoding.disabled"), enabled, after };
}

/** The Settings tab row's second line: the server's refusal leads, the device's level otherwise. */
export function transcodingRowSubtitle(level: ServerTranscoding, permissions: TranscodePermissions | null): string {
  return permissions && !permissions.video ? t("settings.transcoding.serverOff") : transcodingLevelTitle(level);
}
