/** Guide Sources wording: a guide's label, and its row line for every state. */
import type { GuideSourceStatus } from "@/services/externalGuide";
import { guideLabel, guideSourceSummary } from "../guideSources";

const tr = (key: string) => key;
const base: GuideSourceStatus = { url: "http://g/x.xml", state: "ready", progress: null, channels: 120, programmes: 4000, loadedAt: 1, asked: 0, matched: [] };

describe("guide sources wording", () => {
  it("labels a guide by host and path", () => {
    expect(guideLabel("https://epg.example.com/us/guide.xml.gz")).toBe("epg.example.com/us/guide.xml.gz");
    expect(guideLabel("http://lan:8080/")).toBe("lan:8080");
  });

  it("says off, waiting, downloading, reading and unavailable before anything else", () => {
    expect(guideSourceSummary(base, false, tr)).toEqual({ subtitle: "liveTv.guideOff" });
    expect(guideSourceSummary(undefined, true, tr)).toEqual({ subtitle: "liveTv.guideWaiting" });
    expect(guideSourceSummary({ ...base, state: "downloading", progress: null }, true, tr)).toEqual({ subtitle: "liveTv.guideDownloading" });
    expect(guideSourceSummary({ ...base, state: "downloading", progress: 0.456 }, true, (key) => (key === "liveTv.guideDownloadingPercent" ? "Downloading {percent}%" : key))).toEqual({
      subtitle: "Downloading 46%",
    });
    expect(guideSourceSummary({ ...base, state: "reading" }, true, tr)).toEqual({ subtitle: "liveTv.guideParsing" });
    expect(guideSourceSummary({ ...base, state: "error" }, true, tr)).toEqual({ subtitle: "liveTv.guideUnavailable" });
  });

  it("shows what a guide holds until channels are asked of it, then what it paired, with a meter", () => {
    const words = (key: string) => (key === "liveTv.guideContents" ? "{channels} channels, {programmes} shows" : "{matched} of {asked} channels paired");
    expect(guideSourceSummary(base, true, words)).toEqual({ subtitle: "120 channels, 4000 shows" });
    const paired = { ...base, asked: 40, matched: Array.from({ length: 10 }, (_, i) => ({ channelId: `c${i}`, name: `C${i}`, via: "id" as const })) };
    expect(guideSourceSummary(paired, true, words)).toEqual({ subtitle: "10 of 40 channels paired", meter: 0.25 });
  });
});
