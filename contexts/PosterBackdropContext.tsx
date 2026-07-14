import { getBackdropBlurUrl } from "@/services/jellyfinApi";
import React, { createContext, ReactNode, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";

/** Minimal shape needed to build a backdrop source; both video and folder items satisfy it. */
interface BackdropItem {
  Id: string;
  ImageTags?: { Primary?: string };
}

interface BackdropSource {
  uri: string;
  cacheKey: string;
}

interface BackdropDispatch {
  /**
   * Request the backdrop to wash with this item's poster (debounced). An item with no
   * primary image washes back to glows-only. Focus-only by design: on tvOS an incoming
   * card's onFocus can fire before the outgoing card's onBlur, so a blur→clear would
   * race and cancel the new poster; we keep the last focused poster instead.
   */
  focus: (item: BackdropItem) => void;
}

// How long focus must settle before the backdrop commits. The user must rest on a
// card for this long before its poster washes in; any focus change within the window
// restarts the timer, so scrolling through the grid never thrashes the backdrop.
const COMMIT_DELAY_MS = 1000;

const DispatchContext = createContext<BackdropDispatch | undefined>(undefined);
const ValueContext = createContext<BackdropSource | null>(null);

export function PosterBackdropProvider({ children }: { children: ReactNode }) {
  const [source, setSource] = useState<BackdropSource | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const commit = useCallback((next: BackdropSource | null) => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setSource(next), COMMIT_DELAY_MS);
  }, []);

  const dispatch = useMemo<BackdropDispatch>(
    () => ({
      focus: (item) => {
        const tag = item.ImageTags?.Primary;
        if (!tag) {
          commit(null);
          return;
        }
        commit({ uri: getBackdropBlurUrl(item.Id), cacheKey: `${item.Id}-${tag}-backdrop` });
      },
    }),
    [commit],
  );

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  return (
    <DispatchContext.Provider value={dispatch}>
      <ValueContext.Provider value={source}>{children}</ValueContext.Provider>
    </DispatchContext.Provider>
  );
}

/** Stable focus dispatch, safe to thread into memoized cards. */
export function usePosterBackdropDispatch(): BackdropDispatch {
  const ctx = useContext(DispatchContext);
  if (ctx === undefined) {
    throw new Error("usePosterBackdropDispatch must be used within a PosterBackdropProvider");
  }
  return ctx;
}

/** Current committed backdrop source (null = glows only). Consumed only by the backdrop. */
export function usePosterBackdropValue(): BackdropSource | null {
  return useContext(ValueContext);
}
