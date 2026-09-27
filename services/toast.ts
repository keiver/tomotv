/**
 * App notifications through the tomo-toast module: gold cards in their own window, above
 * the presented player on both platforms. This file only binds the app's tokens and strings.
 */
import { COLORS } from "@/constants/colors";
import { configureToast, dismissToast, showToast as show, type ToastKind, type ToastOptions, updateToast } from "@/modules/tomo-toast";
import { t } from "@/services/i18n";
import { Platform } from "react-native";

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
    heightRatio: 0.15,
    closeLabel,
  });
}

// The TV's bottom edge belongs to the player's transport bar while video is on screen.
let playerOnScreen = false;

export function setToastPlayerOnScreen(visible: boolean): void {
  playerOnScreen = visible;
}

export function showToast(input: string | ToastOptions, kind: ToastKind = "info"): string {
  ensureConfigured();
  const options = typeof input === "string" ? { title: input, kind } : input;
  return show(Platform.isTV && playerOnScreen && !options.edge ? { ...options, edge: "top" } : options);
}

export { dismissToast, updateToast };
