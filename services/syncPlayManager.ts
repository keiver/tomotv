/**
 * SyncPlay group state and the bridge between the server's broadcast and the local player.
 *
 * The server owns playback: it sends Unpause/Pause/Seek/Stop stamped with a UTC When, and a
 * client executes each at When minus the measured clock offset. User actions on AVKit's own
 * transport are detected after the fact and forwarded to the server, never applied locally, so
 * the broadcast is the single source of truth. `expectedPaused` marks the player changes we
 * caused so they are not echoed back as requests.
 *
 * Traps this guards, all from Moonfin's native-player implementation:
 *  - A Ready sent while the group is already Playing is answered with an Unpause echo at the
 *    same When/Position; acting on it seeks, the seek raises a buffering edge, that sends
 *    another Ready. `lastSyncPoint` equality makes the echo a confirmation.
 *  - Buffering edges inside `suppressUntilMs` of our own seek/resume are the seek, not a stall.
 *  - The player starts paused for the handshake; playing through it reports Ready from ahead.
 */
import {
  fetchSyncPlayAccess,
  listSyncPlayGroups,
  createSyncPlayGroup,
  joinSyncPlayGroup,
  leaveSyncPlayGroup,
  measureServerClock,
  syncPlayBuffering,
  syncPlayNextItem,
  syncPlayPause,
  syncPlayPing,
  syncPlayReady,
  syncPlaySeek,
  syncPlaySetIgnoreWait,
  syncPlaySetNewQueue,
  syncPlayUnpause,
  SyncPlayAccess,
  SyncPlayCommand,
  SyncPlayGroupInfo,
  SyncPlayGroupState,
  SyncPlayPlayQueue,
  SyncPlayQueueItem,
} from "@/services/jellyfinApi";
import { JellyfinVideoItem } from "@/types/jellyfin";
import { logger } from "@/utils/logger";
import { closeServerSocket, openServerSocket, subscribeServerMessage, subscribeServerSocketOpen, whenServerSocketOpen } from "./jellyfin/socket";
import { evaluateDrift, medianOffset, medianPing, SYNC_PLAY } from "./syncPlayTiming";

const TICKS_PER_SECOND = 10_000_000;

export interface SyncPlaySnapshot {
  access: SyncPlayAccess | null;
  groups: SyncPlayGroupInfo[];
  listing: boolean;
  busy: null | "creating" | "joining" | "leaving";
  group: null | {
    groupId: string;
    groupName: string;
    participants: string[];
    state: SyncPlayGroupState;
  };
  error: string | null;
}

/** The player registers this so the manager can drive it without importing React. */
export interface PlayerControls {
  videoId: string;
  seekTo(seconds: number, toleranceMs?: number): void;
  setPaused(paused: boolean): void;
  getPositionSeconds(): number;
}

/** What the driver needs to open the group's item and end on Stop. */
export interface SyncPlayQueueTarget {
  playlist: SyncPlayQueueItem[];
  playingItemIndex: number;
  startPositionTicks: number;
}
export type SyncPlayDriverEvent = { kind: "playQueue"; target: SyncPlayQueueTarget } | { kind: "stop" };

let snapshot: SyncPlaySnapshot = { access: null, groups: [], listing: false, busy: null, group: null, error: null };
const listeners = new Set<(s: SyncPlaySnapshot) => void>();
const driverListeners = new Set<(e: SyncPlayDriverEvent) => void>();

let joinedAtServerMs = 0;
let clockSamples: { offsetMs: number; pingMs: number }[] = [];
let offsetMs = 0;
let pingMs: number = SYNC_PLAY.KEEPALIVE_FALLBACK_S;
let clockTimer: ReturnType<typeof setTimeout> | null = null;
let pollTimer: ReturnType<typeof setInterval> | null = null;
let commandTimer: ReturnType<typeof setTimeout> | null = null;
let driftTimer: ReturnType<typeof setInterval> | null = null;
let socketSubscriptions: (() => void)[] = [];

let playlist: SyncPlayQueueItem[] = [];
let currentPlaylistItemId: string | null = null;
let lastSyncPoint: { when: string; positionTicks: number } | null = null;
let readyOwed = false;
let suppressUntilMs = 0;
let expectedPaused: boolean | null = null;
let holdingForDrift = false;
let controls: PlayerControls | null = null;
let playerSeconds = 0;

function emit(): void {
  listeners.forEach((cb) => cb(snapshot));
}

function setSnapshot(patch: Partial<SyncPlaySnapshot>): void {
  snapshot = { ...snapshot, ...patch };
  emit();
}

export function subscribe(cb: (s: SyncPlaySnapshot) => void): () => void {
  listeners.add(cb);
  cb(snapshot);
  return () => listeners.delete(cb);
}

export function subscribeDriver(cb: (e: SyncPlayDriverEvent) => void): () => void {
  driverListeners.add(cb);
  return () => driverListeners.delete(cb);
}

export function getSnapshot(): SyncPlaySnapshot {
  return snapshot;
}

export function isJoined(): boolean {
  return snapshot.group !== null;
}

export function wantsPausedStart(): boolean {
  return snapshot.group !== null;
}

export async function refreshAccess(): Promise<void> {
  try {
    setSnapshot({ access: await fetchSyncPlayAccess() });
  } catch (error) {
    logger.warn("SyncPlay access read failed", error, { service: "SyncPlay" });
  }
}

export async function refreshGroups(): Promise<void> {
  setSnapshot({ listing: true, error: null });
  try {
    const groups = await listSyncPlayGroups();
    setSnapshot({ groups, listing: false });
    // The join/leave updates only name the user, so refresh the joined group's roster and
    // state from the listing rather than trying to reconstruct it from a name.
    if (snapshot.group) {
      const mine = groups.find((group) => group.GroupId === snapshot.group?.groupId);
      if (mine) setSnapshot({ group: { ...snapshot.group, participants: mine.Participants, state: mine.State } });
    }
  } catch (error) {
    logger.warn("SyncPlay group list failed", error, { service: "SyncPlay" });
    setSnapshot({ listing: false, error: "The server could not do that. Try again." });
  }
}

/** Give the server socket a moment to connect before a request whose reply rides it. */
async function readySocket(): Promise<void> {
  ensureSocket();
  await Promise.race([whenServerSocketOpen(), new Promise<void>((resolve) => setTimeout(resolve, 3000))]);
}

export async function createGroup(groupName: string): Promise<void> {
  setSnapshot({ busy: "creating", error: null });
  try {
    await readySocket();
    // Seed from the response so the UI enters the group even if the socket's GroupJoined
    // is delayed; the socket update refines participants and state.
    const info = await createSyncPlayGroup(groupName);
    joinedAtServerMs = Date.now() + offsetMs;
    setSnapshot({ group: { groupId: info.GroupId, groupName: info.GroupName, participants: info.Participants ?? [], state: info.State ?? "Idle" } });
  } catch (error) {
    logger.warn("SyncPlay create failed", error, { service: "SyncPlay" });
    setSnapshot({ error: "The server could not do that. Try again." });
  } finally {
    setSnapshot({ busy: null });
  }
}

export async function joinGroup(groupId: string): Promise<void> {
  setSnapshot({ busy: "joining", error: null });
  try {
    await readySocket();
    await joinSyncPlayGroup(groupId);
  } catch (error) {
    logger.warn("SyncPlay join failed", error, { service: "SyncPlay" });
    setSnapshot({ error: "The server could not do that. Try again." });
  } finally {
    setSnapshot({ busy: null });
  }
}

export async function leaveGroup(): Promise<void> {
  setSnapshot({ busy: "leaving" });
  try {
    await leaveSyncPlayGroup();
  } finally {
    resetGroupState();
    setSnapshot({ busy: null, group: null });
  }
}

export async function playForGroup(items: JellyfinVideoItem[], startIndex: number, startTicks = 0): Promise<void> {
  if (snapshot.group === null) return;
  try {
    await syncPlaySetNewQueue(
      items.map((item) => item.Id),
      Math.max(0, startIndex),
      startTicks,
    );
  } catch (error) {
    logger.warn("SyncPlay set queue failed", error, { service: "SyncPlay" });
    setSnapshot({ error: "The server could not do that. Try again." });
  }
}

export async function requestNextItem(): Promise<void> {
  if (snapshot.group === null || currentPlaylistItemId === null) return;
  await syncPlayNextItem(currentPlaylistItemId);
}

// Player -> manager. Each returns at once when no group is joined.

export function attachControls(next: PlayerControls): () => void {
  controls = next;
  return () => {
    if (controls === next) controls = null;
  };
}

export function notePlayerGone(videoId: string): void {
  if (controls?.videoId === videoId) controls = null;
}

export function notePosition(seconds: number): void {
  if (snapshot.group === null) return;
  playerSeconds = seconds;
}

export function notePlayerReady(videoId: string, seconds: number): void {
  if (snapshot.group === null) return;
  playerSeconds = seconds;
  sendReady(seconds);
}

export function noteBuffering(isBuffering: boolean, seconds: number): void {
  if (snapshot.group === null) return;
  playerSeconds = seconds;
  if (isBuffering) {
    if (Date.now() < suppressUntilMs) return;
    readyOwed = true;
    void syncPlayBuffering(readyBody(seconds));
    return;
  }
  if (readyOwed) sendReady(seconds);
}

export function noteStreamRebuild(): void {
  if (snapshot.group === null) return;
  readyOwed = true;
  void syncPlayBuffering(readyBody(playerSeconds));
}

export function noteSeekCompleted(seconds: number): void {
  if (snapshot.group === null) return;
  playerSeconds = seconds;
  if (Date.now() < suppressUntilMs) return;
  void syncPlaySeek(seconds * TICKS_PER_SECOND);
}

export function notePlaybackState(event: { isPlaying: boolean; isSeeking: boolean }): void {
  if (snapshot.group === null || event.isSeeking) return;
  if (expectedPaused !== null && event.isPlaying === !expectedPaused) {
    expectedPaused = null;
    return;
  }
  if (event.isPlaying) {
    // Re-hold and let the broadcast Unpause start everyone together.
    expectedPaused = true;
    controls?.setPaused(true);
    void syncPlayUnpause();
  } else {
    void syncPlayPause();
  }
}

// Internal helpers

function readyBody(seconds: number) {
  return {
    When: new Date(Date.now() + offsetMs).toISOString(),
    PositionTicks: Math.round(seconds * TICKS_PER_SECOND),
    IsPlaying: expectedPaused === false,
    PlaylistItemId: currentPlaylistItemId ?? "",
  };
}

function sendReady(seconds: number): void {
  readyOwed = false;
  void syncPlayReady(readyBody(seconds));
}

function ensureSocket(): void {
  if (socketSubscriptions.length > 0) return;
  openServerSocket();
  socketSubscriptions = [
    subscribeServerMessage("SyncPlayCommand", (data) => handleCommand(data as SyncPlayCommand)),
    subscribeServerMessage("SyncPlayGroupUpdate", (data) => handleGroupUpdate(data as { GroupId: string; Type: string; Data: unknown })),
    subscribeServerSocketOpen(() => {
      // A reconnect drops us back into the group's Waiting handshake.
      if (snapshot.group !== null) noteStreamRebuild();
    }),
  ];
}

function resetGroupState(): void {
  if (commandTimer) clearTimeout(commandTimer);
  if (clockTimer) clearTimeout(clockTimer);
  if (pollTimer) clearInterval(pollTimer);
  if (driftTimer) clearInterval(driftTimer);
  commandTimer = clockTimer = null;
  pollTimer = driftTimer = null;
  socketSubscriptions.forEach((off) => off());
  socketSubscriptions = [];
  closeServerSocket();
  joinedAtServerMs = 0;
  clockSamples = [];
  offsetMs = 0;
  playlist = [];
  currentPlaylistItemId = null;
  lastSyncPoint = null;
  readyOwed = false;
  suppressUntilMs = 0;
  expectedPaused = null;
  holdingForDrift = false;
}

async function sampleClock(): Promise<void> {
  const sample = await measureServerClock();
  if (!sample) return;
  clockSamples = [...clockSamples, sample].slice(-SYNC_PLAY.CLOCK_SAMPLES);
  offsetMs = medianOffset(clockSamples);
  pingMs = medianPing(clockSamples);
  void syncPlayPing(pingMs);
}

function startClock(): void {
  let greedy = 0;
  const step = () => {
    void sampleClock();
    greedy += 1;
    if (greedy < SYNC_PLAY.GREEDY_SAMPLES) {
      clockTimer = setTimeout(step, SYNC_PLAY.GREEDY_INTERVAL_MS);
    }
  };
  step();
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = setInterval(() => void sampleClock(), SYNC_PLAY.POLL_INTERVAL_MS);
}

function startDrift(): void {
  if (driftTimer) clearInterval(driftTimer);
  driftTimer = setInterval(() => {
    if (snapshot.group?.state !== "Playing" || commandTimer !== null || lastSyncPoint === null) return;
    const groupSeconds = lastSyncPoint.positionTicks / TICKS_PER_SECOND + (Date.now() + offsetMs - Date.parse(lastSyncPoint.when)) / 1000;
    const action = evaluateDrift({ playerSeconds, groupSeconds, holding: holdingForDrift });
    if (action === "hold") {
      holdingForDrift = true;
      expectedPaused = true;
      controls?.setPaused(true);
    } else if (action === "resume") {
      holdingForDrift = false;
      expectedPaused = false;
      controls?.setPaused(false);
    }
  }, SYNC_PLAY.DRIFT_EVAL_MS);
}

function handleCommand(command: SyncPlayCommand): void {
  if (snapshot.group === null) return;
  const isStop = command.Command === "Stop";
  if (!isStop && Date.parse(command.EmittedAt) < joinedAtServerMs) return;
  if (!isStop && command.PlaylistItemId !== currentPlaylistItemId) return;

  if (command.Command === "Unpause" && lastSyncPoint && lastSyncPoint.when === command.When && lastSyncPoint.positionTicks === command.PositionTicks) {
    // Confirmation echo, not a late command: no seek, no schedule.
    readyOwed = false;
    expectedPaused = false;
    controls?.setPaused(false);
    return;
  }

  if (commandTimer) clearTimeout(commandTimer);
  const whenLocal = Date.parse(command.When) - offsetMs;
  commandTimer = setTimeout(
    () => {
      commandTimer = null;
      runCommand(command, whenLocal);
    },
    Math.max(0, whenLocal - Date.now()),
  );
}

function runCommand(command: SyncPlayCommand, whenLocal: number): void {
  if (!controls) return;
  const basePositionSeconds = command.PositionTicks / TICKS_PER_SECOND;
  switch (command.Command) {
    case "Unpause": {
      const lateness = Math.max(0, (Date.now() - whenLocal) / 1000);
      const target = basePositionSeconds + lateness;
      suppressUntilMs = Date.now() + SYNC_PLAY.SEEK_ECHO_WINDOW_MS;
      expectedPaused = false;
      holdingForDrift = false;
      if (Math.abs(target - controls.getPositionSeconds()) > SYNC_PLAY.DRIFT_FLOOR_MS / 1000) {
        controls.seekTo(target, SYNC_PLAY.SEEK_TOLERANCE_MS);
      }
      controls.setPaused(false);
      lastSyncPoint = { when: command.When, positionTicks: command.PositionTicks };
      break;
    }
    case "Pause": {
      expectedPaused = true;
      controls.setPaused(true);
      if (Math.abs(basePositionSeconds - controls.getPositionSeconds()) > SYNC_PLAY.DRIFT_FLOOR_MS / 1000) {
        suppressUntilMs = Date.now() + SYNC_PLAY.SEEK_ECHO_WINDOW_MS;
        controls.seekTo(basePositionSeconds, SYNC_PLAY.SEEK_TOLERANCE_MS);
      }
      lastSyncPoint = { when: command.When, positionTicks: command.PositionTicks };
      break;
    }
    case "Seek": {
      suppressUntilMs = Date.now() + SYNC_PLAY.SEEK_ECHO_WINDOW_MS;
      controls.seekTo(basePositionSeconds, SYNC_PLAY.SEEK_TOLERANCE_MS);
      lastSyncPoint = { when: command.When, positionTicks: command.PositionTicks };
      break;
    }
    case "Stop": {
      expectedPaused = true;
      controls.setPaused(true);
      driverListeners.forEach((cb) => cb({ kind: "stop" }));
      break;
    }
  }
}

function handleGroupUpdate(update: { GroupId: string; Type: string; Data: unknown }): void {
  switch (update.Type) {
    case "GroupJoined": {
      const info = update.Data as SyncPlayGroupInfo;
      joinedAtServerMs = Date.now() + offsetMs;
      setSnapshot({
        group: { groupId: info.GroupId, groupName: info.GroupName, participants: info.Participants ?? [], state: info.State ?? "Idle" },
        error: null,
      });
      startClock();
      startDrift();
      void syncPlaySetIgnoreWait(false);
      // A join to a Playing/Paused group is a Waiting group from our view, with no state update.
      if (info.State === "Playing" || info.State === "Paused") {
        readyOwed = true;
        void syncPlayBuffering(readyBody(playerSeconds));
      }
      break;
    }
    case "GroupLeft":
    case "NotInGroup":
      resetGroupState();
      setSnapshot({ group: null });
      break;
    case "GroupDoesNotExist":
      resetGroupState();
      setSnapshot({ group: null, error: "The server could not do that. Try again." });
      break;
    case "LibraryAccessDenied":
      resetGroupState();
      setSnapshot({ group: null, error: "Your account is not allowed to use Watch Together. Ask the server owner to enable SyncPlay." });
      break;
    case "UserJoined":
    case "UserLeft": {
      if (snapshot.group === null) return;
      void refreshGroups();
      break;
    }
    case "StateUpdate": {
      if (snapshot.group === null) return;
      const data = update.Data as { State?: SyncPlayGroupState };
      if (data.State) setSnapshot({ group: { ...snapshot.group, state: data.State } });
      break;
    }
    case "PlayQueue": {
      const queue = update.Data as SyncPlayPlayQueue;
      playlist = queue.Playlist ?? [];
      const index = queue.PlayingItemIndex ?? 0;
      currentPlaylistItemId = playlist[index]?.PlaylistItemId ?? null;
      lastSyncPoint = null;
      readyOwed = false;
      holdingForDrift = false;
      driverListeners.forEach((cb) => cb({ kind: "playQueue", target: { playlist, playingItemIndex: index, startPositionTicks: queue.StartPositionTicks ?? 0 } }));
      break;
    }
  }
}

export function resetForTests(): void {
  resetGroupState();
  listeners.clear();
  driverListeners.clear();
  controls = null;
  playerSeconds = 0;
  pingMs = SYNC_PLAY.KEEPALIVE_FALLBACK_S;
  snapshot = { access: null, groups: [], listing: false, busy: null, group: null, error: null };
}

/** Test seam: drive a raw command as if it arrived on the socket. */
export function __handleCommandForTests(command: SyncPlayCommand): void {
  handleCommand(command);
}

/** Test seam: drive a raw group update as if it arrived on the socket. */
export function __handleGroupUpdateForTests(update: { GroupId: string; Type: string; Data: unknown }): void {
  handleGroupUpdate(update);
}

/** Test seam: read private timing state. */
export function __getTimingForTests() {
  return { offsetMs, joinedAtServerMs, readyOwed, expectedPaused, suppressUntilMs, currentPlaylistItemId, lastSyncPoint };
}

/** Test seam: set the clock offset without a network round trip. */
export function __setOffsetForTests(value: number): void {
  offsetMs = value;
}
