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
jest.mock("../src/guideFileCache", () => ({
  cachedGuideFile: jest.fn(async () => "file:///guide.xml"),
  clearGuideFileCache: jest.fn(),
  onGuideFileRefreshed: jest.fn(() => () => {}),
}));

import { fetchExternalAiring, fetchExternalListingWindow, guideSourceStatuses, resetExternalGuide } from "../src/externalGuide";
import { cachedGuideFile, onGuideFileRefreshed } from "../src/guideFileCache";
import { setPlaybackHold } from "../src/playbackHold";

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

it("reads paused while playback holds the download back, then downloading once it lets go", async () => {
  let land: ((uri: string) => void) | undefined;
  (cachedGuideFile as jest.Mock).mockImplementationOnce(() => new Promise((resolve) => (land = resolve)));
  setPlaybackHold("video", true);
  const reading = fetchExternalListingWindow([URL], CHANNELS, { from: T0, to: T0 + 6 * H });
  await Promise.resolve();
  expect(guideSourceStatuses()[URL].state).toBe("paused");
  setPlaybackHold("video", false);
  expect(guideSourceStatuses()[URL].state).toBe("downloading");
  land!("file:///guide.xml");
  await reading;
  expect(guideSourceStatuses()[URL].state).toBe("ready");
});

it("closes a guide opened on an older file once its owed download lands, and the next read reopens it", async () => {
  await fetchExternalListingWindow([URL], CHANNELS, { from: T0, to: T0 + 6 * H });
  expect(loadGuideMock).toHaveBeenCalledTimes(1);
  guideRefreshed(URL);
  expect(closeGuideMock).toHaveBeenCalledWith("T1");
  await fetchExternalListingWindow([URL], CHANNELS, { from: T0, to: T0 + 6 * H });
  expect(loadGuideMock).toHaveBeenCalledTimes(2);
});

it("leaves an open in flight alone when the download it reads lands", async () => {
  let land: ((uri: string) => void) | undefined;
  (cachedGuideFile as jest.Mock).mockImplementationOnce(() => new Promise((resolve) => (land = resolve)));
  const reading = fetchExternalListingWindow([URL], CHANNELS, { from: T0, to: T0 + 6 * H });
  await Promise.resolve();
  guideRefreshed(URL);
  land!("file:///guide.xml");
  await reading;
  expect(closeGuideMock).not.toHaveBeenCalled();
  await fetchExternalListingWindow([URL], CHANNELS, { from: T0, to: T0 + 6 * H });
  expect(loadGuideMock).toHaveBeenCalledTimes(1);
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
