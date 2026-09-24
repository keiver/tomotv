import { adjacentChannelId, cellAtEdge, cellGeometry, guideMetrics, guideWindowStart, isActiveTimer, isAiring, labelPin, MINUTE_MS, programCategory, rulerTicks } from "../guide";

const tv = guideMetrics(true);
const T0 = Date.UTC(2026, 8, 12, 4, 0, 0);
const WINDOW_END = T0 + 360 * MINUTE_MS;

describe("guide geometry", () => {
  it("opens the window on the half hour the current time falls in", () => {
    expect(guideWindowStart(Date.UTC(2026, 8, 12, 4, 17, 30))).toBe(Date.UTC(2026, 8, 12, 4, 0, 0));
    expect(guideWindowStart(Date.UTC(2026, 8, 12, 4, 45, 0))).toBe(Date.UTC(2026, 8, 12, 4, 30, 0));
  });

  it("opens on the local half hour in a 45-minute offset zone", () => {
    // UTC+5:45 (Kathmandu): 14:25 UTC is 20:10 local, so the window opens at 20:00 local, 14:15 UTC.
    const offset = jest.spyOn(Date.prototype, "getTimezoneOffset").mockReturnValue(-345);
    try {
      expect(guideWindowStart(Date.UTC(2026, 8, 14, 14, 25))).toBe(Date.UTC(2026, 8, 14, 14, 15));
    } finally {
      offset.mockRestore();
    }
  });

  it("places a cell by its start and duration", () => {
    const cell = cellGeometry(T0 + 30 * MINUTE_MS, T0 + 90 * MINUTE_MS, T0, WINDOW_END, tv);
    expect(cell).toEqual({ left: 240, width: 480 });
  });

  it("clips a cell that started before the window", () => {
    const cell = cellGeometry(T0 - 60 * MINUTE_MS, T0 + 30 * MINUTE_MS, T0, WINDOW_END, tv);
    expect(cell).toEqual({ left: 0, width: 240 });
  });

  it("clips a cell that runs past the window end", () => {
    const cell = cellGeometry(WINDOW_END - 30 * MINUTE_MS, WINDOW_END + 60 * MINUTE_MS, T0, WINDOW_END, tv);
    expect(cell?.width).toBe(240);
  });

  it("drops programs outside the window and zero-length ones", () => {
    expect(cellGeometry(T0 - 120 * MINUTE_MS, T0, T0, WINDOW_END, tv)).toBeNull();
    expect(cellGeometry(WINDOW_END, WINDOW_END + 60 * MINUTE_MS, T0, WINDOW_END, tv)).toBeNull();
    expect(cellGeometry(T0, T0, T0, WINDOW_END, tv)).toBeNull();
  });

  it("keeps a one-minute program wide enough to focus", () => {
    const cell = cellGeometry(T0, T0 + MINUTE_MS, T0, WINDOW_END, tv);
    expect(cell?.width).toBe(tv.pxPerMinute);
  });

  it("lays a minor mark every five minutes, labels the half hours and marks the hours", () => {
    const ticks = rulerTicks(T0, T0 + 90 * MINUTE_MS, tv);
    expect(ticks).toHaveLength(18);
    expect(ticks[1]).toMatchObject({ left: 40, isMinor: true, isHour: false });
    const majors = ticks.filter((tick) => !tick.isMinor);
    expect(majors.map((tick) => tick.left)).toEqual([0, 240, 480]);
    expect(majors.map((tick) => tick.isHour)).toEqual([true, false, true]);
  });

  it("pins a label to the visible edge without pushing it out of its cell", () => {
    expect(labelPin(0, 100, 400, 120)).toBe(0);
    expect(labelPin(250, 100, 400, 120)).toBe(150);
    expect(labelPin(900, 100, 400, 120)).toBe(280);
    expect(labelPin(900, 100, 80, 120)).toBe(0);
  });

  it("names the airing program by its dates", () => {
    const program = { StartDate: new Date(T0).toISOString(), EndDate: new Date(T0 + 60 * MINUTE_MS).toISOString() };
    expect(isAiring(program, T0 + MINUTE_MS)).toBe(true);
    expect(isAiring(program, T0 + 60 * MINUTE_MS)).toBe(false);
    expect(isAiring({}, T0)).toBe(false);
  });

  it("counts a timer as active until it is cancelled or completed", () => {
    expect(isActiveTimer({ Status: "New" })).toBe(true);
    expect(isActiveTimer({ Status: "InProgress" })).toBe(true);
    expect(isActiveTimer({ Status: "Completed" })).toBe(false);
    expect(isActiveTimer({ Status: "Cancelled" })).toBe(false);
  });

  it("lands a vertical move on the cell under the edge, else the first after it", () => {
    const at = (from: number, to: number) => ({ Id: `${from}`, StartDate: new Date(T0 + from * MINUTE_MS).toISOString(), EndDate: new Date(T0 + to * MINUTE_MS).toISOString() });
    const row = [at(0, 30), at(30, 60), at(90, 120)];
    expect(cellAtEdge(row, T0)?.Id).toBe("0");
    expect(cellAtEdge(row, T0 + 45 * MINUTE_MS)?.Id).toBe("30");
    expect(cellAtEdge(row, T0 + 70 * MINUTE_MS)?.Id).toBe("90");
    expect(cellAtEdge(row, T0 + 200 * MINUTE_MS)?.Id).toBe("90");
    expect(cellAtEdge([], T0)).toBeUndefined();
  });

  it("ranks one category per program, sports first", () => {
    expect(programCategory({ IsSports: true, IsNews: true })).toBe("sports");
    expect(programCategory({ IsKids: true })).toBe("kids");
    expect(programCategory({ IsMovie: true })).toBe("movie");
    expect(programCategory({})).toBeNull();
  });

  it("flips to the adjacent channel, wrapping at the ends", () => {
    const list = [{ Id: "a" }, { Id: "b" }, { Id: "c" }];
    expect(adjacentChannelId(list, "a", 1)).toBe("b");
    expect(adjacentChannelId(list, "c", 1)).toBe("a");
    expect(adjacentChannelId(list, "a", -1)).toBe("c");
    expect(adjacentChannelId(list, "b", -1)).toBe("a");
    expect(adjacentChannelId(list, "missing", 1)).toBeNull();
    expect(adjacentChannelId([{ Id: "only" }], "only", 1)).toBeNull();
    expect(adjacentChannelId([], "x", 1)).toBeNull();
  });
});
