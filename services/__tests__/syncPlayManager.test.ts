/**
 * SyncPlay manager: command scheduling, the stale/mismatch drops, the Unpause echo guard, the
 * buffering suppression window, and forwarding a viewer's transport action to the server.
 */
jest.mock("@/services/jellyfinApi", () => ({
  fetchSyncPlayAccess: jest.fn(),
  getConfig: jest.fn().mockResolvedValue({ server: "http://s", apiKey: "k", userId: "u1", deviceId: "d" }),
  listSyncPlayGroups: jest.fn().mockResolvedValue([]),
  createSyncPlayGroup: jest.fn().mockResolvedValue({ GroupId: "g1", GroupName: "Movie night", State: "Idle", Participants: ["a"], LastUpdatedAt: "x" }),
  joinSyncPlayGroup: jest.fn(),
  leaveSyncPlayGroup: jest.fn(),
  measureServerClock: jest.fn().mockResolvedValue(null),
  subscribeAuthChange: jest.fn(() => () => {}),
  syncPlayBuffering: jest.fn().mockResolvedValue(undefined),
  syncPlayNextItem: jest.fn().mockResolvedValue(undefined),
  syncPlayPause: jest.fn().mockResolvedValue(undefined),
  syncPlayPing: jest.fn().mockResolvedValue(undefined),
  syncPlayReady: jest.fn().mockResolvedValue(undefined),
  syncPlaySeek: jest.fn().mockResolvedValue(undefined),
  syncPlaySetIgnoreWait: jest.fn().mockResolvedValue(undefined),
  syncPlaySetNewQueue: jest.fn().mockResolvedValue(undefined),
  syncPlayStop: jest.fn().mockResolvedValue(undefined),
  syncPlayUnpause: jest.fn().mockResolvedValue(undefined),
}));

jest.mock("../jellyfin/socket", () => ({
  openServerSocket: jest.fn(),
  closeServerSocket: jest.fn(),
  subscribeServerMessage: jest.fn(() => () => {}),
  subscribeServerSocketOpen: jest.fn(() => () => {}),
  isServerSocketOpen: jest.fn(() => true),
  whenServerSocketOpen: jest.fn().mockResolvedValue(undefined),
}));

import * as api from "@/services/jellyfinApi";
import * as socket from "../jellyfin/socket";
import {
  __getTimingForTests,
  __handleAuthChangeForTests,
  __handleCommandForTests,
  __handleGroupUpdateForTests,
  __setOffsetForTests,
  attachControls,
  createGroup,
  getSnapshot,
  notePlaybackState,
  PlayerControls,
  resetForTests,
  resumeGroupPlayback,
  subscribeDriver,
} from "../syncPlayManager";
import { SyncPlayCommand } from "@/services/jellyfinApi";

const TICKS = 10_000_000;

function joinPlayingGroup(): void {
  __handleGroupUpdateForTests({ GroupId: "g1", Type: "GroupJoined", Data: { GroupId: "g1", GroupName: "Movie night", State: "Idle", Participants: ["a"], LastUpdatedAt: new Date().toISOString() } });
  __handleGroupUpdateForTests({
    GroupId: "g1",
    Type: "PlayQueue",
    Data: { Reason: "NewPlaylist", LastUpdate: new Date().toISOString(), Playlist: [{ ItemId: "item-1", PlaylistItemId: "pl-1" }], PlayingItemIndex: 0, StartPositionTicks: 0, IsPlaying: false },
  });
}

function fakeControls(overrides: Partial<PlayerControls> = {}): PlayerControls & { seekTo: jest.Mock; setPaused: jest.Mock } {
  return {
    videoId: "item-1",
    seekTo: jest.fn(),
    setPaused: jest.fn(),
    getPositionSeconds: () => 0,
    ...overrides,
  } as PlayerControls & { seekTo: jest.Mock; setPaused: jest.Mock };
}

function command(patch: Partial<SyncPlayCommand>): SyncPlayCommand {
  const now = new Date();
  return { GroupId: "g1", PlaylistItemId: "pl-1", When: now.toISOString(), PositionTicks: 0, Command: "Unpause", EmittedAt: now.toISOString(), ...patch };
}

describe("syncPlayManager", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    resetForTests();
    jest.clearAllMocks();
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  it("schedules an Unpause at When minus offset", () => {
    joinPlayingGroup();
    __setOffsetForTests(0);
    const controls = fakeControls();
    attachControls(controls);
    const when = new Date(Date.now() + 500).toISOString();
    __handleCommandForTests(command({ Command: "Unpause", When: when, PositionTicks: 0 }));
    expect(controls.setPaused).not.toHaveBeenCalled();
    jest.advanceTimersByTime(500);
    expect(controls.setPaused).toHaveBeenCalledWith(false);
  });

  it("drops a command emitted before the join", () => {
    joinPlayingGroup();
    const controls = fakeControls();
    attachControls(controls);
    __handleCommandForTests(command({ Command: "Pause", EmittedAt: new Date(Date.now() - 60_000).toISOString() }));
    jest.advanceTimersByTime(1000);
    expect(controls.setPaused).not.toHaveBeenCalled();
  });

  it("drops a mismatched PlaylistItemId but honors Stop", () => {
    joinPlayingGroup();
    const controls = fakeControls();
    attachControls(controls);
    __handleCommandForTests(command({ Command: "Pause", PlaylistItemId: "other" }));
    jest.advanceTimersByTime(1000);
    expect(controls.setPaused).not.toHaveBeenCalled();
    __handleCommandForTests(command({ Command: "Stop", PlaylistItemId: "other" }));
    jest.advanceTimersByTime(1000);
    expect(controls.setPaused).toHaveBeenCalledWith(true);
  });

  it("treats an Unpause echo as a confirmation, no seek", () => {
    joinPlayingGroup();
    __setOffsetForTests(0);
    const controls = fakeControls();
    attachControls(controls);
    const when = new Date(Date.now()).toISOString();
    // First Unpause records the sync point.
    __handleCommandForTests(command({ Command: "Unpause", When: when, PositionTicks: 5 * TICKS }));
    jest.advanceTimersByTime(1);
    controls.seekTo.mockClear();
    // The same When/Position again is the echo answering our Ready.
    __handleCommandForTests(command({ Command: "Unpause", When: when, PositionTicks: 5 * TICKS }));
    jest.advanceTimersByTime(1000);
    expect(controls.seekTo).not.toHaveBeenCalled();
    expect(__getTimingForTests().readyOwed).toBe(false);
  });

  it("reports nothing for a buffering edge inside the seek window", () => {
    joinPlayingGroup();
    __setOffsetForTests(0);
    const controls = fakeControls();
    attachControls(controls);
    __handleCommandForTests(command({ Command: "Seek", When: new Date().toISOString(), PositionTicks: 10 * TICKS }));
    jest.advanceTimersByTime(1);
    (api.syncPlayBuffering as jest.Mock).mockClear();
    // Our own seek raised this edge.
    const { noteBuffering } = require("../syncPlayManager");
    noteBuffering(true, 10);
    expect(api.syncPlayBuffering).not.toHaveBeenCalled();
  });

  it("reports nothing for the buffering of a load that has not played yet", () => {
    joinPlayingGroup();
    const controls = fakeControls();
    attachControls(controls);
    (api.syncPlayBuffering as jest.Mock).mockClear();
    const { noteBuffering } = require("../syncPlayManager");
    // The server already marks a re-queued session buffering; reporting our own startup
    // drags the group back out of Playing on every pass through the handshake.
    noteBuffering(true, 0);
    expect(api.syncPlayBuffering).not.toHaveBeenCalled();
  });

  it("reports a buffering edge once the item has actually played", () => {
    joinPlayingGroup();
    const controls = fakeControls();
    attachControls(controls);
    notePlaybackState({ isPlaying: true, isSeeking: false });
    (api.syncPlayBuffering as jest.Mock).mockClear();
    const { noteBuffering } = require("../syncPlayManager");
    noteBuffering(true, 12);
    expect(api.syncPlayBuffering).toHaveBeenCalled();
  });

  it("swallows a player pause that we caused", () => {
    joinPlayingGroup();
    const controls = fakeControls();
    attachControls(controls);
    __handleCommandForTests(command({ Command: "Pause", When: new Date().toISOString() }));
    jest.advanceTimersByTime(1);
    (api.syncPlayPause as jest.Mock).mockClear();
    notePlaybackState({ isPlaying: false, isSeeking: false });
    expect(api.syncPlayPause).not.toHaveBeenCalled();
  });

  it("forwards a viewer pause to the server", () => {
    joinPlayingGroup();
    const controls = fakeControls();
    attachControls(controls);
    // No expectedPaused pending: this is the viewer pressing pause.
    notePlaybackState({ isPlaying: false, isSeeking: false });
    expect(api.syncPlayPause).toHaveBeenCalled();
  });

  it("ignores a solo video that is not the group's item", () => {
    const { wantsPausedStart, notePlaybackState: note } = require("../syncPlayManager");
    joinPlayingGroup(); // group item is item-1
    attachControls(fakeControls({ videoId: "item-2" })); // a different item is on screen
    expect(wantsPausedStart("item-2")).toBe(false);
    note({ isPlaying: false, isSeeking: false });
    expect(api.syncPlayPause).not.toHaveBeenCalled();
  });

  it("records the sync point with the player closed, so a member can rejoin", () => {
    joinPlayingGroup();
    __setOffsetForTests(0);
    // No controls attached: the viewer backed out of the player.
    const when = new Date(Date.now()).toISOString();
    __handleCommandForTests(command({ Command: "Unpause", When: when, PositionTicks: 30 * TICKS }));
    jest.advanceTimersByTime(1);
    expect(__getTimingForTests().lastSyncPoint).toEqual({ when, positionTicks: 30 * TICKS });
  });

  it("rejoins a playing group at its live position", () => {
    joinPlayingGroup();
    __setOffsetForTests(0);
    __handleGroupUpdateForTests({ GroupId: "g1", Type: "StateUpdate", Data: { State: "Playing", Reason: "Unpause" } });
    const when = new Date(Date.now()).toISOString();
    __handleCommandForTests(command({ Command: "Unpause", When: when, PositionTicks: 30 * TICKS }));
    jest.advanceTimersByTime(1);
    // 10 s later the group is at ~40 s.
    jest.advanceTimersByTime(10_000);
    const events: unknown[] = [];
    subscribeDriver((e) => events.push(e));
    resumeGroupPlayback();
    expect(events).toHaveLength(1);
    const target = (events[0] as { kind: string; target: { playingItemIndex: number; startPositionTicks: number } }).target;
    expect(target.playingItemIndex).toBe(0);
    expect(target.startPositionTicks).toBeGreaterThanOrEqual(39 * TICKS);
    expect(target.startPositionTicks).toBeLessThanOrEqual(41 * TICKS);
  });

  it("rejoin is a no-op when the player is already on the group's item", () => {
    joinPlayingGroup();
    attachControls(fakeControls());
    const events: unknown[] = [];
    subscribeDriver((e) => events.push(e));
    resumeGroupPlayback();
    expect(events).toHaveLength(0);
  });

  it("a play queue for the item already on screen sends Ready at once, since no load will", () => {
    joinPlayingGroup();
    attachControls(fakeControls());
    (api.syncPlayReady as jest.Mock).mockClear();
    __handleGroupUpdateForTests({
      GroupId: "g1",
      Type: "PlayQueue",
      Data: {
        Reason: "NewPlaylist",
        LastUpdate: new Date().toISOString(),
        Playlist: [{ ItemId: "item-1", PlaylistItemId: "pl-1" }],
        PlayingItemIndex: 0,
        StartPositionTicks: 12 * TICKS,
        IsPlaying: false,
      },
    });
    expect(api.syncPlayReady).toHaveBeenCalledTimes(1);
    expect(__getTimingForTests().readyOwed).toBe(false);
  });

  it("a play queue for another item waits for that item's load before any Ready", () => {
    joinPlayingGroup();
    attachControls(fakeControls());
    (api.syncPlayReady as jest.Mock).mockClear();
    __handleGroupUpdateForTests({
      GroupId: "g1",
      Type: "PlayQueue",
      Data: { Reason: "NewPlaylist", LastUpdate: new Date().toISOString(), Playlist: [{ ItemId: "item-2", PlaylistItemId: "pl-2" }], PlayingItemIndex: 0, StartPositionTicks: 0, IsPlaying: false },
    });
    expect(api.syncPlayReady).not.toHaveBeenCalled();
  });

  it("re-holds and unpauses through the server on a viewer resume", () => {
    joinPlayingGroup();
    const controls = fakeControls();
    attachControls(controls);
    notePlaybackState({ isPlaying: true, isSeeking: false });
    expect(controls.setPaused).toHaveBeenCalledWith(true);
    expect(api.syncPlayUnpause).toHaveBeenCalled();
  });

  it("samples the clock before the join, without a ping, so the join stamp carries the offset", async () => {
    (api.measureServerClock as jest.Mock).mockResolvedValueOnce({ offsetMs: 5000, pingMs: 10 });
    await createGroup("Movie night");
    expect(api.syncPlayPing).not.toHaveBeenCalled();
    const { offsetMs, joinedAtServerMs } = __getTimingForTests();
    expect(offsetMs).toBe(5000);
    expect(joinedAtServerMs - Date.now()).toBe(5000);
    expect(getSnapshot().group?.groupId).toBe("g1");
  });

  it("reopens the socket on an auth change under the same server and account", async () => {
    await createGroup("Movie night");
    expect(socket.openServerSocket).toHaveBeenCalledTimes(1);
    expect(api.subscribeAuthChange).toHaveBeenCalledTimes(1);
    await __handleAuthChangeForTests();
    expect(getSnapshot().group?.groupId).toBe("g1");
    expect(socket.openServerSocket).toHaveBeenCalledTimes(2);
    expect(socket.closeServerSocket).not.toHaveBeenCalled();
  });

  it("ends the group on an auth change to another account", async () => {
    await createGroup("Movie night");
    (api.getConfig as jest.Mock).mockResolvedValueOnce({ server: "http://s", apiKey: "k2", userId: "u2", deviceId: "d" });
    await __handleAuthChangeForTests();
    expect(getSnapshot().group).toBeNull();
    expect(socket.closeServerSocket).toHaveBeenCalled();
    expect(__getTimingForTests().joinedAtServerMs).toBe(0);
  });
});
