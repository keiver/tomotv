/**
 * Session cache of the current user's favorite item ids. Lives outside React (like
 * folderContentsCache) so the auth flows in jellyfinApi can clear it on connect / server-switch /
 * sign-out, and so the favorite-filtered fetches can seed it without reaching into any hook.
 *
 * Purpose: the non-recursive `ParentId` browse does not reliably populate `UserData.IsFavorite`
 * for leaf children, but the recursive `Filters=IsFavorite` fetch (that powers the filter view)
 * does. We capture those reliable ids here once and reuse them to paint hearts on the regular view
 * without re-fetching on every browse.
 */
const favoriteIds = new Set<string>();
let loaded = false;

/** True once the set has been seeded (a favorite-filtered fetch or an explicit load ran). */
export function isFavoritesLoaded(): boolean {
  return loaded;
}

/** Read-only view — writes must go through addFavoriteIds/markFavorite to keep the loaded flag correct. */
export function getFavoriteIds(): ReadonlySet<string> {
  return favoriteIds;
}

/** Seed/extend the set with ids known to be favorites; marks the cache as loaded. */
export function addFavoriteIds(ids: Iterable<string>): void {
  for (const id of ids) favoriteIds.add(id);
  loaded = true;
}

/** Reflect a single toggle so the cache stays correct without a refetch. */
export function markFavorite(id: string, favorite: boolean): void {
  if (favorite) favoriteIds.add(id);
  else favoriteIds.delete(id);
}

/** Drop everything (e.g. after auth changes) so the next visit reseeds for the new user. */
export function clearFavoriteIdsCache(): void {
  favoriteIds.clear();
  loaded = false;
}
