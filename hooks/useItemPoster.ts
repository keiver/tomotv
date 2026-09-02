import { usePosterFrame } from "@/hooks/usePosterFrame";
import { posterSource, type PosterItem, type PosterSource } from "@/services/itemArtwork";
import { useMemo } from "react";

/**
 * An item's picture for a React surface: the server poster at once, else the engine's
 * keyframe, requested through the poster queue when the pool has none yet.
 */
export function useItemPoster(item: PosterItem | null, height: number): PosterSource | undefined {
  const frame = usePosterFrame(item);
  return useMemo(() => (item ? posterSource(item, height, frame) : undefined), [item, height, frame]);
}
