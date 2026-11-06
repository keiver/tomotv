/**
 * The words a job and a hit are shown with, shared by the iOS screen and the tvOS panel.
 */
import { t } from "@/services/i18n";
import { languageFor } from "./languages";
import { queryText } from "./query";
import type { SubtitleSyncState } from "./timing";
import type { SubtitleHit, SubtitleJob, SubtitleSourceId } from "./types";

/** One letter standing for the source, drawn in a row's monogram. */
export const SOURCE_MONOGRAM: Record<SubtitleSourceId, string> = { server: "J", opensubtitles: "O", subdl: "D", subsource: "S", podnapisi: "P", gestdown: "A" };

export function sourceName(source: SubtitleSourceId): string {
  return t(`subtitles.source.${source}`);
}

/** What the state column says for a job: what is searched and in which language, how many results, which pick went where. */
export function jobStateLine(job: SubtitleJob): string {
  const query = queryText(job.query);
  const language = languageFor(job.language)?.native ?? job.language;
  const picked = job.picked?.name ?? "";
  switch (job.status) {
    case "idle":
    case "searching":
      return t("subtitles.searching").replace("{query}", query).replace("{language}", language);
    case "found":
      return job.results.length === 1 ? t("subtitles.oneResult") : t("subtitles.results").replace("{count}", String(job.results.length));
    case "none":
      return t("subtitles.none").replace("{query}", query).replace("{language}", language);
    case "failed":
      return t("subtitles.failed");
    case "applying":
      return t("subtitles.applying").replace("{name}", picked);
    case "applied": {
      if (job.applied?.where === "server") return t("subtitles.savedServer");
      const why = job.applied?.where === "device" ? job.applied.deviceReason : undefined;
      const keys = {
        permission: "subtitles.savedDevicePermission",
        savingOff: "subtitles.savedDeviceSwitch",
        uploadRefused: "subtitles.savedDeviceUpload",
        language: "subtitles.savedDeviceLanguage",
      } as const;
      return t(why ? keys[why] : "subtitles.savedDevice");
    }
  }
}

/** The note under the state when a source refused this session, or null. */
export function jobNoteLine(job: SubtitleJob): string | null {
  if (!job.note) return null;
  const sources = job.note.split(",").filter(Boolean) as SubtitleSourceId[];
  if (sources.length === 0) return null;
  return t("subtitles.sourceDown").replace("{source}", sources.map(sourceName).join(", "));
}

/** The error line after a failed save, naming the pick, or null. */
export function jobErrorLine(job: SubtitleJob): string | null {
  if (!job.error || job.status === "applied") return null;
  if (job.status === "failed") return null;
  if (job.error === "limit") return t("subtitles.downloadLimit");
  if (job.error === "accountLimit") return t("subtitles.accountDownloadLimit");
  return (job.error === "unreadable" ? t("subtitles.unreadable") : t("subtitles.applyFailed")).replace("{name}", job.picked?.name ?? "");
}

/** "On time", "1.5 s late" or "1.5 s early": the line a timing stepper shows for an offset. */
export function offsetLabel(offsetMs: number): string {
  if (offsetMs === 0) return t("subtitles.onTime");
  const seconds = (Math.abs(offsetMs) / 1000).toFixed(1).replace(/\.0$/, "");
  return t(offsetMs > 0 ? "subtitles.late" : "subtitles.early").replace("{seconds}", seconds);
}

/** The line under a subtitle while and after it is matched to the audio; empty when no match ran. */
export function syncStateLine(state: SubtitleSyncState | null | undefined): string {
  if (!state) return "";
  if (state.status === "syncing") return t("subtitles.syncing");
  return t(state.status === "synced" ? "subtitles.synced" : "subtitles.syncFailed");
}

export function hitBadges(hit: SubtitleHit): string[] {
  return [
    hit.hashMatch ? t("subtitles.hashMatch") : "",
    hit.hearingImpaired ? t("subtitles.sdh") : "",
    hit.forced ? t("subtitles.forced") : "",
    hit.machineTranslated ? t("subtitles.machine") : "",
  ].filter(Boolean);
}

/** The author, then the source only when it is not OpenSubtitles, which the panel credits once. */
export function hitByline(hit: SubtitleHit): string {
  return [hit.author, hit.source === "opensubtitles" ? "" : sourceName(hit.source)].filter(Boolean).join(" · ");
}

/** Downloads first, then rating, then the byline. */
export function hitMeta(hit: SubtitleHit): string {
  return [hit.downloads !== null ? t("subtitles.downloads").replace("{count}", String(hit.downloads)) : "", hit.rating !== null ? hit.rating.toFixed(1) : "", hitByline(hit)]
    .filter(Boolean)
    .join(" · ");
}
