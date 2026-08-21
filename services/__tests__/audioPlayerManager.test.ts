import { Platform } from "react-native";
import { audioPlayerManager } from "../audioPlayerManager";
import * as jellyfinApi from "../jellyfinApi";
import * as audioQueuePlayer from "../audioQueuePlayer";
import { JellyfinVideoItem } from "@/types/jellyfin";

let mockHandlers: audioQueuePlayer.AudioQueueEventHandlers | null = null;

jest.mock("../audioQueuePlayer", () => ({
  isAudioQueuePlayerAvailable: jest.fn(() => true),
  loadQueue: jest.fn(() => Promise.resolve()),
  present: jest.fn(() => Promise.resolve()),
  skipToIndex: jest.fn(() => Promise.resolve()),
  stop: jest.fn(() => Promise.resolve()),
  subscribeToEvents: jest.fn((handlers) => {
    mockHandlers = handlers;
    return () => {
      mockHandlers = null;
    };
  }),
}));

jest.mock("../jellyfinApi", () => ({
  generatePlaySessionId: jest.fn(),
  getPosterUrl: jest.fn(() => "http://server/poster.jpg"),
  getVideoStreamUrl: jest.fn((id: string) => `http://server/stream/${id}`),
  hasPoster: jest.fn(() => true),
  JELLYFIN_TIME: { TICKS_PER_SECOND: 10_000_000 },
  markItemPlayed: jest.fn(),
  reportPlaybackProgress: jest.fn(() => Promise.resolve()),
  reportPlaybackStart: jest.fn(() => Promise.resolve()),
  reportPlaybackStopped: jest.fn(() => Promise.resolve()),
  updateUserItemData: jest.fn(() => Promise.resolve(true)),
}));

jest.mock("@/utils/logger");

const TICKS = 10_000_000;
const mockLoadQueue = audioQueuePlayer.loadQueue as jest.MockedFunction<typeof audioQueuePlayer.loadQueue>;
const mockNativeStop = audioQueuePlayer.stop as jest.MockedFunction<typeof audioQueuePlayer.stop>;
const mockPresent = audioQueuePlayer.present as jest.MockedFunction<typeof audioQueuePlayer.present>;
const mockStart = jellyfinApi.reportPlaybackStart as jest.MockedFunction<typeof jellyfinApi.reportPlaybackStart>;
const mockProgress = jellyfinApi.reportPlaybackProgress as jest.MockedFunction<typeof jellyfinApi.reportPlaybackProgress>;
const mockStopped = jellyfinApi.reportPlaybackStopped as jest.MockedFunction<typeof jellyfinApi.reportPlaybackStopped>;
const mockPersist = jellyfinApi.updateUserItemData as jest.MockedFunction<typeof jellyfinApi.updateUserItemData>;
const mockMarkPlayed = jellyfinApi.markItemPlayed as jest.MockedFunction<typeof jellyfinApi.markItemPlayed>;
const mockGenerateId = jellyfinApi.generatePlaySessionId as jest.MockedFunction<typeof jellyfinApi.generatePlaySessionId>;

/** Drain the serialized write chain (each write is an awaited promise link). */
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

const track = (id: string, seconds: number, played = false): JellyfinVideoItem => ({
  Id: id,
  Name: `Track ${id}`,
  Type: "Audio",
  RunTimeTicks: seconds * TICKS,
  Path: `/music/${id}.flac`,
  Artists: ["Artist A"],
  Album: "Album X",
  MediaSources: [{ Id: `source-${id}` }],
  UserData: { Played: played },
});

const ITEMS = [track("a", 180), track("b", 200), track("c", 240)];

describe("audioPlayerManager", () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    let idCounter = 0;
    mockGenerateId.mockImplementation(() => `session-${++idCounter}`);
    mockPersist.mockResolvedValue(true);
    await audioPlayerManager.stop();
    jest.clearAllMocks();
    mockGenerateId.mockImplementation(() => `session-${++idCounter}`);
  });

  const startAndOpenFirstTrack = async () => {
    await audioPlayerManager.startQueue(ITEMS, "a", { sourceId: "folder-1" });
    mockHandlers!.onTrackChanged({ index: 0, trackId: "a", previousIndex: -1, previousTrackId: null, previousPosition: 0, natural: false });
    await flush();
  };

  describe("startQueue", () => {
    it("maps items to native tracks and starts at the tapped item", async () => {
      await audioPlayerManager.startQueue(ITEMS, "b", { loop: true, startPositionSeconds: 12 });

      expect(mockLoadQueue).toHaveBeenCalledWith({
        tracks: [
          expect.objectContaining({ id: "a", url: "http://server/stream/a", title: "Track a", artist: "Artist A", album: "Album X", durationSeconds: 180 }),
          expect.objectContaining({ id: "b" }),
          expect.objectContaining({ id: "c" }),
        ],
        startIndex: 1,
        startPositionSeconds: 12,
        loop: true,
      });
      expect(audioPlayerManager.getUIState().active).toBe(true);
    });

    // The player's description line carries the disc/track the cards badge, while `album`
    // stays the album name alone — it also fills the lock screen's album field.
    it("puts the disc and track on the description line, not in the album", async () => {
      await audioPlayerManager.startQueue([{ ...ITEMS[0], IndexNumber: 5, ParentIndexNumber: 2 }], "a", {});

      expect(mockLoadQueue).toHaveBeenCalledWith(
        expect.objectContaining({
          tracks: [expect.objectContaining({ album: "Album X", description: "Album X · Disc 2 · Track 5" })],
        }),
      );
    });

    it("describes an untagged song by its album alone", async () => {
      await audioPlayerManager.startQueue(ITEMS, "a", {});

      expect(mockLoadQueue).toHaveBeenCalledWith(expect.objectContaining({ tracks: [expect.objectContaining({ description: "Album X" }), expect.anything(), expect.anything()] }));
    });

    it("re-presents instead of restarting when the same source and track are already playing", async () => {
      await startAndOpenFirstTrack();
      mockLoadQueue.mockClear();

      await audioPlayerManager.startQueue(ITEMS, "a", { sourceId: "folder-1" });

      expect(mockPresent).toHaveBeenCalled();
      expect(mockLoadQueue).not.toHaveBeenCalled();
    });
  });

  describe("per-track reporting", () => {
    it("opens a session on the first track", async () => {
      await startAndOpenFirstTrack();

      expect(mockStart).toHaveBeenCalledWith(
        expect.objectContaining({
          ItemId: "a",
          MediaSourceId: "source-a",
          PlaySessionId: "session-1",
          PlayMethod: "DirectStream",
          PositionTicks: 0,
          IsPaused: false,
        }),
      );
    });

    it("natural track end: Stopped at full duration, marks played, opens the next session", async () => {
      await startAndOpenFirstTrack();

      mockHandlers!.onTrackChanged({ index: 1, trackId: "b", previousIndex: 0, previousTrackId: "a", previousPosition: 180, natural: true });
      await flush();

      expect(mockStopped).toHaveBeenCalledWith(expect.objectContaining({ ItemId: "a", PositionTicks: 180 * TICKS }));
      expect(mockMarkPlayed).toHaveBeenCalledWith("a", true);
      expect(mockStart).toHaveBeenLastCalledWith(expect.objectContaining({ ItemId: "b", PlaySessionId: "session-2" }));
    });

    it("manual skip: Stopped at the skip position, persists resume, no played mark", async () => {
      await startAndOpenFirstTrack();

      mockHandlers!.onTrackChanged({ index: 1, trackId: "b", previousIndex: 0, previousTrackId: "a", previousPosition: 42, natural: false });
      await flush();

      expect(mockStopped).toHaveBeenCalledWith(expect.objectContaining({ ItemId: "a", PositionTicks: 42 * TICKS }));
      expect(mockPersist).toHaveBeenCalledWith("a", { PlaybackPositionTicks: 42 * TICKS, Played: false });
      expect(mockMarkPlayed).not.toHaveBeenCalled();
    });

    it("throttles progress reports to >=8s of advancement", async () => {
      await startAndOpenFirstTrack();

      mockHandlers!.onProgress({ index: 0, position: 3, duration: 180, playing: true });
      mockHandlers!.onProgress({ index: 0, position: 7, duration: 180, playing: true });
      await flush();
      expect(mockProgress).not.toHaveBeenCalled();

      mockHandlers!.onProgress({ index: 0, position: 9, duration: 180, playing: true });
      await flush();
      expect(mockProgress).toHaveBeenCalledTimes(1);
      expect(mockProgress).toHaveBeenCalledWith(expect.objectContaining({ ItemId: "a", PositionTicks: 9 * TICKS, IsPaused: false }));
    });

    it("reports a pause flip immediately", async () => {
      await startAndOpenFirstTrack();

      mockHandlers!.onProgress({ index: 0, position: 3, duration: 180, playing: false });
      await flush();

      expect(mockProgress).toHaveBeenCalledWith(expect.objectContaining({ ItemId: "a", PositionTicks: 3 * TICKS, IsPaused: true }));
    });
  });

  describe("queue end and stop", () => {
    it("natural queue end closes the last session at full duration and tears down", async () => {
      await startAndOpenFirstTrack();

      mockHandlers!.onQueueEnded({ natural: true });
      await flush();

      expect(mockStopped).toHaveBeenCalledWith(expect.objectContaining({ ItemId: "a", PositionTicks: 180 * TICKS }));
      expect(mockMarkPlayed).toHaveBeenCalledWith("a", true);
      expect(mockNativeStop).toHaveBeenCalled();
      expect(audioPlayerManager.getUIState().active).toBe(false);
    });

    it("stop closes at the current position exactly once", async () => {
      await startAndOpenFirstTrack();
      mockHandlers!.onProgress({ index: 0, position: 30, duration: 180, playing: true });
      await flush();
      mockStopped.mockClear();

      await audioPlayerManager.stop();
      await audioPlayerManager.stop();
      await flush();

      expect(mockStopped).toHaveBeenCalledTimes(1);
      expect(mockStopped).toHaveBeenCalledWith(expect.objectContaining({ ItemId: "a", PositionTicks: 30 * TICKS }));
    });
  });

  describe("dismissal", () => {
    it("keeps playing on phone dismissal (background music), only the UI flag drops", async () => {
      await startAndOpenFirstTrack();

      mockHandlers!.onDismiss();
      await flush();

      const state = audioPlayerManager.getUIState();
      expect(state.active).toBe(true);
      expect(state.uiVisible).toBe(false);
      expect(mockNativeStop).not.toHaveBeenCalled();
    });

    it("keeps playing on tvOS dismissal too (Menu leaves the queue running)", async () => {
      // Platform.isTV is a getter in the RN preset; plain assignment is silently ignored.
      const original = Object.getOwnPropertyDescriptor(Platform, "isTV");
      Object.defineProperty(Platform, "isTV", { value: true, configurable: true });
      try {
        await startAndOpenFirstTrack();

        mockHandlers!.onDismiss();
        await flush();

        const state = audioPlayerManager.getUIState();
        expect(state.active).toBe(true);
        expect(state.uiVisible).toBe(false);
        expect(mockNativeStop).not.toHaveBeenCalled();
      } finally {
        if (original) Object.defineProperty(Platform, "isTV", original);
      }
    });

    // Issue #68: dismiss, browse, tap the same track. The re-present test above never
    // dismisses first, so this is the only cover for the journey the report describes.
    it("re-presents a dismissed queue instead of restarting it", async () => {
      await startAndOpenFirstTrack();

      mockHandlers!.onDismiss();
      await flush();
      expect(audioPlayerManager.getUIState().active).toBe(true);
      mockLoadQueue.mockClear();
      mockNativeStop.mockClear();

      await audioPlayerManager.startQueue(ITEMS, "a", { sourceId: "folder-1" });

      expect(mockPresent).toHaveBeenCalled();
      expect(mockLoadQueue).not.toHaveBeenCalled();
      expect(mockNativeStop).not.toHaveBeenCalled();
      expect(audioPlayerManager.getUIState().uiVisible).toBe(true);
    });
  });
});
