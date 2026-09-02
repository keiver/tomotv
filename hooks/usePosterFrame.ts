import { STANDALONE_VIDEO_TYPES } from "@/services/jellyfin/constants";
import { hasPoster } from "@/services/jellyfinApi";
import { cancelPosterFrame, posterFrameIfCached, requestPosterFrame } from "@/services/localRemux";
import type { JellyfinVideoItem } from "@/types/jellyfin";
import { useEffect, useState } from "react";

/** The kinds the engine can open for a frame; photos, audio and folders never ask. */
const POSTER_FRAME_TYPES = new Set<string>([...STANDALONE_VIDEO_TYPES, "Episode"]);

/**
 * The engine-made keyframe for a card the server left without a poster, or null. Keyed by
 * item id so a recycled card never shows the previous item's picture; the request is
 * withdrawn when the card leaves.
 */
export function usePosterFrame(item: JellyfinVideoItem): string | null {
  const eligible = !hasPoster(item) && POSTER_FRAME_TYPES.has(item.Type);
  const runTimeTicks = item.RunTimeTicks;
  const cached = eligible ? posterFrameIfCached(item.Id) : undefined;
  const settled = cached !== undefined;
  const [result, setResult] = useState<{ id: string; uri: string | null }>({ id: "", uri: null });

  useEffect(() => {
    if (!eligible || settled) return;
    let cancelled = false;
    void requestPosterFrame({ Id: item.Id, RunTimeTicks: runTimeTicks }).then((uri) => {
      if (!cancelled) setResult({ id: item.Id, uri });
    });
    return () => {
      cancelled = true;
      cancelPosterFrame(item.Id);
    };
  }, [item.Id, runTimeTicks, eligible, settled]);

  if (!eligible) return null;
  if (settled) return cached ?? null;
  return result.id === item.Id ? result.uri : null;
}
