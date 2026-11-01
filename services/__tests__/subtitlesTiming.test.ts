jest.mock("@/utils/logger", () => ({ logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() } }));
jest.mock("@/services/i18n", () => ({ t: (key: string) => key }));

import { Settings } from "react-native";
import { offsetLabel } from "@/services/subtitles/jobText";
import { setSubtitleOffsetMs, SUBTITLE_TIMING_KEY, subtitleOffsetMs } from "@/services/subtitles/timing";

describe("subtitle timing", () => {
  beforeEach(() => Settings.set({ [SUBTITLE_TIMING_KEY]: undefined }));

  it("keeps a correction per server, item and stream, and reads zero for the rest", () => {
    expect(subtitleOffsetMs("http://a", "item", 2)).toBe(0);
    expect(setSubtitleOffsetMs("http://a", "item", 2, 1500)).toBe(1500);
    expect(subtitleOffsetMs("http://a", "item", 2)).toBe(1500);
    expect(subtitleOffsetMs("http://a", "item", 3)).toBe(0);
    expect(subtitleOffsetMs("http://b", "item", 2)).toBe(0);
  });

  it("removes the entry at zero and clamps to the limit", () => {
    setSubtitleOffsetMs("http://a", "item", 2, -500);
    setSubtitleOffsetMs("http://a", "item", 2, 0);
    expect(JSON.parse(Settings.get(SUBTITLE_TIMING_KEY) as string)).toEqual({});
    expect(setSubtitleOffsetMs("http://a", "item", 2, 999_999)).toBe(60_000);
  });

  it("ignores a broken stored document", () => {
    Settings.set({ [SUBTITLE_TIMING_KEY]: "not json" });
    expect(subtitleOffsetMs("http://a", "item", 2)).toBe(0);
    Settings.set({ [SUBTITLE_TIMING_KEY]: JSON.stringify({ "http://a|item|2": "nope", "http://a|item|3": 500 }) });
    expect(subtitleOffsetMs("http://a", "item", 2)).toBe(0);
    expect(subtitleOffsetMs("http://a", "item", 3)).toBe(500);
  });

  it("names the offset in seconds, late or early", () => {
    expect(offsetLabel(0)).toBe("subtitles.onTime");
    expect(offsetLabel(1500)).toBe("subtitles.late".replace("{seconds}", "1.5"));
    expect(offsetLabel(-2000)).toBe("subtitles.early");
  });
});
