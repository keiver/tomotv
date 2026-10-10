import { subscribeItemRemoved } from "@/services/jellyfin/events";
import type { SearchCursor } from "@/services/jellyfin/search";
import { searchLiveTv, searchVideos, warmLiveTvSearch } from "@/services/jellyfinApi";
import type { JellyfinVideoItem } from "@/types/jellyfin";
import { getLoadErrorMessage } from "@/utils/errorClassification";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

const PAGE_SIZE = 60;
const TYPING_DELAY_MS = 300;
const MIN_QUERY = 2;

/** Appends a page, dropping cards an earlier page already shows. */
export function appendUnique(shown: JellyfinVideoItem[], page: JellyfinVideoItem[]): JellyfinVideoItem[] {
  const seen = new Set(shown.map((item) => item.Id));
  const fresh = page.filter((item) => !seen.has(item.Id));
  return fresh.length > 0 ? [...shown, ...fresh] : shown;
}

const idsOf = (items: readonly JellyfinVideoItem[]) => items.map((item) => item.Id).join("|");

interface ServerSearchOptions {
  initialQuery?: string;
  /** The tvOS field's way: every change, a removal's reload included, waits out the typing delay
   *  and shows the spinner from the keystroke. */
  waitOnEveryChange?: boolean;
  onResults?: (term: string, count: number, live: number) => void;
  onError?: (error: unknown, term: string) => void;
}

/**
 * The server search both Search screens draw: ONE grid, live cards ranked first. Each debounced
 * term paints one commit holding the library page and every live tier answered by then (the name
 * tier gates the paint at library speed). While the live request is still out, `isLiveSearching`
 * drives the visible progress bar; a partial that only completes shown cards fills them in place,
 * and the moment the request finishes its complete set applies and the bar drops. Deterministic:
 * request completion is the only trigger, never a gesture or focus position.
 */
export function useServerSearch({ initialQuery, waitOnEveryChange = false, onResults, onError }: ServerSearchOptions = {}) {
  const [query, setQuery] = useState(initialQuery ?? "");
  const [activeQuery, setActiveQuery] = useState("");
  const [results, setResults] = useState<JellyfinVideoItem[]>([]);
  const [liveResults, setLiveResults] = useState<JellyfinVideoItem[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  // True while the current term's live facet is still gathering (slow tiers, card details).
  const [isLiveSearching, setIsLiveSearching] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [next, setNext] = useState<SearchCursor | null>(null);
  // Bumped by every query change and removal: a page for an older one lands nothing.
  const seqRef = useRef(0);
  // Cards shown so far, for the live facet's late onResults report.
  const resultCountRef = useRef(0);
  // The term's grid painted: later live changes buffer instead of moving it.
  const livePaintedRef = useRef(false);
  const liveLatestRef = useRef<JellyfinVideoItem[]>([]);
  const liveShownRef = useRef<JellyfinVideoItem[]>([]);
  const delayRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const queryRef = useRef(initialQuery ?? "");
  const callbacksRef = useRef({ onResults, onError });
  useEffect(() => {
    callbacksRef.current = { onResults, onError };
  });

  // The first live search pays the guide open (XMLTV download + native ingest, seconds); warming
  // it at screen mount moves that off the first query.
  useEffect(() => {
    void warmLiveTvSearch();
  }, []);

  const showLive = useCallback((items: JellyfinVideoItem[]) => {
    liveShownRef.current = items;
    setLiveResults(items);
  }, []);

  /** A partial for the CURRENT term: rides the next paint, or fills shown cards in place. A
   *  partial with new cards is held; the finished request applies the complete set. */
  const landLivePartial = useCallback(
    (seq: number, items: JellyfinVideoItem[]) => {
      if (seq !== seqRef.current) return;
      if (!livePaintedRef.current) {
        liveLatestRef.current = items;
        return;
      }
      // Same cards, completed (channel names, artwork): an in-place fill moves no layout.
      if (idsOf(items) === idsOf(liveShownRef.current)) showLive(items);
    },
    [showLive],
  );

  /** A finished external refresh (the programme index landing) applies like any finished request. */
  const offerLiveResults = useCallback((items: JellyfinVideoItem[]) => showLive(items), [showLive]);

  const run = useCallback(
    async (term: string, cursor: SearchCursor | null) => {
      const append = cursor !== null;
      const seq = append ? seqRef.current : ++seqRef.current;
      if (append) {
        setIsLoadingMore(true);
      } else {
        setIsSearching(true);
        setIsLoadingMore(false);
        setError(null);
        setNext(null);
      }
      try {
        if (append) {
          const page = await searchVideos(term, { limit: PAGE_SIZE, cursor });
          if (seq !== seqRef.current) return;
          resultCountRef.current += page.items.length;
          setResults((shown) => appendUnique(shown, page.items));
          setNext(page.next);
          return;
        }
        // The paint waits for the library page AND the live facet's first answer (its name tier,
        // an /Items read at library speed), so live cards lead the grid from the first commit.
        // The slower tiers go through landLivePartial and never move the grid on their own.
        livePaintedRef.current = false;
        liveLatestRef.current = [];
        setIsLiveSearching(true);
        let settleFirstLive!: () => void;
        const firstLive = new Promise<void>((resolve) => (settleFirstLive = resolve));
        void searchLiveTv(term, (partial) => {
          landLivePartial(seq, partial);
          settleFirstLive();
        })
          .then((live) => {
            settleFirstLive();
            if (seq !== seqRef.current) return;
            // The finished request is the one trigger that applies new live cards after the paint.
            if (livePaintedRef.current) showLive(live);
            else liveLatestRef.current = live;
            setIsLiveSearching(false);
            callbacksRef.current.onResults?.(term, resultCountRef.current, live.length);
          })
          .catch(() => {
            settleFirstLive();
            if (seq === seqRef.current) setIsLiveSearching(false);
          });
        const [page] = await Promise.all([searchVideos(term, { limit: PAGE_SIZE }), firstLive]);
        if (seq !== seqRef.current) return;
        livePaintedRef.current = true;
        showLive(liveLatestRef.current);
        resultCountRef.current = page.items.length;
        setResults(page.items);
        setNext(page.next);
        setActiveQuery(term);
      } catch (err) {
        if (seq !== seqRef.current) return;
        setError(getLoadErrorMessage(err));
        if (!append) {
          // The live cards that answered still paint: a failed library keeps the live facet.
          livePaintedRef.current = true;
          showLive(liveLatestRef.current);
          setResults([]);
          callbacksRef.current.onError?.(err, term);
        }
      } finally {
        if (seq === seqRef.current) {
          if (append) setIsLoadingMore(false);
          else setIsSearching(false);
        }
      }
    },
    [landLivePartial, showLive],
  );

  const search = useCallback(
    (text: string) => {
      setQuery(text);
      queryRef.current = text;
      seqRef.current += 1;
      if (delayRef.current) clearTimeout(delayRef.current);
      const trimmed = text.trim();
      if (trimmed.length < MIN_QUERY) {
        setResults([]);
        showLive([]);
        liveLatestRef.current = [];
        livePaintedRef.current = false;
        setError(null);
        setNext(null);
        setIsSearching(false);
        setIsLiveSearching(false);
        setIsLoadingMore(false);
        return;
      }
      if (waitOnEveryChange) setIsSearching(true);
      delayRef.current = setTimeout(() => void run(trimmed, null), TYPING_DELAY_MS);
    },
    [run, waitOnEveryChange, showLive],
  );

  const retry = useCallback(() => {
    const trimmed = queryRef.current.trim();
    if (trimmed.length >= MIN_QUERY) void run(trimmed, null);
  }, [run]);

  const loadMore = useCallback(() => {
    if (next && !isLoadingMore && !isSearching && activeQuery) void run(activeQuery, next);
  }, [next, isLoadingMore, isSearching, activeQuery, run]);

  const clearError = useCallback(() => setError(null), []);

  useEffect(
    () =>
      subscribeItemRemoved((itemId) => {
        setResults((items) => items.filter((item) => item.Id !== itemId));
        const drop = (items: JellyfinVideoItem[]) => items.filter((item) => item.Id !== itemId);
        liveLatestRef.current = drop(liveLatestRef.current);
        liveShownRef.current = drop(liveShownRef.current);
        setLiveResults((items) => drop(items));
        // Deletion shifts server offsets. Reload page zero so the next page cannot skip an item,
        // and the response of a page already in flight cannot bring the deleted card back.
        setIsLoadingMore(false);
        setNext(null);
        if (waitOnEveryChange) {
          search(queryRef.current);
          return;
        }
        seqRef.current += 1;
        if (delayRef.current) clearTimeout(delayRef.current);
        const trimmed = queryRef.current.trim();
        if (trimmed.length >= MIN_QUERY) void run(trimmed, null);
        else setIsSearching(false);
      }),
    [run, search, waitOnEveryChange],
  );

  useEffect(
    () => () => {
      if (delayRef.current) clearTimeout(delayRef.current);
    },
    [],
  );

  // The one grid: live cards lead, the library follows, never repeating a live card.
  const items = useMemo(() => {
    if (liveResults.length === 0) return results;
    const liveIds = new Set(liveResults.map((item) => item.Id));
    return [...liveResults, ...results.filter((item) => !liveIds.has(item.Id))];
  }, [liveResults, results]);

  return {
    query,
    activeQuery,
    items,
    results,
    liveResults,
    offerLiveResults,
    isSearching,
    isLiveSearching,
    isLoadingMore,
    hasMore: next !== null,
    error,
    search,
    retry,
    loadMore,
    clearError,
  };
}
