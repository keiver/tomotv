/**
 * The viewer's time corrections for one item's subtitle tracks, shared by the tvOS panel and the
 * iOS screen: a press writes the offset and, when the item is playing, moves the cues in the running
 * session. Nothing restarts. A match asks the engine to line the track up with the audio, in two
 * windows of the file when the first gives nothing, and keeps what it finds the same way.
 */
import { usePlayerSession } from "@/contexts/PlayerSessionContext";
import { getCachedConfig } from "@/services/jellyfin/session";
import { setSubtitleOffsetMs, subtitleOffsetMs, type SubtitleSyncState } from "@/services/subtitles/timing";
import { useCallback, useRef, useState } from "react";

export const SUBTITLE_SYNC_ATTEMPTS = 2;

/** Answers that another window of the same file cannot change. */
const FINAL_REASONS = new Set(["noSession", "noTrack", "notRead"]);

export interface SubtitleTiming {
  /** The stored offset for a stream index, read live. */
  offsetFor: (streamIndex: number) => number;
  /** Steps the offset by `deltaMs`, or resets it with null; returns the value kept. */
  shift: (streamIndex: number, deltaMs: number | null) => number;
  /** True while the item plays in the session, the only time a match can run. */
  canSync: boolean;
  /** Lines the track up with the audio and keeps the offset found; false when no window matched. */
  sync: (streamIndex: number) => Promise<boolean>;
  /** What the last match for a stream index came to, or null when none ran. */
  syncStateFor: (streamIndex: number) => SubtitleSyncState | null;
}

export function useSubtitleTiming(itemId: string): SubtitleTiming {
  const { sessionVideoId, applySubtitleTimeOffset, alignSubtitleTiming } = usePlayerSession();
  const [, setVersion] = useState(0);
  const [syncStates, setSyncStates] = useState<Record<number, SubtitleSyncState>>({});
  const syncing = useRef(new Set<number>());
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

  const sync = useCallback(
    async (streamIndex: number) => {
      if (!playing || syncing.current.has(streamIndex)) return false;
      syncing.current.add(streamIndex);
      try {
        for (let attempt = 0; attempt < SUBTITLE_SYNC_ATTEMPTS; attempt += 1) {
          setSyncStates((current) => ({ ...current, [streamIndex]: { status: "syncing", attempt } }));
          const answer = await alignSubtitleTiming(streamIndex, attempt);
          if (answer.ok) {
            const kept = setSubtitleOffsetMs(getCachedConfig().server, itemId, streamIndex, answer.offsetMs);
            applySubtitleTimeOffset(streamIndex, kept);
            setSyncStates((current) => ({ ...current, [streamIndex]: { status: "synced" } }));
            return true;
          }
          if (FINAL_REASONS.has(answer.reason)) break;
        }
        setSyncStates((current) => ({ ...current, [streamIndex]: { status: "failed" } }));
        return false;
      } finally {
        syncing.current.delete(streamIndex);
      }
    },
    [alignSubtitleTiming, applySubtitleTimeOffset, itemId, playing],
  );

  const syncStateFor = useCallback((streamIndex: number) => syncStates[streamIndex] ?? null, [syncStates]);

  return { offsetFor, shift, canSync: playing, sync, syncStateFor };
}
