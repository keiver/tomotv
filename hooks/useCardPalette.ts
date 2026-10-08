import { cardPalette, type CardPalette } from "@/services/cardTheme";
import { getUiPreferences, subscribeUiPreferences } from "@/services/uiPreferences";
import { createContext, useContext, useSyncExternalStore } from "react";
import { StyleSheet } from "react-native";

/** A palette for the views under it instead of the chosen theme: the theme editor's preview. */
export const CardPaletteOverride = createContext<CardPalette | null>(null);

// A string snapshot: a view re-renders when the accent changes, never for another preference.
const chosenAccent = () => getUiPreferences().cardTheme.accent;

/** The chosen theme's palette, outside React (a toast, a native call). */
export function currentPalette(): CardPalette {
  return cardPalette(chosenAccent());
}

/** The colours a view draws its accent in. Every view shares one object per accent. */
export function useCardPalette(): CardPalette {
  const override = useContext(CardPaletteOverride);
  const accent = useSyncExternalStore(subscribeUiPreferences, chosenAccent);
  return override ?? cardPalette(accent);
}

/**
 * A component's accent-bearing styles, built once per palette and shared: the module-level
 * StyleSheet.create keeps its accent-free styles, this hook supplies the rest.
 */
export function themedStyles<T extends StyleSheet.NamedStyles<T>>(factory: (palette: CardPalette) => T): () => T {
  const built = new WeakMap<CardPalette, T>();
  return function useThemedStyles(): T {
    const palette = useCardPalette();
    let styles = built.get(palette);
    if (!styles) {
      styles = StyleSheet.create(factory(palette));
      built.set(palette, styles);
    }
    return styles;
  };
}
