/**
 * App notifications through the tomo-toast module: accent cards in their own window, above
 * the presented player on both platforms. This file only binds the app's tokens and strings.
 */
import { COLORS } from "@/constants/colors";
import { currentPalette } from "@/hooks/useCardPalette";
import { configureToast, dismissToast, showToast as show, type ToastKind, type ToastOptions, updateToast } from "@/modules/tomo-toast";
import { t } from "@/services/i18n";
import { Platform } from "react-native";

export type { ToastKind, ToastOptions };

// Re-sent when the language or theme changes, so the close label and card colour follow them.
let configuredKey: string | null = null;

function ensureConfigured(): void {
  const closeLabel = t("common.close");
  const palette = currentPalette();
  const key = `${closeLabel}|${palette.accent}`;
  if (key === configuredKey) return;
  configuredKey = key;
  configureToast({
    tint: palette.accent,
    text: palette.ink,
    danger: COLORS.DESTRUCTIVE_DEEP,
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
