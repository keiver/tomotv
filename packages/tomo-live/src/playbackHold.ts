/**
 * "Playback owns the link right now." A leaf module: its callers span the app, so it
 * imports nothing. Owner-keyed so audio ending
 * cannot clear the video session's hold.
 */
const owners = new Set<string>();
const releaseListeners = new Set<() => void>();
const takeListeners = new Set<() => void>();
const changeListeners = new Set<() => void>();

/** Held by whichever surface owns live playback ("video", "audio"), cleared when it ends. */
export function setPlaybackHold(owner: string, active: boolean): void {
  if (active) {
    const wasFree = owners.size === 0;
    const joined = !owners.has(owner);
    owners.add(owner);
    if (wasFree) for (const listener of [...takeListeners]) listener();
    if (joined) for (const listener of [...changeListeners]) listener();
    return;
  }
  const wasHeld = owners.size > 0;
  const left = owners.delete(owner);
  if (wasHeld && owners.size === 0) for (const listener of [...releaseListeners]) listener();
  if (left) for (const listener of [...changeListeners]) listener();
}

/** Runs whenever any owner takes or lets go, for work that cares which one holds. */
export function onPlaybackHoldChange(listener: () => void): () => void {
  changeListeners.add(listener);
  return () => changeListeners.delete(listener);
}

/** Runs once the last owner lets go, for work that stood down while playback held the link. */
export function onPlaybackHoldReleased(listener: () => void): () => void {
  releaseListeners.add(listener);
  return () => releaseListeners.delete(listener);
}

/** Runs the moment the first owner takes the link, for work that must let go of it at once. */
export function onPlaybackHoldTaken(listener: () => void): () => void {
  takeListeners.add(listener);
  return () => takeListeners.delete(listener);
}

/** True while playback owns the link (or, given an owner, while that one holds it): background
 *  work that downloads stands down. */
export function isPlaybackHeld(owner?: string): boolean {
  return owner ? owners.has(owner) : owners.size > 0;
}
