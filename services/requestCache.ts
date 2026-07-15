/**
 * Generic in-memory request cache with TTL and in-flight deduplication.
 *
 * Sits under the read functions in jellyfinApi so any GET routed through it is served from memory
 * within its TTL, and concurrent identical reads collapse onto a single network request. Lives
 * outside React (plain module state) so the auth flows in jellyfinApi can clear it on
 * connect / server-switch / sign-out without reaching into any hook. Session-scoped: nothing is
 * persisted to disk.
 */

type CacheEntry = { value: unknown; timestamp: number };

const entries = new Map<string, CacheEntry>();
const inFlight = new Map<string, Promise<unknown>>();

/**
 * Return a cached value when fresh, share an in-flight request for the same key, or run `fetcher`.
 *
 * - Fresh entry (within `ttlMs`) → returned without touching the network.
 * - A request already in flight for this key → its promise is shared (dedup).
 * - Otherwise `fetcher` runs; on success the value is stored with a timestamp; on failure nothing
 *   is cached so the next call retries.
 */
export async function cachedRequest<T>(key: string, fetcher: () => Promise<T>, ttlMs: number): Promise<T> {
  const cached = entries.get(key);
  if (cached && Date.now() - cached.timestamp < ttlMs) {
    return cached.value as T;
  }
  if (cached) entries.delete(key); // expired — drop it rather than let dead entries accumulate

  const existing = inFlight.get(key);
  if (existing) {
    return existing as Promise<T>;
  }

  // `promise` is referenced inside its own body only after an await, by which point it is assigned;
  // the definite-assignment `!` tells the compiler so.
  let promise!: Promise<T>;
  promise = (async () => {
    try {
      const value = await fetcher();
      // Only cache if this request is still the current in-flight one. An invalidate/clear during the
      // fetch drops it from inFlight; we must not then re-write the value it just invalidated (which
      // would re-introduce stale data across an auth change or a post-mutation refetch).
      if (inFlight.get(key) === promise) entries.set(key, { value, timestamp: Date.now() });
      return value;
    } finally {
      if (inFlight.get(key) === promise) inFlight.delete(key);
    }
  })();

  inFlight.set(key, promise);
  return promise;
}

/** Drop a single cached key AND its in-flight promise so a concurrent read can't re-cache the old value. */
export function invalidateRequest(key: string): void {
  entries.delete(key);
  inFlight.delete(key);
}

/** Drop every cached key (and in-flight promise) that starts with `prefix` — evict a family of reads after a mutation. */
export function invalidateByPrefix(prefix: string): void {
  for (const key of entries.keys()) {
    if (key.startsWith(prefix)) entries.delete(key);
  }
  for (const key of inFlight.keys()) {
    if (key.startsWith(prefix)) inFlight.delete(key);
  }
}

/** Drop all cached entries and in-flight promises (e.g. after auth changes) so the next read refetches fresh. */
export function clearRequestCache(): void {
  entries.clear();
  inFlight.clear();
}
