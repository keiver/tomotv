import { chapterFrameUrl, sessionBaseUrl } from "../localRemux";

jest.mock("@/utils/logger", () => ({ logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() } }));

describe("chapterFrameUrl", () => {
  it("names the frame by its start in whole milliseconds under the base", () => {
    expect(chapterFrameUrl("http://127.0.0.1:9/tok/", 100.5)).toBe("http://127.0.0.1:9/tok/frame-100500.png");
    expect(chapterFrameUrl("http://127.0.0.1:9/tok/", 0)).toBe("http://127.0.0.1:9/tok/frame-0.png");
    expect(chapterFrameUrl("http://127.0.0.1:9/tok/", 1.0004)).toBe("http://127.0.0.1:9/tok/frame-1000.png");
  });

  it("answers nothing without a base, and never a negative time", () => {
    expect(chapterFrameUrl(null, 10)).toBeNull();
    expect(chapterFrameUrl(undefined, 10)).toBeNull();
    expect(chapterFrameUrl("http://127.0.0.1:9/tok/", -3)).toBe("http://127.0.0.1:9/tok/frame-0.png");
  });

  it("builds on a session's master URL through sessionBaseUrl", () => {
    const base = sessionBaseUrl("http://127.0.0.1:9/tok/master.m3u8");
    expect(base).toBe("http://127.0.0.1:9/tok/");
    expect(chapterFrameUrl(base, 42)).toBe("http://127.0.0.1:9/tok/frame-42000.png");
  });
});
