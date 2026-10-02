/** Wording and numbers the Guide Sources screens show for one guide, kept pure so both screens and tests share them. */
import type { GuideSourceStatus } from "@/services/externalGuide";
import type { StringKey } from "@/services/i18n/strings";
import type { MatchVia } from "@/utils/guideMatch";
import { formatClock, formatDayLabel } from "@/utils/guide";

type Translate = (key: StringKey) => string;

/** A guide's URL as a row title: scheme and trailing slash dropped, host and path kept. */
export function guideLabel(url: string): string {
  return url.replace(/^https?:\/\//i, "").replace(/\/+$/, "");
}

/** Where a guide comes from: the viewer added it, and/or the tuner playlists that declare it. */
export function guideOrigin(url: string, ownUrls: readonly string[], declaredBy: Readonly<Record<string, readonly string[]>>): { own: boolean; playlists: readonly string[] } {
  return { own: ownUrls.includes(url), playlists: declaredBy[url] ?? [] };
}

/** Every channel asked of a guide, the paired ones first, each run by name; `via` is null for a miss. */
export function guideChannelRows(status: GuideSourceStatus | undefined): { channelId: string; name: string; via: MatchVia | null }[] {
  const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name);
  const matched = [...(status?.matched ?? [])].sort(byName);
  const missed = [...(status?.unmatched ?? [])].sort(byName).map((channel) => ({ ...channel, via: null }));
  return [...matched, ...missed];
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
