/**
 * Cross-cutting pub/sub for the Jellyfin layer. Plain module state (not React) so any
 * module here can fire a change and every subscribed screen repaints, without the
 * emitters needing to know who is listening.
 *
 * Leaf module: depends on nothing else under services/jellyfin/. Keep it that way —
 * session, userData and playback all import it, so a dependency here would cycle.
 */

// Auth-change pub/sub so UI (e.g. the tab bar) can react synchronously to login/logout.
const authListeners = new Set<() => void>();

/** Subscribe to login/logout transitions. Returns an unsubscribe function. */
export function subscribeAuthChange(cb: () => void): () => void {
  authListeners.add(cb);
  return () => authListeners.delete(cb);
}

export function notifyAuthChange(): void {
  authListeners.forEach((cb) => cb());
}

/**
 * Fire the auth-change refresh path after connection recovery confirms the
 * server is reachable again without any credential/URL change (a transient
 * blip). Consumers that show a load error re-fetch through the same
 * subscription that handles login.
 */
export function notifyServerRecovered(): void {
  notifyAuthChange();
}

// Favorite-change pub/sub. Carries the toggled item id and its new state so subscribers can repaint
// that exact card in place — the browse's per-item UserData.IsFavorite is unreliable and the heart
// cache is add-only, so a removal has no other way to clear the heart without a full (racy) refetch.
const favoriteListeners = new Set<(itemId: string, favorite: boolean) => void>();

/** Subscribe to favorite toggles. Returns an unsubscribe function. */
export function subscribeFavoriteChange(cb: (itemId: string, favorite: boolean) => void): () => void {
  favoriteListeners.add(cb);
  return () => favoriteListeners.delete(cb);
}

export function notifyFavoriteChange(itemId: string, favorite: boolean): void {
  favoriteListeners.forEach((cb) => cb(itemId, favorite));
}

// Played-change pub/sub, mirroring the favorite one: carries the item id and its new
// state so subscribers repaint that exact card's checkmark in place, no refetch.
const playedListeners = new Set<(itemId: string, played: boolean) => void>();

/** Subscribe to played-state changes (manual toggles, playback completion). Returns unsubscribe. */
export function subscribePlayedChange(cb: (itemId: string, played: boolean) => void): () => void {
  playedListeners.add(cb);
  return () => playedListeners.delete(cb);
}

export function notifyPlayedChange(itemId: string, played: boolean): void {
  playedListeners.forEach((cb) => cb(itemId, played));
}

// Resume-change pub/sub, mirroring the played one: fired whenever the server's resume
// state for an item was just rewritten (playback stop, resume persist, manual clear).
// A Continue Watching view fetched DURING those writes can catch the server mid-update
// (a Resume query concurrent with Sessions/Stopped transiently omits the item), so the
// row must refetch after the LAST write lands — this signal is that trigger.
const resumeListeners = new Set<() => void>();

/** Subscribe to resume-state changes. Returns unsubscribe. */
export function subscribeResumeChange(cb: () => void): () => void {
  resumeListeners.add(cb);
  return () => resumeListeners.delete(cb);
}

export function notifyResumeChange(): void {
  resumeListeners.forEach((cb) => cb());
}
