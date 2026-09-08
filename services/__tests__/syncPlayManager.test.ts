/**
 * SyncPlay manager: command scheduling, the stale/mismatch drops, the Unpause echo guard, the
 * buffering suppression window, and forwarding a viewer's transport action to the server.
 */
jest.mock("@/services/jellyfinApi", () => ({
  fetchSyncPlayAccess: jest.fn(),
  listSyncPlayGroups: jest.fn(),
  createSyncPlayGroup: jest.fn(),
  joinSyncPlayGroup: jest.fn(),
  leaveSyncPlayGroup: jest.fn(),
  measureServerClock: jest.fn().mockResolvedValue(null),
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
}));

import * as api from "@/services/jellyfinApi";
import { __getTimingForTests, __handleCommandForTests, __handleGroupUpdateForTests, __setOffsetForTests, attachControls, notePlaybackState, PlayerControls, resetForTests } from "../syncPlayManager";
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

  it("re-holds and unpauses through the server on a viewer resume", () => {
    joinPlayingGroup();
    const controls = fakeControls();
    attachControls(controls);
    notePlaybackState({ isPlaying: true, isSeeking: false });
    expect(controls.setPaused).toHaveBeenCalledWith(true);
    expect(api.syncPlayUnpause).toHaveBeenCalled();
  });
});
