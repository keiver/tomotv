import { FRACTION_TICKS, PAGE_TICKS, ReadingProgress, pageForTicks, ticksForPage } from "@/services/books/progress";
import { updateUserItemData } from "@/services/jellyfinApi";

jest.mock("@/services/jellyfinApi", () => ({
  updateUserItemData: jest.fn(async () => "ok"),
}));

const mockedWrite = updateUserItemData as jest.Mock;

describe("reading position ticks", () => {
  it("encodes fixed layouts as page x 10000, the server's own RunTimeTicks unit", () => {
    expect(ticksForPage("fixed", 0, 12)).toBe(0);
    expect(ticksForPage("fixed", 5, 12)).toBe(5 * PAGE_TICKS);
    expect(pageForTicks("fixed", 50000, 12)).toBe(5);
  });

  it("encodes text books as a fraction of 10^7", () => {
    expect(ticksForPage("text", 0, 200)).toBe(0);
    expect(ticksForPage("text", 100, 200)).toBe(FRACTION_TICKS / 2);
    expect(pageForTicks("text", FRACTION_TICKS / 2, 200)).toBe(100);
    expect(ticksForPage("text", 0, 1)).toBe(0);
  });

  it("clamps a stale position into the book", () => {
    expect(pageForTicks("fixed", 990000, 12)).toBe(11);
    expect(pageForTicks("fixed", undefined, 12)).toBe(0);
    expect(pageForTicks("text", FRACTION_TICKS, 0)).toBe(0);
  });
});

describe("ReadingProgress", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    mockedWrite.mockClear();
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  it("writes the last noted page once the reader settles", async () => {
    const progress = new ReadingProgress("book-1", "fixed");
    progress.note(3, 12);
    progress.note(4, 12);
    expect(mockedWrite).not.toHaveBeenCalled();
    await jest.advanceTimersByTimeAsync(2000);
    expect(mockedWrite).toHaveBeenCalledTimes(1);
    expect(mockedWrite).toHaveBeenCalledWith("book-1", { PlaybackPositionTicks: 4 * PAGE_TICKS, Played: false });
  });

  it("marks the last page played with no resume point", async () => {
    const progress = new ReadingProgress("book-1", "text");
    progress.note(199, 200);
    await progress.flush();
    expect(mockedWrite).toHaveBeenCalledWith("book-1", { PlaybackPositionTicks: 0, Played: true });
  });

  it("flush writes what is pending and skips a repeat of the last write", async () => {
    const progress = new ReadingProgress("book-1", "fixed");
    progress.note(2, 12);
    await progress.flush();
    await progress.flush();
    progress.note(2, 12);
    await progress.flush();
    expect(mockedWrite).toHaveBeenCalledTimes(1);
  });

  it("writes nothing for a book that was opened and left on its opening page", async () => {
    const progress = new ReadingProgress("book-1", "fixed");
    progress.start(0, 12);
    await progress.flush();
    expect(mockedWrite).not.toHaveBeenCalled();
    progress.note(1, 12);
    await progress.flush();
    expect(mockedWrite).toHaveBeenCalledWith("book-1", { PlaybackPositionTicks: PAGE_TICKS, Played: false });
  });

  it("swallows a failed write", async () => {
    mockedWrite.mockRejectedValueOnce(new Error("offline"));
    const progress = new ReadingProgress("book-1", "fixed");
    progress.note(1, 12);
    await expect(progress.flush()).resolves.toBeUndefined();
  });
});
