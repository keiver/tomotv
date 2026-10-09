import { useAuthSession } from "@/hooks/useAuthSession";
import { useUiPreferences } from "@/hooks/useUiPreferences";
import { wantsPosterFrame, type PosterItem } from "@/services/itemArtwork";
import { cancelPosterFrame, posterFrameIfCached, requestPosterFrame } from "@/services/localRemux";
import { isPlaybackHeld, onPlaybackHoldChange } from "@/services/playbackHold";
import { useEffect, useState, useSyncExternalStore } from "react";

const NOT_WATCHING = () => () => {};

/**
 * The engine-made keyframe for a card the server left without a poster, or null. Keyed by
 * session and item id so neither a recycled card nor a server switch shows another item's
 * picture (useAuthSession); the request is withdrawn when the card leaves. `deferWhileVideo`
 * holds a library card's decode while a video owns the link: each decode competes with its start.
 */
export function usePosterFrame(item: PosterItem | null, { deferWhileVideo = false }: { deferWhileVideo?: boolean } = {}): string | null {
  const itemId = item?.Id ?? "";
  // Subscribed so a mounted card drops or asks for its frame when the Settings toggle flips.
  const { devicePosters } = useUiPreferences();
  const eligible = devicePosters && !!item && wantsPosterFrame(item);
  const runTimeTicks = item?.RunTimeTicks ?? 0;
  // The frame pool is cleared with the other content caches, so after a switch this answers
  // undefined and the request runs again against the new server.
  const cached = eligible ? posterFrameIfCached(itemId) : undefined;
  // A failure is final. A success is confirmed with the engine, which decodes again a poster
  // whose file the pool has trimmed since.
  const failed = cached === null;
  // Only a card still owed a decode watches the hold, so a playback start re-renders no other card.
  const watchesHold = deferWhileVideo && eligible && cached === undefined;
  const deferred = useSyncExternalStore(watchesHold ? onPlaybackHoldChange : NOT_WATCHING, () => watchesHold && isPlaybackHeld("video"));
  const key = `${useAuthSession()}:${itemId}`;
  const [result, setResult] = useState<{ key: string; uri: string | null }>({ key: "", uri: null });

  useEffect(() => {
    if (!eligible || failed || deferred) return;
    let cancelled = false;
    void requestPosterFrame({ Id: itemId, RunTimeTicks: runTimeTicks }).then((uri) => {
      if (!cancelled) setResult({ key, uri });
    });
    return () => {
      cancelled = true;
      cancelPosterFrame(itemId);
    };
  }, [key, itemId, runTimeTicks, eligible, failed, deferred]);

  if (!eligible) return null;
  if (cached !== undefined) return cached;
  return result.key === key ? result.uri : null;
}
