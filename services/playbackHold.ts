/**
 * "Playback owns the link right now."
 *
 * Its own module, importing nothing: the video host, the audio manager and the
 * Jellyfin services all read or write this, and any of them importing another
 * would cycle through the jellyfinApi barrel.
 *
 * Owner-keyed rather than a bare boolean, so audio ending cannot clear the
 * video session's hold.
 */
const owners = new Set<string>();

/** Held by whichever surface owns live playback ("video", "audio"), cleared when it ends. */
export function setPlaybackHold(owner: string, active: boolean): void {
  if (active) {
    owners.add(owner);
  } else {
    owners.delete(owner);
  }
}

/** True while playback owns the link: background work that downloads stands down. */
export function isPlaybackHeld(): boolean {
  return owners.size > 0;
}
