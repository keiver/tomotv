import type { MultiviewArrangement, MultiviewQueued } from "@/services/liveTvPreferences";
import { multiviewChannels, multiviewFeatured, multiviewLiveCount, multiviewSpotCount, type MultiviewLayoutName } from "@keiver/tomo-live/src/multiviewLayout";

const empty = (count: number) => Array<null>(Math.max(0, count)).fill(null);

/** The layout's live spots filled with `mainId` first and the channels around it in `list`; the picture spots start empty. */
export function seedArrangement(layout: MultiviewLayoutName, list: readonly string[], mainId: string, skip: (channelId: string) => boolean): MultiviewArrangement {
  const live = multiviewLiveCount(layout);
  const filled = multiviewChannels(list, mainId, live, skip);
  const spots = filled.length > 0 ? filled : [mainId];
  return { layout, spots: [...spots, ...empty(multiviewSpotCount(layout) - spots.length)], chosen: [mainId] };
}

/**
 * Another layout: live channels stay live in order and picture channels stay pictures; live channels past the new
 * layout's live spots move to its picture spots, empty live spots fill from `fresh`, and what fits nowhere is dropped.
 */
export function resizeArrangement(arrangement: MultiviewArrangement, layout: MultiviewLayoutName, fresh: readonly string[]): MultiviewArrangement {
  const before = multiviewLiveCount(arrangement.layout);
  const live = multiviewLiveCount(layout);
  const pictures = multiviewSpotCount(layout) - live;
  const wasLive = arrangement.spots.slice(0, before).filter((id): id is string => !!id);
  const wasPicture = arrangement.spots.slice(before).filter((id): id is string => !!id);
  const liveSpots: (string | null)[] = wasLive.slice(0, live);
  const pictureSpots: (string | null)[] = [...wasLive.slice(live), ...wasPicture].slice(0, pictures);
  const extra = fresh.filter((channelId) => !liveSpots.includes(channelId) && !pictureSpots.includes(channelId));
  while (liveSpots.length < live) liveSpots.push(extra.shift() ?? null);
  const spots = [...liveSpots, ...pictureSpots, ...empty(pictures - pictureSpots.length)];
  return { ...arrangement, layout, spots, chosen: arrangement.chosen.filter((channelId) => spots.includes(channelId)) };
}

/** The viewer picks `layout`: the first spot's channel stays first, and new live spots fill from the channels around it in `list`. */
export function switchLayout(arrangement: MultiviewArrangement, layout: MultiviewLayoutName, list: readonly string[], skip: (channelId: string) => boolean): MultiviewArrangement {
  const main = arrangement.spots[0];
  const fresh = main ? multiviewChannels(list, main, multiviewLiveCount(layout), skip) : list.filter((id) => !skip(id));
  return resizeArrangement(arrangement, layout, fresh);
}

/**
 * The spot at `index` takes the sound. A featured layout swaps it into the big first spot, so the sound is always there;
 * an equal one leaves live spots where they are. A picture spot trades its channel with the spot that has the sound.
 * Returns the arrangement and the spot with the sound.
 */
export function promoteSpot(arrangement: MultiviewArrangement, index: number, soundAt: number): { arrangement: MultiviewArrangement; soundAt: number } {
  const featured = multiviewFeatured(arrangement.layout);
  const picture = index >= multiviewLiveCount(arrangement.layout);
  if (!picture && (!featured || index === 0)) return { arrangement, soundAt: index };
  const target = featured ? 0 : soundAt;
  const spots = [...arrangement.spots];
  [spots[target], spots[index]] = [spots[index], spots[target]];
  return { arrangement: { ...arrangement, spots }, soundAt: target };
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

/** The live sessions' order: the spot with the sound first, then the other live spots; picture spots and empty spots left out. */
export function liveOrder(arrangement: MultiviewArrangement, soundAt: number): string[] {
  const live = arrangement.spots.slice(0, multiviewLiveCount(arrangement.layout));
  const sound = live[soundAt];
  return [...(sound ? [sound] : []), ...live.filter((id, index): id is string => !!id && index !== soundAt)];
}

/** Queued programmes airing now, those still to come, and when the next one starts. */
export function dueQueue(queue: readonly MultiviewQueued[], nowMs: number): { due: MultiviewQueued[]; rest: MultiviewQueued[]; nextAt: number | null } {
  const live = queue.filter((entry) => entry.endMs > nowMs);
  const due = live.filter((entry) => entry.startMs <= nowMs);
  const rest = live.filter((entry) => entry.startMs > nowMs);
  return { due, rest, nextAt: rest.length > 0 ? Math.min(...rest.map((entry) => entry.startMs)) : null };
}
