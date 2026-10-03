/**
 * The Quality page's rows: the preset order, each row's label, and what the row does on the
 * measured connection, off the player's own entry rule (pickStartupIndex).
 */
import { carriedRungs, linkCarriesPreset, ORIGINAL_INDEX, pickStartupIndex, presetNeedsMbps } from "@/services/adaptiveQuality";
import { t } from "@/services/i18n";
import { QUALITY_PRESETS } from "@/services/jellyfin/constants";

/** Original leads: it is the default and the only option that never re-encodes. Each value indexes QUALITY_PRESETS and is what gets persisted. */
export const QUALITY_ROWS: readonly number[] = [5, 4, 3, 2, 1, 0];

export function qualityLabel(value: number): string {
  switch (value) {
    case 5:
      return t("settings.quality.auto");
    case 4:
      return t("settings.quality.max4k");
    case 3:
      return t("settings.quality.max1080");
    case 2:
      return t("settings.quality.max720");
    case 1:
      return t("settings.quality.max540");
    default:
      return t("settings.quality.max480");
  }
}

/** One line, 33 characters at most on a 375pt phone: these rows never wrap. */
export function qualityRowSubtitle(value: number, measuredBps: number | null): string {
  if (value === ORIGINAL_INDEX) {
    if (measuredBps == null) return t("settings.quality.adapts");
    const carried = carriedRungs(measuredBps);
    return carried === 0 ? t("settings.quality.onlyFor").replace("{label}", QUALITY_PRESETS[0].label) : t("settings.quality.upToFor").replace("{label}", QUALITY_PRESETS[carried - 1].label);
  }
  const needs = t("settings.quality.needsMbps").replace("{mbps}", String(presetNeedsMbps(value)));
  if (measuredBps == null) return needs;
  if (linkCarriesPreset(measuredBps, value)) return t("settings.quality.playsFull").replace("{needs}", needs);
  // A pin is a ceiling: the session opens at the rung the link carries and climbs toward it.
  const opensAt = pickStartupIndex(measuredBps, value, null);
  return opensAt === value ? t("settings.quality.mayStall").replace("{needs}", needs) : t("settings.quality.playsFor").replace("{needs}", needs).replace("{label}", QUALITY_PRESETS[opensAt].label);
}
