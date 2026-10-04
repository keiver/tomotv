import { __setLocaleForTests } from "@/services/i18n";
import { formatDuration } from "../formatDuration";

describe("formatDuration", () => {
  it("should format hours and minutes", () => {
    const ticks = 54000000000; // 90 minutes = 1h 30m
    expect(formatDuration(ticks)).toBe("1h 30m");
  });

  it("should format minutes only", () => {
    const ticks = 27000000000; // 45 minutes
    expect(formatDuration(ticks)).toBe("45m");
  });

  it("should handle zero minutes", () => {
    const ticks = 36000000000; // 60 minutes = 1h 0m
    expect(formatDuration(ticks)).toBe("1h 0m");
  });

  it("should handle less than a minute", () => {
    const ticks = 300000000; // 30 seconds
    expect(formatDuration(ticks)).toBe("0m");
  });

  it("prints the active language's units", () => {
    __setLocaleForTests("de");
    try {
      expect(formatDuration(54000000000)).toBe("1 Std. 30 Min.");
      expect(formatDuration(27000000000)).toBe("45 Min.");
    } finally {
      __setLocaleForTests("en");
    }
  });
});
