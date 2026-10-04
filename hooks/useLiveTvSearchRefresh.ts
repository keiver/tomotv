import { searchLiveTv, subscribeLiveTvSearchIndex } from "@/services/jellyfinApi";
import type { JellyfinVideoItem } from "@/types/jellyfin";
import { useEffect, useRef } from "react";

/**
 * Live TV search answers without waiting on the server's programme index; when the index lands, the
 * term on screen runs again so its description matches (tonight's game) appear. `onResults` gets the
 * fresh results only while the term is still the one shown.
 */
export function useLiveTvSearchRefresh(term: string, onResults: (term: string, items: JellyfinVideoItem[]) => void): void {
  const termRef = useRef(term);
  const onResultsRef = useRef(onResults);
  useEffect(() => {
    termRef.current = term;
    onResultsRef.current = onResults;
  });
  useEffect(
    () =>
      subscribeLiveTvSearchIndex(() => {
        const asked = termRef.current.trim();
        if (!asked) return;
        searchLiveTv(asked)
          .then((items) => {
            if (termRef.current.trim() === asked) onResultsRef.current(asked, items);
          })
          .catch(() => {});
      }),
    [],
  );
}
