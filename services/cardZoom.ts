/** The card zoom a pinch or key chose, for this run of the app only: a relaunch opens at 1. */
let zoom = 1;
const listeners = new Set<() => void>();

export function getCardZoom(): number {
  return zoom;
}

export function setCardZoom(next: number): void {
  if (next === zoom) return;
  zoom = next;
  for (const listener of listeners) listener();
}

export function subscribeCardZoom(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
