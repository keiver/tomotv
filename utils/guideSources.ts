/** Wording and numbers the Guide Sources screens show for one guide, kept pure so both screens and tests share them. */
import type { GuideSourceStatus } from "@/services/externalGuide";
import type { StringKey } from "@/services/i18n/strings";
import { formatClock, formatDayLabel } from "@/utils/guide";

type Translate = (key: StringKey) => string;

/** A guide's URL as a row title: scheme and trailing slash dropped, host and path kept. */
export function guideLabel(url: string): string {
  return url.replace(/^https?:\/\//i, "").replace(/\/+$/, "");
}

/** The host alone, for a screen title. */
export function guideHost(url: string): string {
  return guideLabel(url).split("/")[0];
}

/** "Today 14:40", "Monday 09:12": when the guide file last landed. */
export function guideUpdatedAt(loadedAt: number, nowMs: number, tr: Translate): string {
  return `${formatDayLabel(loadedAt, nowMs, { today: tr("liveTv.today"), tomorrow: tr("liveTv.tomorrow") })} ${formatClock(loadedAt)}`;
}

/** The row's second line and meter: what the guide is doing now, else what it has matched. */
export function guideSourceSummary(status: GuideSourceStatus | undefined, enabled: boolean, tr: Translate): { subtitle: string; meter?: number } {
  if (!enabled) return { subtitle: tr("liveTv.guideOff") };
  if (!status || status.state === "waiting") return { subtitle: tr("liveTv.guideWaiting") };
  if (status.state === "downloading") {
    return status.progress === null ? { subtitle: tr("liveTv.guideDownloading") } : { subtitle: tr("liveTv.guideDownloadingPercent").replace("{percent}", String(Math.round(status.progress * 100))) };
  }
  if (status.state === "reading") return { subtitle: tr("liveTv.guideParsing") };
  if (status.state === "error") return { subtitle: tr("liveTv.guideUnavailable") };
  if (status.asked === 0)
    return {
      subtitle: tr("liveTv.guideContents")
        .replace("{channels}", String(status.channels ?? 0))
        .replace("{programmes}", String(status.programmes ?? 0)),
    };
  return {
    subtitle: tr("liveTv.guideMatched").replace("{matched}", String(status.matched.length)).replace("{asked}", String(status.asked)),
    meter: status.matched.length / status.asked,
  };
}
