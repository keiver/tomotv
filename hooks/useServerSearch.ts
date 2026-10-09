import { subscribeItemRemoved } from "@/services/jellyfin/events";
import type { SearchCursor } from "@/services/jellyfin/search";
import { searchLiveTv, searchVideos, warmLiveTvSearch } from "@/services/jellyfinApi";
import type { JellyfinVideoItem } from "@/types/jellyfin";
import { getLoadErrorMessage } from "@/utils/errorClassification";
import { useCallback, useEffect, useRef, useState } from "react";

const PAGE_SIZE = 60;
const TYPING_DELAY_MS = 300;
const MIN_QUERY = 2;

/** Appends a page, dropping cards an earlier page already shows. */
export function appendUnique(shown: JellyfinVideoItem[], page: JellyfinVideoItem[]): JellyfinVideoItem[] {
  const seen = new Set(shown.map((item) => item.Id));
  const fresh = page.filter((item) => !seen.has(item.Id));
  return fresh.length > 0 ? [...shown, ...fresh] : shown;
}

interface ServerSearchOptions {
  initialQuery?: string;
  /** The tvOS field's way: every change, a removal's reload included, waits out the typing delay
   *  and shows the spinner from the keystroke. */
  waitOnEveryChange?: boolean;
  onResults?: (term: string, count: number, live: number) => void;
  onError?: (error: unknown, term: string) => void;
}

/**
 * The server search both Search screens draw: every query change retires the pages in flight for
 * older terms, and each next page starts where each source left off.
 */
export function useServerSearch({ initialQuery, waitOnEveryChange = false, onResults, onError }: ServerSearchOptions = {}) {
  const [query, setQuery] = useState(initialQuery ?? "");
  const [activeQuery, setActiveQuery] = useState("");
  const [results, setResults] = useState<JellyfinVideoItem[]>([]);
  const [liveResults, setLiveResults] = useState<JellyfinVideoItem[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [next, setNext] = useState<SearchCursor | null>(null);
  // Bumped by every query change and removal: a page for an older one lands nothing.
  const seqRef = useRef(0);
  // Cards shown so far, for the live facet's late onResults report.
  const resultCountRef = useRef(0);
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

  const run = useCallback(async (term: string, cursor: SearchCursor | null) => {
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
      // Live TV matches ride the first page only, and never gate it: opening a guide can take
      // seconds, and the library results are ready in a fraction of that. The channel cards
      // land on their own when they do, replacing the previous term's in place; clearing them
      // up front would unmount the shelf and shift the grid under focus on every keystroke.
      if (!append) {
        void searchLiveTv(term)
          .then((live) => {
            if (seq !== seqRef.current) return;
            setLiveResults(live);
            callbacksRef.current.onResults?.(term, resultCountRef.current, live.length);
          })
          .catch(() => {});
      }
      const page = await searchVideos(term, append ? { limit: PAGE_SIZE, cursor } : { limit: PAGE_SIZE });
      if (seq !== seqRef.current) return;
      resultCountRef.current = append ? resultCountRef.current + page.items.length : page.items.length;
      setResults((shown) => (append ? appendUnique(shown, page.items) : page.items));
      setNext(page.next);
      setActiveQuery(term);
    } catch (err) {
      if (seq !== seqRef.current) return;
      setError(getLoadErrorMessage(err));
      if (!append) {
        setResults([]);
        setLiveResults([]);
        callbacksRef.current.onError?.(err, term);
      }
    } finally {
      if (seq === seqRef.current) {
        if (append) setIsLoadingMore(false);
        else setIsSearching(false);
      }
    }
  }, []);

  const search = useCallback(
    (text: string) => {
      setQuery(text);
      queryRef.current = text;
      seqRef.current += 1;
      if (delayRef.current) clearTimeout(delayRef.current);
      const trimmed = text.trim();
      if (trimmed.length < MIN_QUERY) {
        setResults([]);
        setLiveResults([]);
        setError(null);
        setNext(null);
        setIsSearching(false);
        setIsLoadingMore(false);
        return;
      }
      if (waitOnEveryChange) setIsSearching(true);
      delayRef.current = setTimeout(() => void run(trimmed, null), TYPING_DELAY_MS);
    },
    [run, waitOnEveryChange],
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
        setLiveResults((items) => items.filter((item) => item.Id !== itemId));
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

  return { query, activeQuery, results, liveResults, setLiveResults, isSearching, isLoadingMore, hasMore: next !== null, error, search, retry, loadMore, clearError };
}
