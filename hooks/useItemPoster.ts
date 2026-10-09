import { usePosterFrame } from "@/hooks/usePosterFrame";
import { posterSource, type PosterItem, type PosterSource } from "@/services/itemArtwork";
import { posterFrameRevision } from "@/services/localRemux";
import { useMemo } from "react";

/**
 * An item's picture for a React surface: the server poster at once, else the engine's
 * keyframe, requested through the poster queue when the pool has none yet.
 */
export function useItemPoster(item: PosterItem | null, height: number, options?: { deferWhileVideo?: boolean }): PosterSource | undefined {
  const frame = usePosterFrame(item, options);
  // The frame hook re-renders when the engine decoded a settled poster again; the key follows.
  const revision = item ? posterFrameRevision(item.Id) : 0;
  return useMemo(() => (item ? posterSource(item, height, frame, revision) : undefined), [item, height, frame, revision]);
}
