import { STANDALONE_VIDEO_TYPES } from "@/services/jellyfin/constants";
import { hasPoster } from "@/services/jellyfinApi";
import type { PosterItem } from "@/services/itemArtwork";
import { cancelPosterFrame, posterFrameIfCached, requestPosterFrame } from "@/services/localRemux";
import { useEffect, useState } from "react";

/** The kinds the engine can open for a frame; photos, audio and folders never ask. */
const POSTER_FRAME_TYPES = new Set<string>([...STANDALONE_VIDEO_TYPES, "Episode"]);

/**
 * The engine-made keyframe for a card the server left without a poster, or null. Keyed by
 * item id so a recycled card never shows the previous item's picture; the request is
 * withdrawn when the card leaves.
 */
export function usePosterFrame(item: PosterItem | null): string | null {
  const itemId = item?.Id ?? "";
  const eligible = !!item && !hasPoster(item) && POSTER_FRAME_TYPES.has(item.Type);
  const runTimeTicks = item?.RunTimeTicks ?? 0;
  const cached = eligible ? posterFrameIfCached(itemId) : undefined;
  const settled = cached !== undefined;
  const [result, setResult] = useState<{ id: string; uri: string | null }>({ id: "", uri: null });

  useEffect(() => {
    if (!eligible || settled) return;
    let cancelled = false;
    void requestPosterFrame({ Id: itemId, RunTimeTicks: runTimeTicks }).then((uri) => {
      if (!cancelled) setResult({ id: itemId, uri });
    });
    return () => {
      cancelled = true;
      cancelPosterFrame(itemId);
    };
  }, [itemId, runTimeTicks, eligible, settled]);

  if (!eligible) return null;
  if (settled) return cached ?? null;
  return result.id === itemId ? result.uri : null;
}
