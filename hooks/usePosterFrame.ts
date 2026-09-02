import { useAuthSession } from "@/hooks/useAuthSession";
import { wantsPosterFrame, type PosterItem } from "@/services/itemArtwork";
import { cancelPosterFrame, posterFrameIfCached, requestPosterFrame } from "@/services/localRemux";
import { useEffect, useState } from "react";

/**
 * The engine-made keyframe for a card the server left without a poster, or null. Keyed by
 * session and item id so neither a recycled card nor a server switch shows another item's
 * picture (useAuthSession); the request is withdrawn when the card leaves.
 */
export function usePosterFrame(item: PosterItem | null): string | null {
  const itemId = item?.Id ?? "";
  const eligible = !!item && wantsPosterFrame(item);
  const runTimeTicks = item?.RunTimeTicks ?? 0;
  // The frame pool is cleared with the other content caches, so after a switch this answers
  // undefined and the request runs again against the new server.
  const cached = eligible ? posterFrameIfCached(itemId) : undefined;
  const settled = cached !== undefined;
  const key = `${useAuthSession()}:${itemId}`;
  const [result, setResult] = useState<{ key: string; uri: string | null }>({ key: "", uri: null });

  useEffect(() => {
    if (!eligible || settled) return;
    let cancelled = false;
    void requestPosterFrame({ Id: itemId, RunTimeTicks: runTimeTicks }).then((uri) => {
      if (!cancelled) setResult({ key, uri });
    });
    return () => {
      cancelled = true;
      cancelPosterFrame(itemId);
    };
  }, [key, itemId, runTimeTicks, eligible, settled]);

  if (!eligible) return null;
  if (settled) return cached ?? null;
  return result.key === key ? result.uri : null;
}
