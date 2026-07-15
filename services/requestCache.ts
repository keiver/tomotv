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

  const existing = inFlight.get(key);
  if (existing) {
    return existing as Promise<T>;
  }

  const promise = (async () => {
    try {
      const value = await fetcher();
      entries.set(key, { value, timestamp: Date.now() });
      return value;
    } finally {
      inFlight.delete(key);
    }
  })();

  inFlight.set(key, promise);
  return promise;
}

/** Drop a single cached key (does not cancel any in-flight request for it). */
export function invalidateRequest(key: string): void {
  entries.delete(key);
}

/** Drop every cached key that starts with `prefix` — used to evict a family of reads after a mutation. */
export function invalidateByPrefix(prefix: string): void {
  for (const key of entries.keys()) {
    if (key.startsWith(prefix)) {
      entries.delete(key);
    }
  }
}

/** Drop all cached entries (e.g. after auth changes) so the next read refetches fresh. */
export function clearRequestCache(): void {
  entries.clear();
}
