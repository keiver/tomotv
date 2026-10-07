import type { CardTheme } from "@/services/cardTheme";
import { t } from "@/services/i18n";
import type { StringKey } from "@/services/i18n/strings";

const BUILT_IN_NAMES: Record<string, StringKey> = {
  gold: "appearance.theme.gold",
  blue: "appearance.theme.blue",
  green: "appearance.theme.green",
  purple: "appearance.theme.purple",
};

/** A built-in's name in the viewer's language, else a saved theme's own name (its colour if it has none). */
export function themeName(theme: CardTheme): string {
  const key = BUILT_IN_NAMES[theme.id];
  return key ? t(key) : theme.name.trim() || theme.accent;
}
