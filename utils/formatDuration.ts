import { t } from "@/services/i18n";
import { JELLYFIN_TIME } from "@/services/jellyfin/constants";

/** "1h 23m" or "45m" in the active language's units, from RunTimeTicks (100-nanosecond intervals). */
export function formatDuration(ticks: number): string {
  const totalMinutes = Math.floor(ticks / JELLYFIN_TIME.TICKS_PER_SECOND / 60);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours > 0) return t("common.durationHoursMinutes").replace("{hours}", String(hours)).replace("{minutes}", String(minutes));
  return t("common.durationMinutes").replace("{minutes}", String(minutes));
}
