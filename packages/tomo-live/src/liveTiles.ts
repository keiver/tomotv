/** Multiview's live tiles: the main at playback priority, satellites at preview priority, opened one at a time; a tile that
 *  cannot stay live shows the sampler's clip and picture. */
import {
  engineLog,
  isConnectionBudgetFailure,
  LiveProviderFullError,
  originConnectionLimit,
  readBound,
  setLiveSessionPriority,
  setLiveWindow,
  stopLocalRemux,
  subscribeEngineFailure,
  subscribeEngineThroughput,
} from "@keiver/tomo-engine";
import { AppState } from "react-native";
import { isTunerChannel } from "./channelOrigin";
import { startChannelSession } from "./channelSession";
import { liveChannels } from "./config";
import { setLiveFrameOriginHold } from "./liveFrames";
import type { HotChannel, RingSession } from "./liveRing";
import { isPlaybackHeld, onPlaybackHoldReleased, onPlaybackHoldTaken } from "./playbackHold";
import { playlistChannelById } from "./playlistChannels";

/** A tile session's window: disk, not playback, is what it bounds. */
export const LIVE_TILE_WINDOW_SECONDS = 20;
const PLAYING_WINDOW_SECONDS = 300;
/** Opens start this far apart, so tile opens never land as a burst. */
export const LIVE_TILE_OPEN_SPACING_MS = 1_000;
/** After a drop for the link, the next read-bound segment drops another tile only past this. */
export const LIVE_TILE_DROP_SPACING_MS = 10_000;
/** The main kept this long after playback takes the hold, so the player opening it can take its session. */
export const LIVE_TILE_HANDOFF_GRACE_MS = 5_000;

interface Tile {
  channelId: string;
  details: unknown;
  url: string;
  token: string;
  originKey?: string;
  unsubscribe: () => void;
}

/** The channels on screen, the main first. */
let order: string[] = [];
const tiles = new Map<string, Tile>();
const starting = new Set<string>();
/** Refused for the provider's budget: tried again once any tile session closes. */
const refused = new Set<string>();
/** Cannot be a live tile while the set on screen stays the same. */
const failed = new Set<string>();
/** Dropped for the link or memory: back once the main or the set changes. */
const dropped = new Set<string>();
/** Never a satellite while multiview is open: the channel needs a server open, or the engine cannot take it. */
const unavailable = new Set<string>();
/** Spots the viewer filled: opened as the player opens a channel. */
let chosen = new Set<string>();
/** Each channel's provider, read off its resolve, so a provider with no room is known before the next open. */
const knownOrigins = new Map<string, string>();
let generation = 0;
/** The generation whose open loop is running. */
let openingFor: number | null = null;
let lastDropAt = 0;
/** The provider a one-connection main holds in the sampler. */
let heldOrigin: string | null = null;
let holdGrace: ReturnType<typeof setTimeout> | null = null;
let version = 0;
const listeners = new Set<() => void>();
let wired = false;

function notify(): void {
  version += 1;
  for (const listener of listeners) listener();
}

function originKeyOf(channelId: string, details?: unknown): string | undefined {
  const channels = liveChannels();
  const fromItem = details !== undefined ? channels.originKey?.(details) : undefined;
  return fromItem ?? knownOrigins.get(channelId) ?? playlistChannelById(channelId)?.originKey ?? tiles.get(channelId)?.originKey;
}

/** A satellite whose provider has no slot for it: one connection, or two beside the main and the grabs' spare. */
function noRoomForSatellite(channelId: string): boolean {
  const key = originKeyOf(channelId);
  const limit = originConnectionLimit(key);
  return limit === 1 || (limit === 2 && key !== undefined && key === originKeyOf(main() ?? ""));
}

function main(): string | undefined {
  return order[0];
}

/** The channels that should be live now, in open order. */
function wanted(): string[] {
  if (order.length === 0 || isPlaybackHeld()) return [];
  const live = (channelId: string) => !failed.has(channelId) && !refused.has(channelId);
  const head = main()!;
  // A spot the viewer filled is theirs to spend a server open or a tuner on; the others never are.
  const mayOpen = (channelId: string) => chosen.has(channelId) || (!unavailable.has(channelId) && !isTunerChannel(channelId));
  const satellites = order.slice(1).filter((channelId) => live(channelId) && !dropped.has(channelId) && mayOpen(channelId) && !noRoomForSatellite(channelId));
  return (live(head) ? [head] : []).concat(satellites);
}

function priorityOf(channelId: string): "playback" | "preview" {
  return channelId === main() ? "playback" : "preview";
}

function releaseHold(): void {
  if (heldOrigin === null) return;
  const key = heldOrigin;
  heldOrigin = null;
  setLiveFrameOriginHold(key, false);
}

function endTile(tile: Tile, why: string, stop = true): void {
  if (tiles.get(tile.channelId) !== tile) return;
  tiles.delete(tile.channelId);
  tile.unsubscribe();
  if (stop) void stopLocalRemux(tile.token);
  // A main the server opened holds that open until it is closed, its session ended or not.
  const channels = liveChannels();
  if (channels.holdsOpen(tile.details)) void channels.close(tile.details);
  if (tile.channelId === main()) releaseHold();
  // A closed session may be the slot a refused tile was waiting for.
  refused.clear();
  engineLog().debug("Live tile ended", { service: "LiveTile", channel: liveChannels().name(tile.details), why });
}

/** The tile furthest from the main that plays live goes to its clip, no sooner than the last drop's spacing. */
function dropFurthest(why: string): void {
  const now = Date.now();
  if (now - lastDropAt < LIVE_TILE_DROP_SPACING_MS) return;
  const victim = [...order].reverse().find((channelId) => channelId !== main() && tiles.has(channelId));
  if (!victim) return;
  lastDropAt = now;
  dropped.add(victim);
  engineLog().info("Live tile dropped to its clip", { service: "LiveTile", channelId: victim, why });
  reconcile();
}

function watch(tile: Tile): void {
  const stopThroughput = subscribeEngineThroughput(tile.token, (sample) => {
    if (readBound(sample)) dropFurthest("read-bound segment");
  });
  const stopFailure = subscribeEngineFailure(tile.token, (failure) => {
    if (tiles.get(tile.channelId) !== tile) return;
    endTile(tile, failure.message, false);
    (isConnectionBudgetFailure(failure.message) ? refused : failed).add(tile.channelId);
    reconcile();
    notify();
  });
  tile.unsubscribe = () => {
    stopThroughput();
    stopFailure();
  };
}

function adopt(channelId: string, details: unknown, url: string, token: string): Tile {
  const tile: Tile = { channelId, details, url, token, originKey: originKeyOf(channelId, details), unsubscribe: () => {} };
  watch(tile);
  tiles.set(channelId, tile);
  if (channelId === main() && tile.originKey && originConnectionLimit(tile.originKey) === 1) {
    heldOrigin = tile.originKey;
    setLiveFrameOriginHold(tile.originKey, true);
  }
  return tile;
}

async function open(channelId: string, mine: number): Promise<void> {
  const priority = priorityOf(channelId);
  const current = () => mine === generation && wanted().includes(channelId) && !tiles.has(channelId);
  if (priority === "playback") {
    // The main takes the one connection before it opens, so a grab reading on it now lets it go.
    const key = originKeyOf(channelId);
    if (key && originConnectionLimit(key) === 1) {
      heldOrigin = key;
      setLiveFrameOriginHold(key, true);
    }
  }
  starting.add(channelId);
  try {
    // The main is what the viewer chose to watch: opened as the player opens it, on the server when it must be.
    const allow = (details: unknown) => {
      const key = liveChannels().originKey?.(details);
      if (key) knownOrigins.set(channelId, key);
      return priority === "playback" || !noRoomForSatellite(channelId);
    };
    const started = await startChannelSession(channelId, { windowSeconds: LIVE_TILE_WINDOW_SECONDS, priority, current, openOnServer: priority === "playback" || chosen.has(channelId), allow });
    if (started === "unavailable") (priority === "playback" || chosen.has(channelId) ? failed : unavailable).add(channelId);
    if (typeof started === "string") {
      if (channelId === main() && !tiles.has(channelId)) releaseHold();
      return;
    }
    if (!current()) {
      void stopLocalRemux(started.token);
      return;
    }
    adopt(channelId, started.details, started.url, started.token);
    engineLog().info("Live tile playing", { service: "LiveTile", channel: liveChannels().name(started.details), priority });
  } catch (error) {
    if (mine !== generation) return;
    const budget = error instanceof LiveProviderFullError || isConnectionBudgetFailure(error instanceof Error ? error.message : String(error));
    (budget ? refused : failed).add(channelId);
    if (channelId === main()) releaseHold();
    engineLog().debug("Live tile did not start", { service: "LiveTile", channelId, error: String(error) });
  } finally {
    starting.delete(channelId);
    notify();
  }
}

/** One loop per generation: a loop a stop outdated exits on its own and never holds the next one back. */
async function openWanted(): Promise<void> {
  const mine = generation;
  if (openingFor === mine) return;
  openingFor = mine;
  try {
    for (;;) {
      const next = wanted().find((channelId) => !tiles.has(channelId) && !starting.has(channelId));
      if (!next || mine !== generation) return;
      await open(next, mine);
      if (mine !== generation) return;
      await new Promise((resolve) => setTimeout(resolve, LIVE_TILE_OPEN_SPACING_MS));
    }
  } finally {
    if (openingFor === mine) openingFor = null;
  }
}

/** Ends the tiles no longer wanted, sets each tile's priority to its spot, and opens what is missing. */
function reconcile(): void {
  const want = new Set(wanted());
  for (const tile of [...tiles.values()]) if (!want.has(tile.channelId)) endTile(tile, "not on screen live");
  for (const tile of tiles.values()) void setLiveSessionPriority(tile.token, priorityOf(tile.channelId));
  notify();
  void openWanted();
}

function stopAll(why: string, keep?: string): void {
  generation += 1;
  for (const tile of [...tiles.values()]) if (tile.channelId !== keep) endTile(tile, why);
  if (keep === undefined || !tiles.has(keep)) releaseHold();
}

function wire(): void {
  if (wired) return;
  wired = true;
  AppState.addEventListener("memoryWarning", () => {
    if (order.length === 0) return;
    for (const channelId of order.slice(1)) dropped.add(channelId);
    reconcile();
  });
  AppState.addEventListener("change", (state) => {
    if (order.length === 0) return;
    if (state === "active") reconcile();
    else stopAll("app left the foreground");
  });
  // The player opening the main takes the hold before it takes the main's session: the main waits out the handoff.
  onPlaybackHoldTaken(() => {
    if (order.length === 0) return;
    const head = main()!;
    const kept = tiles.get(head);
    stopAll("playback holds the link", head);
    if (!kept) return;
    if (holdGrace) clearTimeout(holdGrace);
    holdGrace = setTimeout(() => {
      holdGrace = null;
      if (tiles.get(head) === kept && isPlaybackHeld()) endTile(kept, "the player did not take it");
    }, LIVE_TILE_HANDOFF_GRACE_MS);
  });
  onPlaybackHoldReleased(() => {
    if (order.length > 0) reconcile();
  });
}

/**
 * The channels multiview shows, the main first; an empty list ends every tile. A new main or set brings dropped tiles back.
 * `chosen`: spots the viewer filled, opened as the player opens a channel, a hardware tuner included.
 */
export function setLiveTiles(channelIds: readonly string[], options: { chosen?: readonly string[] } = {}): void {
  wire();
  const next = [...new Set(channelIds)];
  const nextChosen = new Set(options.chosen ?? []);
  const chosenChanged = nextChosen.size !== chosen.size || [...nextChosen].some((channelId) => !chosen.has(channelId));
  chosen = nextChosen;
  if (next.join("\n") === order.join("\n")) {
    if (chosenChanged) reconcile();
    return;
  }
  const mainChanged = next[0] !== order[0];
  const setChanged = next.length !== order.length || next.some((channelId) => !order.includes(channelId));
  order = next;
  dropped.clear();
  if (setChanged) failed.clear();
  if (order.length === 0) {
    stopAll("multiview closed");
    unavailable.clear();
    knownOrigins.clear();
    notify();
    return;
  }
  if (mainChanged) releaseHold();
  reconcile();
}

/** The tile's player failed or none was free: its session plays to nobody, so it ends and the tile shows its clip. */
export function noteLiveTileFailed(channelId: string): void {
  if (!tiles.has(channelId)) return;
  (channelId === main() ? failed : dropped).add(channelId);
  reconcile();
}

/** The tile's live URL, null while it shows its clip or picture. */
export function liveTileUrl(channelId: string): string | null {
  return tiles.get(channelId)?.url ?? null;
}

/** A channel that cannot be a satellite: a hardware tuner, one the server must open, or one the engine cannot take. */
export function liveTileUnavailable(channelId: string): boolean {
  return unavailable.has(channelId) || isTunerChannel(channelId);
}

/** Changes whenever a tile goes live or ends. */
export function liveTilesVersion(): number {
  return version;
}

export function subscribeLiveTiles(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** The player takes the tile's session instead of opening the channel again; null when there is none. */
export function takeLiveTile<Item = unknown>(channelId: string): RingSession<Item> | null {
  const tile = tiles.get(channelId);
  if (!tile) return null;
  tiles.delete(channelId);
  tile.unsubscribe();
  if (channelId === main()) releaseHold();
  void setLiveWindow(tile.token, PLAYING_WINDOW_SECONDS);
  void setLiveSessionPriority(tile.token, "playback");
  engineLog().info("Live tile adopted by the player", { service: "LiveTile", channel: liveChannels().name(tile.details) });
  notify();
  return { channelId, details: tile.details as Item, url: tile.url, token: tile.token, ready: true };
}

/** A channel the player leaves while multiview shows it plays on in its tile. False: stop it. */
export function retainLiveTile<Item = unknown>(channel: HotChannel<Item>): boolean {
  if (!order.includes(channel.channelId) || tiles.has(channel.channelId)) return false;
  adopt(channel.channelId, channel.details, channel.url, channel.token);
  void setLiveWindow(channel.token, LIVE_TILE_WINDOW_SECONDS);
  void setLiveSessionPriority(channel.token, priorityOf(channel.channelId));
  notify();
  return true;
}
