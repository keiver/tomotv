import { Platform } from "react-native";
import { audioPlayerManager } from "../audioPlayerManager";
import * as jellyfinApi from "../jellyfinApi";
import * as audioQueuePlayer from "../audioQueuePlayer";
import { JellyfinVideoItem } from "@/types/jellyfin";
import { probeEmit, readLastSession } from "@/services/playbackProbe";
import { fetchLyrics } from "@/services/jellyfin/lyrics";
import { getUiPreferences, updateUiPreferences } from "@/services/uiPreferences";

let mockHandlers: audioQueuePlayer.AudioQueueEventHandlers | null = null;

jest.mock("../audioQueuePlayer", () => ({
  isAudioQueuePlayerAvailable: jest.fn(() => true),
  loadQueue: jest.fn(() => Promise.resolve()),
  present: jest.fn(() => Promise.resolve()),
  skipToIndex: jest.fn(() => Promise.resolve()),
  stop: jest.fn(() => Promise.resolve()),
  setLyrics: jest.fn(() => Promise.resolve()),
  setLyricsEnabled: jest.fn(() => Promise.resolve()),
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
  updateUserItemData: jest.fn(() => Promise.resolve("ok")),
}));

jest.mock("@/services/jellyfin/lyrics", () => ({ fetchLyrics: jest.fn(() => Promise.resolve(null)) }));
// The pipeline reduced to its first source, so these tests drive it through fetchLyrics.
jest.mock("@/services/lyrics/pipeline", () => ({
  resolveLyrics: jest.fn(async (item: { Id: string }, onUpdate: (lyrics: unknown) => void) => onUpdate(await jest.requireMock("@/services/jellyfin/lyrics").fetchLyrics(item.Id))),
}));

// redactSecrets stays real: the probe parses its output, and an automocked stub returns undefined.
jest.mock("@/utils/logger", () => ({ ...jest.requireActual("@/utils/logger"), logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() } }));

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
const mockFetchLyrics = fetchLyrics as jest.MockedFunction<typeof fetchLyrics>;
const mockSetLyrics = audioQueuePlayer.setLyrics as jest.MockedFunction<typeof audioQueuePlayer.setLyrics>;
const mockSetLyricsEnabled = audioQueuePlayer.setLyricsEnabled as jest.MockedFunction<typeof audioQueuePlayer.setLyricsEnabled>;
const LYRICS = { synced: true, lines: [{ text: "line", start: 1, cues: [] }] };

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
    mockPersist.mockResolvedValue("ok");
    await audioPlayerManager.stop();
    updateUiPreferences({ showLyrics: true });
    jest.clearAllMocks();
    mockGenerateId.mockImplementation(() => `session-${++idCounter}`);
    mockFetchLyrics.mockResolvedValue(null);
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
        lyricsEnabled: true,
        lyricsLabel: "Lyrics",
      });
      expect(audioPlayerManager.getUIState().active).toBe(true);
    });

    // The player's description line carries the disc/track the cards badge, while `album`
    // stays the album name alone, it also fills the lock screen's album field.
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

    it("gives Apple TV the artist and album over the title, and the phone no line", async () => {
      const song = { ...ITEMS[0], Artists: ["Band"] };
      await audioPlayerManager.startQueue([song], "a", {});
      expect(mockLoadQueue).toHaveBeenLastCalledWith(expect.objectContaining({ tracks: [expect.objectContaining({ subtitle: "" })] }));

      const original = Object.getOwnPropertyDescriptor(Platform, "isTV");
      Object.defineProperty(Platform, "isTV", { value: true, configurable: true });
      try {
        await audioPlayerManager.startQueue([song], "b", {});
        expect(mockLoadQueue).toHaveBeenLastCalledWith(expect.objectContaining({ tracks: [expect.objectContaining({ subtitle: "Band · Album X" })] }));
      } finally {
        if (original) Object.defineProperty(Platform, "isTV", original);
      }
    });

    it("re-presents instead of restarting when the same source and track are already playing", async () => {
      await startAndOpenFirstTrack();
      mockLoadQueue.mockClear();

      await audioPlayerManager.startQueue(ITEMS, "a", { sourceId: "folder-1" });

      expect(mockPresent).toHaveBeenCalled();
      expect(mockLoadQueue).not.toHaveBeenCalled();
    });
  });

  describe("lyrics", () => {
    it("hands the current track's lyrics to the native player", async () => {
      mockFetchLyrics.mockResolvedValue(LYRICS);
      await startAndOpenFirstTrack();

      expect(mockFetchLyrics).toHaveBeenCalledWith("a");
      expect(mockSetLyrics).toHaveBeenCalledWith("a", LYRICS);
    });

    it("tells the native player a track has none", async () => {
      await startAndOpenFirstTrack();

      expect(mockSetLyrics).toHaveBeenCalledWith("a", null);
    });

    it("works out the next track's lyrics while this one plays, and hands over only the current one's", async () => {
      mockFetchLyrics.mockResolvedValue(LYRICS);
      await startAndOpenFirstTrack();

      expect(mockFetchLyrics).toHaveBeenCalledWith("b");
      expect(mockSetLyrics).not.toHaveBeenCalledWith("b", expect.anything());
    });

    it("drops a reply for a track the queue has left", async () => {
      let answer: (lyrics: typeof LYRICS) => void = () => {};
      mockFetchLyrics.mockImplementationOnce(() => new Promise((resolve) => (answer = resolve)));
      await startAndOpenFirstTrack();
      mockHandlers!.onTrackChanged({ index: 1, trackId: "b", previousIndex: 0, previousTrackId: "a", previousPosition: 30, natural: false });
      await flush();
      answer(LYRICS);
      await flush();

      expect(mockSetLyrics).not.toHaveBeenCalledWith("a", expect.anything());
      expect(mockSetLyrics).toHaveBeenCalledWith("b", null);
    });

    it("asks for nothing while lyrics are off, and loads the current track when they come back on", async () => {
      updateUiPreferences({ showLyrics: false });
      await startAndOpenFirstTrack();
      expect(mockLoadQueue).toHaveBeenCalledWith(expect.objectContaining({ lyricsEnabled: false }));
      expect(mockFetchLyrics).not.toHaveBeenCalled();

      mockFetchLyrics.mockResolvedValue(LYRICS);
      updateUiPreferences({ showLyrics: true });
      await flush();

      expect(mockSetLyricsEnabled).toHaveBeenCalledWith(true);
      expect(mockSetLyrics).toHaveBeenCalledWith("a", LYRICS);
    });

    it("keeps the Apple TV player's toggle as the preference", async () => {
      await startAndOpenFirstTrack();
      mockHandlers!.onLyricsEnabledChanged({ enabled: false });

      expect(getUiPreferences().showLyrics).toBe(false);
      expect(mockSetLyricsEnabled).toHaveBeenCalledWith(false);
    });

    // The Apple TV toggle is offered only for a song that has lyrics, so they are needed while off.
    it("still hands lyrics to the Apple TV player while they are off", async () => {
      const original = Object.getOwnPropertyDescriptor(Platform, "isTV");
      Object.defineProperty(Platform, "isTV", { value: true, configurable: true });
      try {
        updateUiPreferences({ showLyrics: false });
        mockFetchLyrics.mockResolvedValue(LYRICS);
        await startAndOpenFirstTrack();

        expect(mockLoadQueue).toHaveBeenCalledWith(expect.objectContaining({ lyricsEnabled: false }));
        expect(mockSetLyrics).toHaveBeenCalledWith("a", LYRICS);
      } finally {
        if (original) Object.defineProperty(Platform, "isTV", original);
      }
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

  describe("broken tracks", () => {
    it("reports nothing for a track that fails before its Start goes out", async () => {
      await startAndOpenFirstTrack();

      mockHandlers!.onTrackChanged({ index: 1, trackId: "b", previousIndex: 0, previousTrackId: "a", previousPosition: 180, natural: true });
      mockHandlers!.onError({ index: 1, message: "Cannot Open" });
      await flush();

      expect(mockStopped).toHaveBeenCalledWith(expect.objectContaining({ ItemId: "a" }));
      expect(mockStart).not.toHaveBeenCalledWith(expect.objectContaining({ ItemId: "b" }));
      expect(mockStopped).not.toHaveBeenCalledWith(expect.objectContaining({ ItemId: "b" }));
    });

    it("opens no session when the failure beats the track change", async () => {
      await startAndOpenFirstTrack();

      mockHandlers!.onError({ index: 1, message: "Cannot Open" });
      mockHandlers!.onTrackChanged({ index: 1, trackId: "b", previousIndex: 0, previousTrackId: "a", previousPosition: 180, natural: true });
      await flush();
      mockHandlers!.onTrackChanged({ index: 2, trackId: "c", previousIndex: 1, previousTrackId: "b", previousPosition: 0, natural: false });
      await flush();

      expect(mockStart).not.toHaveBeenCalledWith(expect.objectContaining({ ItemId: "b" }));
      expect(mockStopped).not.toHaveBeenCalledWith(expect.objectContaining({ ItemId: "b" }));
      expect(mockStart).toHaveBeenLastCalledWith(expect.objectContaining({ ItemId: "c" }));
    });

    it("stops a queue once every track has failed, so a looping queue cannot cycle its failures", async () => {
      await startAndOpenFirstTrack();
      mockHandlers!.onError({ index: 0, message: "Cannot Open" });
      mockHandlers!.onTrackChanged({ index: 1, trackId: "b", previousIndex: 0, previousTrackId: "a", previousPosition: 0, natural: false });
      mockHandlers!.onError({ index: 1, message: "Cannot Open" });
      mockHandlers!.onTrackChanged({ index: 2, trackId: "c", previousIndex: 1, previousTrackId: "b", previousPosition: 0, natural: false });
      expect(mockNativeStop).not.toHaveBeenCalled();

      mockHandlers!.onError({ index: 2, message: "Cannot Open" });
      await flush();

      expect(mockNativeStop).toHaveBeenCalledTimes(1);
      expect(audioPlayerManager.getUIState().active).toBe(false);
    });

    it("keeps a queue alive while any track still plays between failures", async () => {
      await startAndOpenFirstTrack();
      mockHandlers!.onError({ index: 0, message: "Cannot Open" });
      mockHandlers!.onTrackChanged({ index: 1, trackId: "b", previousIndex: 0, previousTrackId: "a", previousPosition: 0, natural: false });
      mockHandlers!.onProgress({ index: 1, position: 5, duration: 200, playing: true });
      mockHandlers!.onTrackChanged({ index: 2, trackId: "c", previousIndex: 1, previousTrackId: "b", previousPosition: 200, natural: true });
      mockHandlers!.onError({ index: 2, message: "Cannot Open" });
      mockHandlers!.onTrackChanged({ index: 0, trackId: "a", previousIndex: 2, previousTrackId: "c", previousPosition: 0, natural: false });
      mockHandlers!.onError({ index: 0, message: "Cannot Open" });
      await flush();

      expect(mockNativeStop).not.toHaveBeenCalled();
      expect(audioPlayerManager.getUIState().active).toBe(true);
    });

    it("closes a track that fails once its Start is on the wire", async () => {
      await startAndOpenFirstTrack();
      mockHandlers!.onProgress({ index: 0, position: 12, duration: 180, playing: true });
      await flush();

      mockHandlers!.onError({ index: 0, message: "Cannot Open" });
      await flush();

      expect(mockStopped).toHaveBeenCalledWith(expect.objectContaining({ ItemId: "a", PositionTicks: 12 * TICKS }));
    });
  });

  describe("diagnostics", () => {
    it("keeps the session opened at start when the queue's first change names that same track", async () => {
      await audioPlayerManager.startQueue(ITEMS, "a", { sourceId: "folder-1" });
      probeEmit("marker");
      mockHandlers!.onTrackChanged({ index: 0, trackId: "a", previousIndex: -1, previousTrackId: null, previousPosition: 0, natural: false });
      await flush();

      expect(readLastSession()?.playback.events.map((entry) => entry.event)).toContain("marker");
    });

    it("a preloaded track's failure does not fail the current track's session", async () => {
      await startAndOpenFirstTrack();

      mockHandlers!.onError({ index: 1, message: "Cannot Open" });
      await flush();
      expect(readLastSession()?.playback.outcome).toBe("playing");

      mockHandlers!.onError({ index: 0, message: "Cannot Open" });
      await flush();
      expect(readLastSession()?.playback.outcome).toBe("error");
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
