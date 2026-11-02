/** The engine session an item's page opens before Play: when it opens, what it refuses, and when the player takes it. */
import { prewarmItemPage, stopVodPrewarm, takeVodPrewarm, VOD_PREWARM_DWELL_MS, VOD_PREWARM_GRACE_MS } from "@/services/vodPrewarm";
import { attributeSession, stopLocalRemux } from "@keiver/tomo-engine";
import { fetchVideoDetails } from "@/services/jellyfinApi";
import { offeredTierRungs, predictPlaybackLane, startLocalRemux } from "@/services/localRemux";
import { rememberedBitrate } from "@/services/jellyfin/bitrateTest";
import { isPlaybackHeld } from "@/services/playbackHold";

jest.mock("@keiver/tomo-engine", () => ({
  attributeSession: jest.fn(),
  localRemuxToken: (url: string) => /\/s\/([^/]+)\//.exec(url)?.[1] ?? null,
  stopLocalRemux: jest.fn(async () => {}),
  subscribeEngineFailure: jest.fn(() => () => {}),
}));
jest.mock("@/services/jellyfinApi", () => ({ fetchVideoDetails: jest.fn() }));
jest.mock("@/services/localRemux", () => ({
  offeredTierRungs: jest.fn(() => [{ bitrate: 1_000_000 }]),
  predictPlaybackLane: jest.fn(async () => ({ lane: "copy", smallFeedFirst: false })),
  sessionSubtitleRenditions: jest.fn(() => []),
  sourceBandwidthForItem: jest.fn(() => 10_000_000),
  startLocalRemux: jest.fn(async () => "http://127.0.0.1:9999/s/warm/master.m3u8"),
}));
jest.mock("@/services/jellyfin/bitrateTest", () => ({ rememberedBitrate: jest.fn(async () => 100_000_000) }));
jest.mock("@/services/playbackHold", () => ({ isPlaybackHeld: jest.fn(() => false), onPlaybackHoldTaken: jest.fn() }));
jest.mock("@/services/audioPreference", () => ({ readAudioPreference: jest.fn(async () => null), preferredAudioStreamIndex: jest.fn(() => null) }));
jest.mock("@/services/multiAudioLoader", () => ({ getAudioTracks: jest.fn(() => []) }));
jest.mock("@/services/subtitlePreference", () => ({ getSubtitlePreferenceSync: jest.fn(() => ({ mode: "None" })) }));
jest.mock("@/hooks/videoPlayback/subtitleSession", () => ({ startingSubtitleRendition: jest.fn(() => null) }));
jest.mock("@/services/downloads/localSource", () => ({ playsFromDisk: jest.fn(() => false) }));
jest.mock("@/utils/logger", () => ({ logger: { debug: jest.fn(), info: jest.fn(), warn: jest.fn() } }));

const film = {
  Id: "m-1",
  Type: "Movie",
  MediaType: "Video",
  MediaStreams: [
    { Type: "Video", Index: 0 },
    { Type: "Audio", Index: 1, IsDefault: true },
  ],
  UserData: { PlaybackPositionTicks: 3_600_000_000 },
};
const resumeChoices = { audioIndex: undefined, offsetSeconds: 360, subtitleIndex: null };

async function settle(): Promise<void> {
  for (let hop = 0; hop < 20; hop++) await Promise.resolve();
}

async function openPage(id = "m-1"): Promise<void> {
  prewarmItemPage(id);
  jest.advanceTimersByTime(VOD_PREWARM_DWELL_MS);
  await settle();
}

describe("vodPrewarm", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.clearAllMocks();
    (fetchVideoDetails as jest.Mock).mockResolvedValue(film);
  });

  afterEach(() => {
    stopVodPrewarm();
    jest.useRealTimers();
  });

  it("opens one session at the resume point after the page has been up for its dwell", async () => {
    prewarmItemPage("m-1");
    jest.advanceTimersByTime(VOD_PREWARM_DWELL_MS - 1);
    await settle();
    expect(startLocalRemux).not.toHaveBeenCalled();
    jest.advanceTimersByTime(1);
    await settle();
    expect(startLocalRemux).toHaveBeenCalledTimes(1);
    expect((startLocalRemux as jest.Mock).mock.calls[0].slice(1)).toEqual([undefined, 360, { prewarm: true, selectedSubtitleIndex: null }]);
  });

  it("hands its URL to a player that opens the item the same way, and attributes the session to it", async () => {
    await openPage();
    expect(takeVodPrewarm("m-1", resumeChoices)).toBe("http://127.0.0.1:9999/s/warm/master.m3u8");
    expect(attributeSession).toHaveBeenCalledWith("warm", true);
    expect(stopLocalRemux).not.toHaveBeenCalled();
    expect(takeVodPrewarm("m-1", resumeChoices)).toBeNull();
  });

  it("stops its session when the player opens the item another way or another item", async () => {
    await openPage();
    expect(takeVodPrewarm("m-1", { ...resumeChoices, offsetSeconds: 0 })).toBeNull();
    expect(stopLocalRemux).toHaveBeenCalledWith("warm");

    (stopLocalRemux as jest.Mock).mockClear();
    await openPage();
    expect(takeVodPrewarm("other", resumeChoices)).toBeNull();
    expect(stopLocalRemux).toHaveBeenCalledWith("warm");
  });

  it("keeps its session for the grace after the page leaves, then stops it", async () => {
    await openPage();
    prewarmItemPage(null);
    jest.advanceTimersByTime(VOD_PREWARM_GRACE_MS - 1);
    expect(stopLocalRemux).not.toHaveBeenCalled();
    jest.advanceTimersByTime(1);
    expect(stopLocalRemux).toHaveBeenCalledWith("warm");
  });

  it("opens nothing for a page passed through before the dwell", async () => {
    prewarmItemPage("m-1");
    jest.advanceTimersByTime(VOD_PREWARM_DWELL_MS / 2);
    prewarmItemPage(null);
    jest.advanceTimersByTime(VOD_PREWARM_DWELL_MS);
    await settle();
    expect(startLocalRemux).not.toHaveBeenCalled();
  });

  it.each([
    ["the link is not known", () => (rememberedBitrate as jest.Mock).mockResolvedValueOnce(null)],
    ["the link does not carry the copy", () => (rememberedBitrate as jest.Mock).mockResolvedValueOnce(11_000_000)],
    ["the engine would re-encode it", () => (predictPlaybackLane as jest.Mock).mockResolvedValueOnce({ lane: "deviceTranscode", smallFeedFirst: false })],
    ["no ladder is offered", () => (offeredTierRungs as jest.Mock).mockReturnValueOnce([])],
    ["something is playing", () => (isPlaybackHeld as jest.Mock).mockReturnValueOnce(true)],
    ["it is a channel", () => (fetchVideoDetails as jest.Mock).mockResolvedValueOnce({ ...film, Type: "TvChannel", liveStreamUrl: "http://origin/ch.ts" })],
  ])("opens nothing when %s", async (_why, arrange) => {
    arrange();
    await openPage();
    expect(startLocalRemux).not.toHaveBeenCalled();
  });
});
