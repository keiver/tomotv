/** The external guide: one native load per URL and window, tvg-id matching with @-suffix bases, server-shaped programmes. */
import { fetchExternalPrograms, resetExternalGuide } from "../externalGuide";
import { EXTERNAL_GUIDE_PREFIX } from "@/utils/guide";

jest.mock("@/services/liveSources", () => ({
  isLiveSourcesAvailable: jest.fn(() => true),
  loadGuide: jest.fn(),
  guideProgrammes: jest.fn(),
  closeGuide: jest.fn().mockResolvedValue(undefined),
}));
jest.mock("@/utils/logger", () => ({ logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() } }));

const native = jest.requireMock("@/services/liveSources") as { isLiveSourcesAvailable: jest.Mock; loadGuide: jest.Mock; guideProgrammes: jest.Mock; closeGuide: jest.Mock };

const URL = "http://g/guide.xml.gz";
const WINDOW = { from: 1_000_000, to: 2_000_000 };
const DAY = 24 * 60 * 60 * 1000;

describe("fetchExternalPrograms", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    resetExternalGuide();
    native.loadGuide.mockResolvedValue("tok-1");
  });

  it("matches tvg-ids and their @-stripped bases, shaping programmes like the server's", async () => {
    native.guideProgrammes.mockResolvedValue([
      { channel: "A.us", start: 1_200_000, stop: 1_500_000, title: "Show", subTitle: "Ep", desc: "D", categories: ["News"], icon: null },
      { channel: "B.us@HD", start: 1_100_000, stop: null, title: "Other", subTitle: null, desc: null, categories: [], icon: null },
    ]);
    const programs = await fetchExternalPrograms(
      URL,
      [
        { channelId: "c1", tvgId: "A.us@SD" },
        { channelId: "c2", tvgId: "A.us@HD" },
        { channelId: "c3", tvgId: "B.us@HD" },
      ],
      WINDOW,
    );
    expect(native.loadGuide).toHaveBeenCalledWith(URL, { from: WINDOW.from, to: WINDOW.to + DAY });
    expect(native.guideProgrammes).toHaveBeenCalledWith("tok-1", ["A.us@SD", "A.us", "A.us@HD", "B.us@HD", "B.us"], WINDOW);
    // A.us serves both SD and HD channels; B.us@HD matched exactly.
    expect(programs.map((program) => [program.ChannelId, program.Name])).toEqual([
      ["c1", "Show"],
      ["c2", "Show"],
      ["c3", "Other"],
    ]);
    const first = programs[0];
    expect(first.Id).toBe(`${EXTERNAL_GUIDE_PREFIX}c1:1200000`);
    expect(first.StartDate).toBe(new Date(1_200_000).toISOString());
    expect(first.EndDate).toBe(new Date(1_500_000).toISOString());
    expect(first.Overview).toBe("D");
    expect(first.EpisodeTitle).toBe("Ep");
    expect(first.Genres).toEqual(["News"]);
    expect(programs[2].EndDate).toBeUndefined();
  });

  it("loads once per URL while the window is covered, and reloads past it or on a new URL", async () => {
    native.guideProgrammes.mockResolvedValue([]);
    const channels = [{ channelId: "c1", tvgId: "A.us" }];
    await fetchExternalPrograms(URL, channels, WINDOW);
    await fetchExternalPrograms(URL, channels, { from: WINDOW.from, to: WINDOW.to + DAY });
    expect(native.loadGuide).toHaveBeenCalledTimes(1);
    await fetchExternalPrograms(URL, channels, { from: WINDOW.from, to: WINDOW.to + 2 * DAY });
    expect(native.loadGuide).toHaveBeenCalledTimes(2);
    expect(native.closeGuide).toHaveBeenCalledWith("tok-1");
    await fetchExternalPrograms("http://g/other.xml", channels, WINDOW);
    expect(native.loadGuide).toHaveBeenCalledTimes(3);
  });

  it("returns nothing for no URL, no channels, no module, or a failed load", async () => {
    await expect(fetchExternalPrograms("", [{ channelId: "c", tvgId: "A" }], WINDOW)).resolves.toEqual([]);
    await expect(fetchExternalPrograms(URL, [], WINDOW)).resolves.toEqual([]);
    native.isLiveSourcesAvailable.mockReturnValueOnce(false);
    await expect(fetchExternalPrograms(URL, [{ channelId: "c", tvgId: "A" }], WINDOW)).resolves.toEqual([]);
    native.loadGuide.mockRejectedValueOnce(new Error("404"));
    await expect(fetchExternalPrograms(URL, [{ channelId: "c", tvgId: "A" }], WINDOW)).resolves.toEqual([]);
    expect(native.guideProgrammes).not.toHaveBeenCalled();
  });
});
