/** externalGuide - one open guide per URL serves every caller's window, and no token closes mid-read. */

import { closeGuide, guideChannels, guideProgrammes, loadGuide } from "@keiver/tomo-engine";

jest.mock("@keiver/tomo-engine", () => ({
  closeGuide: jest.fn(async () => {}),
  engineLog: () => ({ warn: jest.fn() }),
  guideChannels: jest.fn(async () => [{ id: "g1", displayNames: ["News One"], icon: null }]),
  guideProgrammes: jest.fn(async () => []),
  isLiveSourcesAvailable: () => true,
  loadGuide: jest.fn(),
  searchGuide: jest.fn(async () => []),
}));
jest.mock("../src/guideFileCache", () => ({
  cachedGuideFile: jest.fn(async () => "file:///guide.xml"),
  clearGuideFileCache: jest.fn(),
}));

import { fetchExternalListingWindow, resetExternalGuide } from "../src/externalGuide";

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

it("keeps the open guide serving covered windows when a wider reopen fails", async () => {
  await fetchExternalListingWindow([URL], CHANNELS, { from: T0, to: T0 + 6 * H });
  loadGuideMock.mockRejectedValueOnce(new Error("download refused"));

  const failed = await fetchExternalListingWindow([URL], CHANNELS, { from: T0, to: T0 + 48 * H });
  expect(failed.failedChannelIds).toEqual(["c1"]);

  const { listings } = await fetchExternalListingWindow([URL], CHANNELS, { from: T0, to: T0 + 6 * H });
  expect(listings).toHaveLength(1);
  expect(closeGuideMock).not.toHaveBeenCalledWith("T1");
});
