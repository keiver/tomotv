/**
 * "Playback owns the link right now." A leaf module: any of its callers importing
 * another would cycle through the jellyfinApi barrel. Owner-keyed so audio ending
 * cannot clear the video session's hold.
 */
const owners = new Set<string>();
const releaseListeners = new Set<() => void>();
const takeListeners = new Set<() => void>();

/** Held by whichever surface owns live playback ("video", "audio"), cleared when it ends. */
export function setPlaybackHold(owner: string, active: boolean): void {
  if (active) {
    const wasFree = owners.size === 0;
    owners.add(owner);
    if (wasFree) for (const listener of [...takeListeners]) listener();
    return;
  }
  const wasHeld = owners.size > 0;
  owners.delete(owner);
  if (wasHeld && owners.size === 0) for (const listener of [...releaseListeners]) listener();
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

/** True while playback owns the link: background work that downloads stands down. */
export function isPlaybackHeld(): boolean {
  return owners.size > 0;
}
