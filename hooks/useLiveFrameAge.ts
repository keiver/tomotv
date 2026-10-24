import { liveFrameDueAt, liveFrameReel, subscribeLiveFrame } from "@/services/liveFrames";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";

const passed = (marks: readonly number[], changedAt: number, now: number) => marks.filter((mark) => now - changedAt >= mark).length;

/**
 * How many of `marks` (ms after the picture last changed, ascending) have passed: 0 while fresher than the
 * first, -1 with no picture. One timer per card re-renders it at each mark and never between them.
 */
export function useLiveFrameAge(channelId: string, marks: readonly number[]): number {
  const subscribe = useCallback((listener: () => void) => subscribeLiveFrame(channelId, listener), [channelId]);
  const reel = useSyncExternalStore(
    subscribe,
    useCallback(() => liveFrameReel(channelId), [channelId]),
  );
  // An unchanged verify re-dates the burst in place: the reel object stays while its due moves, and it counts as fresh.
  const dueAt = useSyncExternalStore(
    subscribe,
    useCallback(() => liveFrameDueAt(channelId), [channelId]),
  );
  // Read at mount too, so a card with a fresh picture never misses its first mark for a frame.
  const [step, setStep] = useState(() => (reel ? passed(marks, reel.at, Date.now()) : -1));
  // The age follows the picture, not the grab: a frame appended mid-burst is a newer picture.
  const seen = useRef<{ reel: unknown; changedAt: number }>({ reel: undefined, changedAt: 0 });
  useEffect(() => {
    if (!reel) return;
    if (seen.current.reel !== reel) seen.current = { reel, changedAt: seen.current.reel ? Date.now() : reel.at };
    const changedAt = Math.max(seen.current.changedAt, reel.at);
    const now = Date.now();
    const current = passed(marks, changedAt, now);
    setStep(current);
    if (current >= marks.length) return;
    // At least one step on: a timer firing a hair early must not stall the chain.
    const timer = setTimeout(() => setStep(Math.max(current + 1, passed(marks, changedAt, Date.now()))), changedAt + marks[current] - now);
    return () => clearTimeout(timer);
  }, [reel, dueAt, step, marks]);
  return reel ? step : -1;
}
