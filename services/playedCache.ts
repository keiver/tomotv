/**
 * Session cache of in-session played-state changes. Lives outside React (like
 * favoritesCache) so the auth flows in jellyfinApi can clear it and the playback
 * reporter can write to it without reaching into any hook.
 *
 * Unlike favoritesCache this is a DELTA map, not an authoritative set: played
 * item sets are unbounded, so no bulk seeding. It only holds items whose played
 * state changed this session (manual toggle or playback completion); everything
 * else keeps its server-supplied UserData.Played.
 */
const playedOverrides = new Map<string, boolean>();

export function getPlayedOverrides(): Map<string, boolean> {
  return playedOverrides;
}

/** Record a single played-state change so annotation reflects it without a refetch. */
export function markPlayed(id: string, played: boolean): void {
  playedOverrides.set(id, played);
}

/** Drop everything (e.g. after auth changes) so no stale override leaks across users. */
export function clearPlayedCache(): void {
  playedOverrides.clear();
}
