/** externalGuide - one open guide per URL serves every caller's window, and no token closes mid-read. */

import { closeGuide, guideChannels, guideProgrammes, loadGuide } from "@keiver/tomo-engine";

jest.mock("@keiver/tomo-engine", () => ({
  closeGuide: jest.fn(async () => {}),
  engineLog: () => ({ warn: jest.fn(), info: jest.fn() }),
  guideChannels: jest.fn(async () => [{ id: "g1", displayNames: ["News One"], icon: null }]),
  guideProgrammes: jest.fn(async () => []),
  isLiveSourcesAvailable: () => true,
  loadGuide: jest.fn(),
  searchGuide: jest.fn(async () => []),
}));
/** When the guide file on disk was saved, as guideFileInfo reports it. */
let mockSavedAt = 1;
jest.mock("../src/guideFileCache", () => ({
  cachedGuideFile: jest.fn(async () => "file:///guide.xml"),
  clearGuideFileCache: jest.fn(),
  guideFileInfo: jest.fn(() => ({ bytes: 1, savedAt: mockSavedAt })),
  onGuideFileRefreshed: jest.fn(() => () => {}),
  PlaybackHoldError: class PlaybackHoldError extends Error {},
}));

import { fetchExternalAiring, fetchExternalListingWindow, guideSourceStatuses, resetExternalGuide, subscribeGuideRefreshed } from "../src/externalGuide";
import { cachedGuideFile, onGuideFileRefreshed, PlaybackHoldError } from "../src/guideFileCache";
import { setPlaybackHold } from "../src/playbackHold";
import { configureLive, type GuideChannelCandidate } from "../src/config";
import { AppState } from "react-native";

/** The tvOS memory warnings the module listens for; kept here because clearAllMocks drops recorded calls. */
const memoryWarnings: (() => void)[] = [];
jest.spyOn(AppState, "addEventListener").mockImplementation(((type: string, listener: () => void) => {
  if (type === "memoryWarning") memoryWarnings.push(listener);
  return { remove: jest.fn() };
}) as never);

/** The module's refreshed listener, taken before any clearAllMocks drops the registration call. */
const guideRefreshed = (onGuideFileRefreshed as jest.Mock).mock.calls[0][0] as (url: string) => void;

const H = 3_600_000;
const T0 = 1_700_000_000_000;
const SLACK = 24 * H;
const URL = "https://example.test/guide.xml";
const CHANNELS = [{ channelId: "c1", name: "News One" }];
const PROGRAMME = { channel: "g1", start: T0, stop: T0 + H, title: "News", subTitle: null, desc: null, categories: [], rating: null, icon: null };

const loadGuideMock = loadGuide as jest.Mock;
const closeGuideMock = closeGuide as jest.Mock;
const guideProgrammesMock = guideProgrammes as jest.Mock;

let tokens = 0;

beforeEach(() => {
  resetExternalGuide();
  jest.clearAllMocks();
  tokens = 0;
  mockSavedAt = 1;
  loadGuideMock.mockImplementation(async () => ({ token: `T${++tokens}`, stats: null }));
  guideProgrammesMock.mockImplementation(async () => [PROGRAMME]);
  (guideChannels as jest.Mock).mockImplementation(async () => [{ id: "g1", displayNames: ["News One"], icon: null }]);
});

it("reopens on the union of the windows, then serves both callers from one guide", async () => {
  await fetchExternalListingWindow([URL], CHANNELS, { from: T0, to: T0 + 6 * H });
  expect(loadGuideMock).toHaveBeenCalledTimes(1);
  expect(loadGuideMock.mock.calls[0][1]).toEqual({ from: T0, to: T0 + 6 * H + SLACK });

  // The search window reaches past the loaded end: one reload, taking in both windows.
  await fetchExternalListingWindow([URL], CHANNELS, { from: T0 + H, to: T0 + 38 * H });
  expect(loadGuideMock).toHaveBeenCalledTimes(2);
  expect(loadGuideMock.mock.calls[1][1]).toEqual({ from: T0, to: T0 + 38 * H + SLACK });

  // Both windows are covered: no further loads either way.
  await fetchExternalListingWindow([URL], CHANNELS, { from: T0, to: T0 + 6 * H });
  await fetchExternalListingWindow([URL], CHANNELS, { from: T0 + H, to: T0 + 38 * H });
  expect(loadGuideMock).toHaveBeenCalledTimes(2);
});

it("reads paused when playback holds a guide with no copy, and opens it on the next read with no failure backoff", async () => {
  (cachedGuideFile as jest.Mock).mockRejectedValueOnce(new PlaybackHoldError());
  const { failedChannelIds } = await fetchExternalListingWindow([URL], CHANNELS, { from: T0, to: T0 + 6 * H });
  expect(failedChannelIds).toEqual(["c1"]);
  expect(guideSourceStatuses()[URL].state).toBe("paused");
  expect(loadGuideMock).not.toHaveBeenCalled();
  const { listings } = await fetchExternalListingWindow([URL], CHANNELS, { from: T0, to: T0 + 6 * H });
  expect(listings).toHaveLength(1);
  expect(loadGuideMock).toHaveBeenCalledTimes(1);
});

it("keeps a guide while its file is the one on disk, and reopens it once a newer file is there", async () => {
  await fetchExternalListingWindow([URL], CHANNELS, { from: T0, to: T0 + 6 * H });
  await fetchExternalListingWindow([URL], CHANNELS, { from: T0, to: T0 + 6 * H });
  expect(loadGuideMock).toHaveBeenCalledTimes(1);
  mockSavedAt = 2;
  await fetchExternalListingWindow([URL], CHANNELS, { from: T0, to: T0 + 6 * H });
  expect(loadGuideMock).toHaveBeenCalledTimes(2);
  expect(closeGuideMock).toHaveBeenCalledWith("T1");
});

it("reopens a guide that was still reading the old file when the new file arrived", async () => {
  let parsed: ((value: { token: string; stats: null }) => void) | undefined;
  loadGuideMock.mockImplementationOnce(() => new Promise((resolve) => (parsed = resolve)));
  const reading = fetchExternalListingWindow([URL], CHANNELS, { from: T0, to: T0 + 6 * H });
  while (!parsed) await new Promise((resolve) => setTimeout(resolve, 0));
  mockSavedAt = 2;
  guideRefreshed(URL);
  parsed({ token: "T1", stats: null });
  await reading;
  await fetchExternalListingWindow([URL], CHANNELS, { from: T0, to: T0 + 6 * H });
  expect(loadGuideMock).toHaveBeenCalledTimes(2);
});

it("opens a guide asked for during playback once its file downloads, and tells screens to read again", async () => {
  const reread = jest.fn();
  const stop = subscribeGuideRefreshed(reread);
  (cachedGuideFile as jest.Mock).mockRejectedValueOnce(new PlaybackHoldError());
  await fetchExternalListingWindow([URL], CHANNELS, { from: T0, to: T0 + 6 * H });
  expect(loadGuideMock).not.toHaveBeenCalled();
  guideRefreshed("https://example.test/unknown.xml");
  expect(reread).not.toHaveBeenCalled();
  guideRefreshed(URL);
  expect(reread).toHaveBeenCalledTimes(1);
  while (guideSourceStatuses()[URL].state !== "ready") await new Promise((resolve) => setTimeout(resolve, 0));
  expect(loadGuideMock).toHaveBeenCalledTimes(1);
  stop();
});

it("updates a ready guide's status when a newer file downloads, without opening it", async () => {
  await fetchExternalListingWindow([URL], CHANNELS, { from: T0, to: T0 + 6 * H });
  const before = guideSourceStatuses()[URL];
  guideRefreshed(URL);
  expect(guideSourceStatuses()[URL]).not.toBe(before);
  expect(guideSourceStatuses()[URL].state).toBe("ready");
  expect(loadGuideMock).toHaveBeenCalledTimes(1);
});

it("shows paused during playback and waiting after it, for a guide whose file has not downloaded yet", async () => {
  setPlaybackHold("video", true);
  (cachedGuideFile as jest.Mock).mockRejectedValueOnce(new PlaybackHoldError());
  await fetchExternalListingWindow([URL], CHANNELS, { from: T0, to: T0 + 6 * H });
  expect(guideSourceStatuses()[URL].state).toBe("paused");
  setPlaybackHold("video", false);
  expect(guideSourceStatuses()[URL].state).toBe("waiting");
  setPlaybackHold("audio", true);
  expect(guideSourceStatuses()[URL].state).toBe("paused");
  setPlaybackHold("audio", false);
  // Once the guide opens, later playback leaves its ready status alone.
  await fetchExternalListingWindow([URL], CHANNELS, { from: T0, to: T0 + 6 * H });
  expect(guideSourceStatuses()[URL].state).toBe("ready");
  setPlaybackHold("video", true);
  expect(guideSourceStatuses()[URL].state).toBe("ready");
  setPlaybackHold("video", false);
});

it("closes every open guide on a memory warning, and opens it again at the next read", async () => {
  await fetchExternalListingWindow([URL], CHANNELS, { from: T0, to: T0 + 6 * H });
  expect(memoryWarnings).toHaveLength(1);
  memoryWarnings.forEach((warn) => warn());
  expect(closeGuideMock).toHaveBeenCalledWith("T1");
  await fetchExternalListingWindow([URL], CHANNELS, { from: T0, to: T0 + 6 * H });
  expect(loadGuideMock).toHaveBeenCalledTimes(2);
});

it("keeps a guide open through a memory warning until the read in progress ends", async () => {
  let finishRead: (() => void) | undefined;
  guideProgrammesMock.mockImplementationOnce(() => new Promise((resolve) => (finishRead = () => resolve([PROGRAMME]))));
  const reading = fetchExternalListingWindow([URL], CHANNELS, { from: T0, to: T0 + 6 * H });
  while (!finishRead) await new Promise((resolve) => setTimeout(resolve, 0));
  memoryWarnings.forEach((warn) => warn());
  expect(closeGuideMock).not.toHaveBeenCalled();
  finishRead();
  const { listings } = await reading;
  expect(listings).toHaveLength(1);
  expect(closeGuideMock).toHaveBeenCalledWith("T1");
});

it("closes the outgoing token only after its last in-flight read ends", async () => {
  let releaseRead: (() => void) | undefined;
  guideProgrammesMock.mockImplementationOnce(
    (token: string) =>
      new Promise((resolve) => {
        expect(token).toBe("T1");
        releaseRead = () => resolve([PROGRAMME]);
      }),
  );

  const reading = fetchExternalListingWindow([URL], CHANNELS, { from: T0, to: T0 + 6 * H });
  await Promise.resolve();
  while (!releaseRead) await new Promise((resolve) => setTimeout(resolve, 0));

  // A wider window lands T2 while T1 is still being read: T1 must stay open.
  await fetchExternalListingWindow([URL], CHANNELS, { from: T0, to: T0 + 48 * H });
  expect(closeGuideMock).not.toHaveBeenCalledWith("T1");

  releaseRead();
  const { listings } = await reading;
  expect(listings).toHaveLength(1);
  expect(closeGuideMock).toHaveBeenCalledWith("T1");
});

it("answers airing-now with the latest programme already started, one per channel", async () => {
  guideProgrammesMock.mockImplementation(async () => [
    { ...PROGRAMME, start: T0 - 2 * H, stop: T0 - H, title: "Earlier" },
    { ...PROGRAMME, start: T0 - H, stop: T0 + H, title: "On Now" },
    { ...PROGRAMME, start: T0 + H, stop: T0 + 2 * H, title: "Next" },
  ]);
  await fetchExternalListingWindow([URL], CHANNELS, { from: T0, to: T0 + 6 * H });
  const { listings } = await fetchExternalAiring([URL], CHANNELS, T0);
  expect(listings).toEqual([{ channelId: "c1", programme: expect.objectContaining({ title: "On Now" }) }]);
});

it("answers airing-now from open guides only, never opening one", async () => {
  const unopened = await fetchExternalAiring([URL], CHANNELS, T0);
  expect(unopened).toEqual({ listings: [], failedChannelIds: [] });
  expect(loadGuideMock).not.toHaveBeenCalled();

  // An open guide whose window ended before the asked minute is passed over the same way.
  await fetchExternalListingWindow([URL], CHANNELS, { from: T0, to: T0 + 6 * H });
  const past = await fetchExternalAiring([URL], CHANNELS, T0 + 6 * H + SLACK);
  expect(past).toEqual({ listings: [], failedChannelIds: [] });
  expect(loadGuideMock).toHaveBeenCalledTimes(1);
});

it("keeps the open guide serving covered windows when a wider reopen fails", async () => {
  await fetchExternalListingWindow([URL], CHANNELS, { from: T0, to: T0 + 6 * H });
  loadGuideMock.mockRejectedValueOnce(new Error("download refused"));

  const failed = await fetchExternalListingWindow([URL], CHANNELS, { from: T0, to: T0 + 48 * H });
  expect(failed.failedChannelIds).toEqual(["c1"]);

  const { listings } = await fetchExternalListingWindow([URL], CHANNELS, { from: T0, to: T0 + 6 * H });
  expect(listings).toHaveLength(1);
  expect(closeGuideMock).not.toHaveBeenCalledWith("T1");
});

describe("keeping only the app's channels", () => {
  let appChannels: GuideChannelCandidate[] | null = null;
  const provider = jest.fn(async () => appChannels);
  beforeEach(() => {
    appChannels = [{ channelId: "c1", tvgId: "g1", names: ["News One", "News 1"] }];
    configureLive({ channels: {} as never, guideChannels: provider });
  });
  afterAll(() => configureLive({ channels: {} as never }));

  it("sends the app's channels with every name to the native load", async () => {
    await fetchExternalListingWindow([URL], CHANNELS, { from: T0, to: T0 + 6 * H });
    expect(loadGuideMock.mock.calls[0][4]).toEqual([{ tvgId: "g1", tvgName: undefined, names: ["News One", "News 1"] }]);
  });

  it("keeps every channel when the app gives no list, or its list cannot be read", async () => {
    appChannels = null;
    await fetchExternalListingWindow([URL], CHANNELS, { from: T0, to: T0 + 6 * H });
    expect(loadGuideMock.mock.calls[0][4]).toBeUndefined();
    resetExternalGuide();
    provider.mockRejectedValueOnce(new Error("lineup down"));
    await fetchExternalListingWindow([URL], CHANNELS, { from: T0, to: T0 + 6 * H });
    expect(loadGuideMock.mock.calls[1][4]).toBeUndefined();
  });

  it("serves a channel on the list from the open guide, under any of its names", async () => {
    await fetchExternalListingWindow([URL], CHANNELS, { from: T0, to: T0 + 6 * H });
    await fetchExternalListingWindow([URL], [{ channelId: "c1", tvgId: "g1", name: "News 1" }], { from: T0, to: T0 + 6 * H });
    expect(loadGuideMock).toHaveBeenCalledTimes(1);
  });

  it("opens the guide again for a channel the list lacks, and keeps that channel in every later load", async () => {
    await fetchExternalListingWindow([URL], CHANNELS, { from: T0, to: T0 + 6 * H });
    const extra = { channelId: "c9", name: "Late Show" };
    await fetchExternalListingWindow([URL], [extra], { from: T0, to: T0 + 6 * H });
    expect(loadGuideMock).toHaveBeenCalledTimes(2);
    expect(loadGuideMock.mock.calls[1][4]).toContainEqual({ tvgId: undefined, tvgName: undefined, names: ["Late Show"] });
    // Asking for either channel again is served by the open guide.
    await fetchExternalListingWindow([URL], [...CHANNELS, extra], { from: T0, to: T0 + 6 * H });
    expect(loadGuideMock).toHaveBeenCalledTimes(2);
    // A wider window loads again and still keeps the extra channel.
    await fetchExternalListingWindow([URL], CHANNELS, { from: T0, to: T0 + 48 * H });
    expect(loadGuideMock.mock.calls[2][4]).toContainEqual({ tvgId: undefined, tvgName: undefined, names: ["Late Show"] });
  });

  it("opens the guide again for a name the list does not carry for a known channel", async () => {
    await fetchExternalListingWindow([URL], CHANNELS, { from: T0, to: T0 + 6 * H });
    await fetchExternalListingWindow([URL], [{ channelId: "c1", name: "News One East" }], { from: T0, to: T0 + 6 * H });
    expect(loadGuideMock).toHaveBeenCalledTimes(2);
  });
});
