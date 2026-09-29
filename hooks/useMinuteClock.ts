import { useSyncExternalStore } from "react";

const MINUTE_MS = 60_000;

let nowMs = Date.now();
let timer: ReturnType<typeof setTimeout> | null = null;
const listeners = new Set<() => void>();

// One shared timer on the clock's minute boundaries, running only while something listens.
function tick(): void {
  nowMs = Date.now();
  for (const listener of listeners) listener();
  timer = setTimeout(tick, MINUTE_MS - (Date.now() % MINUTE_MS));
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  if (!timer) {
    nowMs = Date.now();
    timer = setTimeout(tick, MINUTE_MS - (Date.now() % MINUTE_MS));
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && timer) {
      clearTimeout(timer);
      timer = null;
    }
  };
}

const read = () => nowMs;
const NO_SUBSCRIPTION = () => () => {};
const NO_CLOCK = () => 0;

/** The time, moving on each minute boundary while `enabled`; a constant 0 otherwise, so nothing re-renders. */
export function useMinuteClock(enabled: boolean): number {
  return useSyncExternalStore(enabled ? subscribe : NO_SUBSCRIPTION, enabled ? read : NO_CLOCK);
}
