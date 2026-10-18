/** What the connection limit screens show: the chips and each provider row's second line. */
import type { StringKey } from "@/services/i18n/strings";
import { CONNECTION_LIMIT_OPTIONS, type ConnectionLimit } from "@/services/liveTvPreferences";

type Translate = (key: StringKey) => string;

/** Auto first, then the numbers a viewer can set. */
export function limitOptions(tr: Translate): { value: ConnectionLimit | 0; label: string }[] {
  return [{ value: 0, label: tr("liveTv.connectionLimitAuto") }, ...CONNECTION_LIMIT_OPTIONS.map((value) => ({ value, label: String(value) }))];
}

/** A playlist row's second line: "Learned from the provider", or "Up to 2 streams at once". */
export function playlistRowSubtitle(limit: ConnectionLimit | undefined, tr: Translate): string {
  if (limit === undefined) return tr("liveTv.connectionLimitLearned");
  return limit === 1 ? tr("liveTv.connectionLimitStream") : tr("liveTv.connectionLimitStreams").replace("{count}", String(limit));
}

/** The Channels row's second line: how many limits are set, else the hint. */
export function connectionLimitsSubtitle(limits: Readonly<Record<string, ConnectionLimit>>, tr: Translate): string {
  const count = Object.keys(limits).length;
  return count > 0 ? tr("liveTv.connectionLimitsSet").replace("{count}", String(count)) : tr("liveTv.connectionLimitsHint");
}
