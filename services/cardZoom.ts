import { getUiPreferences, subscribeUiPreferences, updateUiPreferences } from "@/services/uiPreferences";

/** The card zoom every card surface draws at: the saved card size, written by the Appearance stepper, a pinch or the Mac keys. */
export function getCardZoom(): number {
  return getUiPreferences().cardSize;
}

export function setCardZoom(next: number): void {
  if (next === getCardZoom()) return;
  updateUiPreferences({ cardSize: next });
}

export const subscribeCardZoom = subscribeUiPreferences;
