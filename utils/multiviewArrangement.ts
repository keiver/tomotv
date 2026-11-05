import type { MultiviewArrangement, MultiviewQueued } from "@/services/liveTvPreferences";
import { multiviewChannels, multiviewFeatured, multiviewSpotCount, type MultiviewLayoutName } from "@keiver/tomo-live/src/multiviewLayout";

/** The layout's spots filled with `mainId` first and the channels around it in `list`; spots left over stay empty. */
export function seedArrangement(layout: MultiviewLayoutName, list: readonly string[], mainId: string, skip: (channelId: string) => boolean, strip: boolean): MultiviewArrangement {
  const count = multiviewSpotCount(layout);
  const filled = multiviewChannels(list, mainId, count, skip);
  const spots = filled.length > 0 ? filled : [mainId];
  return { layout, spots: [...spots, ...Array<null>(count - spots.length).fill(null)], chosen: [mainId], strip };
}

/** Another layout: the spots keep their channels in order, a shorter layout drops the last, a longer one fills from `fresh`. */
export function resizeArrangement(arrangement: MultiviewArrangement, layout: MultiviewLayoutName, fresh: readonly string[]): MultiviewArrangement {
  const count = multiviewSpotCount(layout);
  const spots = arrangement.spots.slice(0, count);
  const extra = fresh.filter((channelId) => !spots.includes(channelId));
  while (spots.length < count) spots.push(extra.shift() ?? null);
  return { ...arrangement, layout, spots, chosen: arrangement.chosen.filter((channelId) => spots.includes(channelId)) };
}

/**
 * The spot at `index` takes the sound. A featured layout swaps it into the big first spot, so the sound is always there;
 * an equal one leaves the spots where they are. Returns the arrangement and the spot with the sound.
 */
export function promoteSpot(arrangement: MultiviewArrangement, index: number): { arrangement: MultiviewArrangement; soundAt: number } {
  if (!multiviewFeatured(arrangement.layout) || index === 0) return { arrangement, soundAt: index };
  const spots = [...arrangement.spots];
  [spots[0], spots[index]] = [spots[index], spots[0]];
  return { arrangement: { ...arrangement, spots }, soundAt: 0 };
}

/** The viewer puts `channelId` in the spot at `index`; a spot already showing it trades places with that spot. */
export function placeChannel(arrangement: MultiviewArrangement, index: number, channelId: string): MultiviewArrangement {
  const spots = [...arrangement.spots];
  const was = spots.indexOf(channelId);
  if (was >= 0) spots[was] = spots[index] ?? null;
  spots[index] = channelId;
  const chosen = [...new Set([...arrangement.chosen, channelId])].filter((id) => spots.includes(id));
  return { ...arrangement, spots, chosen };
}

export function clearSpot(arrangement: MultiviewArrangement, index: number): MultiviewArrangement {
  const spots = [...arrangement.spots];
  spots[index] = null;
  return { ...arrangement, spots, chosen: arrangement.chosen.filter((id) => spots.includes(id)) };
}

/** The live sessions' order: the spot with the sound first, then the others, empty spots left out. */
export function liveOrder(arrangement: MultiviewArrangement, soundAt: number): string[] {
  const sound = arrangement.spots[soundAt];
  return [...(sound ? [sound] : []), ...arrangement.spots.filter((id, index): id is string => !!id && index !== soundAt)];
}

/** Queued programmes airing now, those still to come, and when the next one starts. */
export function dueQueue(queue: readonly MultiviewQueued[], nowMs: number): { due: MultiviewQueued[]; rest: MultiviewQueued[]; nextAt: number | null } {
  const live = queue.filter((entry) => entry.endMs > nowMs);
  const due = live.filter((entry) => entry.startMs <= nowMs);
  const rest = live.filter((entry) => entry.startMs > nowMs);
  return { due, rest, nextAt: rest.length > 0 ? Math.min(...rest.map((entry) => entry.startMs)) : null };
}
