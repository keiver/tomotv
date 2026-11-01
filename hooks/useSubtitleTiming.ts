/**
 * The viewer's time corrections for one item's subtitle tracks, shared by the tvOS panel and the
 * iOS screen: a press writes the offset and, when the item is playing, moves the cues in the running
 * session. Nothing restarts.
 */
import { usePlayerSession } from "@/contexts/PlayerSessionContext";
import { getCachedConfig } from "@/services/jellyfin/session";
import { setSubtitleOffsetMs, subtitleOffsetMs } from "@/services/subtitles/timing";
import { useCallback, useState } from "react";

export interface SubtitleTiming {
  /** The stored offset for a stream index, read live. */
  offsetFor: (streamIndex: number) => number;
  /** Steps the offset by `deltaMs`, or resets it with null; returns the value kept. */
  shift: (streamIndex: number, deltaMs: number | null) => number;
}

export function useSubtitleTiming(itemId: string): SubtitleTiming {
  const { sessionVideoId, applySubtitleTimeOffset } = usePlayerSession();
  const [, setVersion] = useState(0);
  const playing = sessionVideoId === itemId;

  const offsetFor = useCallback((streamIndex: number) => subtitleOffsetMs(getCachedConfig().server, itemId, streamIndex), [itemId]);

  const shift = useCallback(
    (streamIndex: number, deltaMs: number | null) => {
      const server = getCachedConfig().server;
      const kept = setSubtitleOffsetMs(server, itemId, streamIndex, deltaMs === null ? 0 : subtitleOffsetMs(server, itemId, streamIndex) + deltaMs);
      setVersion((value) => value + 1);
      if (playing) applySubtitleTimeOffset(streamIndex, kept);
      return kept;
    },
    [applySubtitleTimeOffset, itemId, playing],
  );

  return { offsetFor, shift };
}
