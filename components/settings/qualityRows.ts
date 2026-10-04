/** Transcoding quality choices: each preset's limit and its quality/data tradeoff. */
import { t } from "@/services/i18n";

/** Auto leads, followed by resolution caps. Each value indexes QUALITY_PRESETS and is what gets persisted. */
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

/** Explains the choice consistently, independent of the latest connection measurement. */
export function qualityRowSubtitle(value: number): string {
  switch (value) {
    case 5:
      return t("settings.quality.adapts");
    case 4:
      return t("settings.quality.max4kHint");
    case 3:
      return t("settings.quality.max1080Hint");
    case 2:
      return t("settings.quality.max720Hint");
    case 1:
      return t("settings.quality.max540Hint");
    default:
      return t("settings.quality.max480Hint");
  }
}
