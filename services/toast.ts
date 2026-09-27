/**
 * App notifications through the tomo-toast module: gold cards in their own window, above
 * the presented player on both platforms. This file only binds the app's tokens and strings.
 */
import { COLORS } from "@/constants/colors";
import { configureToast, dismissToast, showToast as show, type ToastKind, type ToastOptions, updateToast } from "@/modules/tomo-toast";
import { t } from "@/services/i18n";

export type { ToastKind, ToastOptions };

// Re-sent when the language changes, so the close label follows it.
let configuredLabel: string | null = null;

function ensureConfigured(): void {
  const closeLabel = t("common.close");
  if (closeLabel === configuredLabel) return;
  configuredLabel = closeLabel;
  configureToast({
    tint: COLORS.ACCENT,
    text: COLORS.ON_ACCENT_WARM,
    danger: COLORS.DESTRUCTIVE_DEEP,
    heightRatio: 0.3,
    closeLabel,
  });
}

export function showToast(input: string | ToastOptions, kind: ToastKind = "info"): string {
  ensureConfigured();
  return show(typeof input === "string" ? { title: input, kind } : input);
}

export { dismissToast, updateToast };
